import {
  getCredentials,
  getExportById,
  getOwnConnection,
  getPlaylist,
  listItemResolutions,
  listPlaylistItems,
  markConnectionExpired,
  recordAuditEvent,
  updateAccessToken,
  updateExport,
  upsertItemResolution,
} from "@resonance/db";
import type { Database } from "@resonance/db";
import {
  SpotifyAmbiguousError,
  SpotifyApiError,
  SpotifyAuth,
  SpotifyAuthError,
  SpotifyClient,
  TokenCipher,
  decideResolution,
} from "@resonance/spotify";
import type { ResolutionDecision } from "@resonance/spotify";
import type { AppConfig } from "@resonance/config";
import type { Logger } from "@resonance/observability";

/**
 * Spotify export state machine (spec §12.8):
 * requested → resolving → [needs_review] → creating_playlist →
 * inserting_items → completed, with typed failure branches. Invariants:
 *  - a persisted destination playlist id is NEVER recreated on retry;
 *  - a post-transmission timeout is ambiguous and never blindly replayed;
 *  - unresolved tracks stay in the canonical playlist (skipped);
 *  - plaintext tokens exist only inside this job's process memory.
 */

export interface SpotifyExportDeps {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export async function runSpotifyExportJob(
  db: Database,
  logger: Logger,
  config: AppConfig,
  exportId: string,
  deps: SpotifyExportDeps = {},
): Promise<void> {
  const exportRow = await getExportById(db, exportId);
  if (!exportRow) return;
  if (
    ["completed", "failed", "superseded", "cancelled", "ambiguous", "needs_review"].includes(
      exportRow.status,
    )
  ) {
    return;
  }

  if (!config.featureSpotifyExport) {
    await updateExport(db, exportId, { status: "failed", errorCode: "feature_disabled" });
    return;
  }

  const connection = exportRow.connectionId
    ? await getOwnConnection(db, exportRow.userId, exportRow.connectionId)
    : undefined;
  if (!connection || connection.status !== "active") {
    await updateExport(db, exportId, { status: "authorization_required", errorCode: "no_active_connection" });
    return;
  }

  const cipher = new TokenCipher(config.tokenEncryptionKeyB64, config.tokenEncryptionKeyVersion);
  const auth = new SpotifyAuth({
    accountsBaseUrl: config.spotifyAccountsBaseUrl,
    clientId: config.spotifyClientId,
    clientSecret: config.spotifyClientSecret,
    redirectUri: config.spotifyRedirectUri,
    ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
  });

  /** Decrypt-on-demand access token with refresh + rotation persistence (§12.4). */
  const getAccessToken = async (): Promise<string> => {
    const credentials = await getCredentials(db, connection.id);
    if (!credentials) throw new SpotifyAuthError("invalid_grant", "credentials missing");
    if (credentials.accessTokenExpiresAt.getTime() - Date.now() > 60_000) {
      return cipher.decrypt(credentials.accessToken);
    }
    if (!credentials.refreshToken) throw new SpotifyAuthError("invalid_grant", "no refresh token");
    const refreshed = await auth.refresh(cipher.decrypt(credentials.refreshToken));
    await updateAccessToken(
      db,
      connection.id,
      cipher.encrypt(refreshed.accessToken),
      refreshed.refreshToken ? cipher.encrypt(refreshed.refreshToken) : null,
      refreshed.expiresAt,
    );
    return refreshed.accessToken;
  };

  const client = new SpotifyClient({
    apiBaseUrl: config.spotifyApiBaseUrl,
    getAccessToken,
    ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
  });

  try {
    // --- Resolve ------------------------------------------------------------
    await updateExport(db, exportId, { status: "resolving" });
    const playlist = await getPlaylist(db, exportRow.userId, exportRow.playlistId);
    if (!playlist) {
      await updateExport(db, exportId, { status: "failed", errorCode: "playlist_missing" });
      return;
    }
    const items = await listPlaylistItems(db, exportRow.playlistId);
    const existing = new Map(
      (await listItemResolutions(db, exportId)).map((row) => [row.recordingId, row]),
    );
    const isrcCache = new Map<string, Awaited<ReturnType<typeof client.searchByIsrc>>>();

    for (const item of items) {
      const prior = existing.get(item.recording.id);
      if (prior && prior.status !== "pending") continue; // confirmations/rejections survive

      const canonical = {
        title: item.recording.title,
        primaryArtist: item.recording.artists[0]?.name ?? "",
        durationMs: item.recording.durationMs,
        isrc: item.recording.isrc,
        releaseYear: item.recording.firstReleaseDate
          ? Number.parseInt(item.recording.firstReleaseDate.slice(0, 4), 10) || null
          : null,
      };

      // ISRC-first with per-export coalescing (§12.9), then artist/title.
      let decision: ResolutionDecision = { status: "unresolved" };
      if (canonical.isrc) {
        let results = isrcCache.get(canonical.isrc);
        if (!results) {
          results = await client.searchByIsrc(canonical.isrc);
          isrcCache.set(canonical.isrc, results);
        }
        decision = decideResolution(canonical, results, true);
      }
      if (decision.status === "unresolved") {
        const results = await client.searchByArtistTitle(canonical.primaryArtist, canonical.title);
        decision = decideResolution(canonical, results, false);
      }

      if (decision.status === "unresolved") {
        await upsertItemResolution(db, {
          exportId,
          recordingId: item.recording.id,
          status: "unresolved",
        });
      } else {
        const { candidate } = decision;
        await upsertItemResolution(db, {
          exportId,
          recordingId: item.recording.id,
          destinationItemId: candidate.id,
          destinationUri: candidate.uri,
          matchMethod: candidate.matchMethod,
          confidence: candidate.confidence,
          status: decision.status,
          temporaryDisplayTitle: candidate.displayTitle,
          temporaryDisplayArtist: candidate.displayArtist,
        });
      }
    }

    const resolutions = await listItemResolutions(db, exportId);
    const needsConfirmation = resolutions.filter((row) => row.status === "needs_confirmation");
    const resolved = resolutions.filter(
      (row) => row.status === "auto_resolved" || row.status === "confirmed",
    );
    const skipped = resolutions.filter(
      (row) => row.status === "unresolved" || row.status === "rejected",
    );

    await updateExport(db, exportId, {
      itemCount: items.length,
      resolvedCount: resolved.length,
      skippedCount: skipped.length,
    });

    if (needsConfirmation.length > 0) {
      // Ambiguous matches require explicit user confirmation (§12.5 step 3).
      await updateExport(db, exportId, { status: "needs_review" });
      return;
    }
    if (resolved.length === 0) {
      await updateExport(db, exportId, { status: "failed", errorCode: "nothing_resolvable" });
      return;
    }

    // --- Create playlist (exactly once, §12.8 rule 2) -----------------------
    let destinationPlaylistId = exportRow.destinationPlaylistId;
    if (!destinationPlaylistId) {
      await updateExport(db, exportId, { status: "creating_playlist" });
      const created = await client.createPrivatePlaylist(
        `Resonance — ${playlist.name}`.slice(0, 100),
        "Created from a service-neutral Resonance discovery playlist.",
      );
      destinationPlaylistId = created.id;
      await updateExport(db, exportId, {
        destinationPlaylistId: created.id,
        destinationUrl: created.url,
      });
    }

    // --- Insert items (single batch, canonical order, §12.7) ----------------
    await updateExport(db, exportId, { status: "inserting_items" });
    const orderedUris = items
      .map((item) => resolutions.find((row) => row.recordingId === item.recording.id))
      .filter(
        (row): row is NonNullable<typeof row> =>
          !!row && (row.status === "auto_resolved" || row.status === "confirmed") && !!row.destinationUri,
      )
      .map((row) => row.destinationUri!);

    await client.addPlaylistItems(destinationPlaylistId, orderedUris);

    for (const row of resolutions) {
      if (row.status === "auto_resolved" || row.status === "confirmed") {
        await upsertItemResolution(db, {
          exportId,
          recordingId: row.recordingId,
          destinationItemId: row.destinationItemId,
          destinationUri: row.destinationUri,
          matchMethod: row.matchMethod,
          confidence: row.confidence,
          status: "inserted",
          temporaryDisplayTitle: row.temporaryDisplayTitle,
          temporaryDisplayArtist: row.temporaryDisplayArtist,
        });
      }
    }

    await updateExport(db, exportId, {
      status: "completed",
      insertedCount: orderedUris.length,
      completedAt: new Date(),
      errorCode: null,
    });
    await recordAuditEvent(db, {
      userId: exportRow.userId,
      action: "spotify_export_completed",
      entityType: "export",
      entityId: exportId,
    });
    logger.info(
      {
        exportId,
        inserted: orderedUris.length,
        skipped: skipped.length,
        rateLimited: client.metrics.rateLimited,
        retries: client.metrics.retries,
      },
      "spotify export completed",
    );
  } catch (error) {
    await handleExportFailure(db, logger, exportId, connection.id, error);
  }
}

async function handleExportFailure(
  db: Database,
  logger: Logger,
  exportId: string,
  connectionId: string,
  error: unknown,
): Promise<void> {
  if (error instanceof SpotifyAmbiguousError) {
    // Unknown outcome after transmission: no blind retry (§12.8 rules 5–6).
    await updateExport(db, exportId, { status: "ambiguous", errorCode: "ambiguous_network_completion" });
    logger.warn({ exportId }, "spotify export ambiguous outcome; user decision required");
    return;
  }
  if (error instanceof SpotifyAuthError && error.kind === "invalid_grant") {
    await markConnectionExpired(db, connectionId);
    await updateExport(db, exportId, { status: "authorization_required", errorCode: "invalid_grant" });
    logger.warn({ exportId }, "spotify export requires reauthorization");
    return;
  }
  if (error instanceof SpotifyApiError) {
    if (error.kind === "rate_limited") {
      await updateExport(db, exportId, { status: "rate_limited", errorCode: "rate_limited" });
      logger.warn({ exportId, retryAfter: error.retryAfterSeconds }, "spotify export rate limited");
      return;
    }
    if (error.kind === "unauthorized" || error.kind === "forbidden") {
      await updateExport(db, exportId, { status: "authorization_required", errorCode: error.kind });
      return;
    }
  }
  await updateExport(db, exportId, { status: "failed", errorCode: "provider_error" });
  logger.error({ exportId, err: String(error).slice(0, 160) }, "spotify export failed");
}
