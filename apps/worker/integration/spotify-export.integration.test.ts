import {
  activateConnection,
  completeRunWithTrace,
  createDatabase,
  createOrGetExport,
  createPlaylistFromRun,
  createRecommendationRun,
  encryptedOauthCredentials,
  getExportById,
  insertSeeds,
  listItemResolutions,
  listRunItems,
  migrate,
  recordings,
  seedLicenseRegistry,
  seedSyntheticCatalog,
  setResolutionStatus,
  updateExport,
  users,
} from "@resonance/db";
import { loadConfig } from "@resonance/config";
import { TokenCipher } from "@resonance/spotify";
import { buildSyntheticSnapshot, artistUuid, recordingUuid } from "@resonance/testkit";
import { createLogger } from "@resonance/observability";
import { eq, inArray } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runRecommendationJob } from "../src/jobs/recommendation-generate.js";
import { runSpotifyExportJob } from "../src/jobs/spotify-export.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const KEY = Buffer.alloc(32, 9).toString("base64");

function pilotConfig() {
  return {
    ...loadConfig({ DATABASE_URL: databaseUrl!, FEATURE_SPOTIFY_EXPORT: "true" }),
    spotifyClientId: "test-client",
    spotifyClientSecret: "test-secret",
    spotifyRedirectUri: "http://127.0.0.1:3000/api/v1/connections/spotify/callback",
    spotifyAccountsBaseUrl: "https://accounts.spotify.example.test",
    spotifyApiBaseUrl: "https://api.spotify.example.test",
    tokenEncryptionKeyB64: KEY,
    tokenEncryptionKeyVersion: "v1",
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** Mock Spotify API: exact ISRC-free search results by track query. */
function happySpotifyFetch(): typeof fetch {
  let playlistCounter = 0;
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v1/search")) {
      const query = decodeURIComponent(url);
      const title = /track:"([^"]+)"/.exec(query)?.[1] ?? "Unknown";
      const artist = /artist:"([^"]+)"/.exec(query)?.[1] ?? "Unknown";
      return jsonResponse({
        tracks: {
          items: [
            {
              uri: `spotify:track:${Buffer.from(title).toString("hex").slice(0, 12)}`,
              id: Buffer.from(title).toString("hex").slice(0, 12),
              name: title,
              duration_ms: 214000,
              artists: [{ name: artist }],
              album: { release_date: "2010-01-01" },
            },
          ],
        },
      });
    }
    if (url.includes("/v1/me/playlists") && init?.method === "POST") {
      playlistCounter += 1;
      return jsonResponse({
        id: `dest-pl-${playlistCounter}`,
        external_urls: { spotify: `https://open.spotify.example/dest-pl-${playlistCounter}` },
      });
    }
    if (/\/v1\/playlists\/.+\/tracks/.test(url)) {
      return jsonResponse({ snapshot_id: "snap" }, { status: 201 });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
}

describeWithDb("spotify export job state machine (spec §12.8)", () => {
  const logger = createLogger({ service: "worker", level: "fatal" });
  const config = pilotConfig();
  const cipher = new TokenCipher(KEY, "v1");
  let db: ReturnType<typeof createDatabase>["db"];
  let pool: ReturnType<typeof createDatabase>["pool"];
  let userId: string;
  let playlistId: string;
  let connectionId: string;

  async function fabricatePlaylist(ownerId: string): Promise<string> {
    const run = await createRecommendationRun(db, {
      userId: ownerId,
      contextId: null,
      requestedCount: 10,
      discoveryLevel: 50,
      randomSeed: `spx-${RUN}-${Math.random().toString(36).slice(2, 8)}`,
    });
    await completeRunWithTrace(db, {
      runId: run.id,
      userId: ownerId,
      status: "completed",
      rankerVersion: "r",
      selectorVersion: "s",
      profileSnapshotVersion: "p",
      degradedProviders: [],
      constraintRelaxations: [],
      candidates: [],
      items: [recordingUuid(0, 0), recordingUuid(1, 0), recordingUuid(2, 0)].map(
        (recordingId, index) => ({
          recordingId,
          position: index + 1,
          score: 0.5,
          noveltyProbability: 0.8,
          noveltyState: "probably_new",
          noveltyConfidence: 0.6,
          selectionReason: "top_score",
          explanation: {
            templateKey: "feature_bridge",
            renderedText: "Golden fixture.",
            evidence: [{ type: "feature_match", label: "tag", refId: "tag:test" }],
            generatorVersion: "e",
          },
        }),
      ),
    });
    const playlist = await createPlaylistFromRun(db, {
      userId: ownerId,
      name: `Export target ${RUN}`,
      sourceRunId: run.id,
    });
    return playlist.id;
  }

  beforeAll(async () => {
    ({ db, pool } = createDatabase(databaseUrl!));
    const migrationsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../packages/db/migrations",
    );
    await migrate(pool, migrationsDir);
    await seedLicenseRegistry(pool);
    await seedSyntheticCatalog(db, buildSyntheticSnapshot());
    // The exported tracks need known durations so exact provider matches can
    // clear the auto-resolve threshold without an ISRC (spec §12.5).
    await db
      .update(recordings)
      .set({ durationMs: 214000 })
      .where(inArray(recordings.id, [recordingUuid(0, 0), recordingUuid(1, 0), recordingUuid(2, 0)]));

    const inserted = await db
      .insert(users)
      .values({ emailNormalized: `spx-${RUN}@example.test` })
      .returning({ id: users.id });
    userId = inserted[0]!.id;
    playlistId = await fabricatePlaylist(userId);

    const connection = await activateConnection(db, {
      userId,
      service: "spotify",
      scopeSet: ["playlist-modify-private"],
      accessToken: cipher.encrypt("synthetic-access-token"),
      refreshToken: cipher.encrypt("synthetic-refresh-token"),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      reauthorizationDueAt: new Date(Date.now() + 150 * 24 * 3600_000),
    });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  async function makeExport(targetPlaylistId = playlistId) {
    const { export: row } = await createOrGetExport(db, {
      userId,
      playlistId: targetPlaylistId,
      destination: "spotify",
      connectionId,
      idempotencyKey: `${RUN}-${Math.random().toString(36).slice(2, 10)}`,
      itemCount: 3,
    });
    return row;
  }

  it("resolves, creates one private playlist, inserts one batch, completes — tokens never in trace", async () => {
    const exportRow = await makeExport();
    await runSpotifyExportJob(db, logger, config, exportRow.id, { fetchFn: happySpotifyFetch(), sleep: async () => {} });

    const finished = await getExportById(db, exportRow.id);
    expect(finished!.status).toBe("completed");
    expect(finished!.insertedCount).toBe(3);
    expect(finished!.destinationPlaylistId).toMatch(/^dest-pl-/);
    expect(finished!.destinationUrl).toContain("open.spotify.example");

    const resolutions = await listItemResolutions(db, exportRow.id);
    expect(resolutions.every((row) => row.status === "inserted")).toBe(true);
    expect(resolutions.every((row) => row.expiresAt.getTime() > Date.now())).toBe(true);
    expect(JSON.stringify(resolutions)).not.toContain("synthetic-access-token");
  });

  it("keeps the persisted destination playlist across retries (no duplicate creation)", async () => {
    const exportRow = await makeExport();
    let createCalls = 0;
    const countingFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).includes("/v1/me/playlists") && init?.method === "POST") createCalls += 1;
      return (happySpotifyFetch() as (i: Parameters<typeof fetch>[0], n?: RequestInit) => Promise<Response>)(
        input,
        init,
      );
    }) as typeof fetch;

    await runSpotifyExportJob(db, logger, config, exportRow.id, { fetchFn: countingFetch, sleep: async () => {} });
    expect(createCalls).toBe(1);
    const first = await getExportById(db, exportRow.id);

    // Simulate a resume after rate limiting: same export re-run.
    await updateExport(db, exportRow.id, { status: "requested" });
    await runSpotifyExportJob(db, logger, config, exportRow.id, { fetchFn: countingFetch, sleep: async () => {} });
    const second = await getExportById(db, exportRow.id);
    expect(createCalls).toBe(1); // §12.8 rule 2
    expect(second!.destinationPlaylistId).toBe(first!.destinationPlaylistId);
  });

  it("ambiguous matches pause for review; confirmation resumes, rejection keeps tracks canonical", async () => {
    const ambiguousFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/search")) {
        const query = decodeURIComponent(url);
        const title = /track:"([^"]+)"/.exec(query)?.[1] ?? "Unknown";
        const artist = /artist:"([^"]+)"/.exec(query)?.[1] ?? "Unknown";
        // Live version with drifted duration → mid-band confidence.
        return Promise.resolve(
          jsonResponse({
            tracks: {
              items: [
                {
                  uri: `spotify:track:amb${Buffer.from(title).toString("hex").slice(0, 8)}`,
                  id: `amb${Buffer.from(title).toString("hex").slice(0, 8)}`,
                  name: `${title} (Live)`,
                  duration_ms: 220000,
                  artists: [{ name: artist }],
                  album: { release_date: "2010-01-01" },
                },
              ],
            },
          }),
        );
      }
      return (happySpotifyFetch() as (i: Parameters<typeof fetch>[0], n?: RequestInit) => Promise<Response>)(
        input,
        init,
      );
    }) as typeof fetch;

    const exportRow = await makeExport();
    await runSpotifyExportJob(db, logger, config, exportRow.id, { fetchFn: ambiguousFetch, sleep: async () => {} });
    let state = await getExportById(db, exportRow.id);
    expect(state!.status).toBe("needs_review");

    const resolutions = await listItemResolutions(db, exportRow.id);
    expect(resolutions.every((row) => row.status === "needs_confirmation")).toBe(true);

    // Confirm two, reject one; resume the job.
    await setResolutionStatus(db, exportRow.id, resolutions[0]!.recordingId, "confirmed");
    await setResolutionStatus(db, exportRow.id, resolutions[1]!.recordingId, "confirmed");
    await setResolutionStatus(db, exportRow.id, resolutions[2]!.recordingId, "rejected");
    await updateExport(db, exportRow.id, { status: "requested" });
    await runSpotifyExportJob(db, logger, config, exportRow.id, { fetchFn: ambiguousFetch, sleep: async () => {} });

    state = await getExportById(db, exportRow.id);
    expect(state!.status).toBe("completed");
    expect(state!.insertedCount).toBe(2);
    expect(state!.skippedCount).toBe(1); // rejected track stays canonical
  });

  it("a timeout during item insertion is ambiguous — no blind replay", async () => {
    const timeoutOnInsert = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      if (/\/v1\/playlists\/.+\/tracks/.test(url)) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("timed out", "TimeoutError")),
          );
        });
      }
      return (happySpotifyFetch() as (i: Parameters<typeof fetch>[0], n?: RequestInit) => Promise<Response>)(
        input,
        init,
      );
    }) as typeof fetch;

    const exportRow = await makeExport();
    await runSpotifyExportJob(db, logger, config, exportRow.id, {
      fetchFn: timeoutOnInsert,
      sleep: async () => {},
      timeoutMs: 100,
    });
    const state = await getExportById(db, exportRow.id);
    expect(state!.status).toBe("ambiguous");
    expect(state!.errorCode).toBe("ambiguous_network_completion");
    // The job refuses to touch an ambiguous export again without a user decision.
    await runSpotifyExportJob(db, logger, config, exportRow.id, { fetchFn: happySpotifyFetch(), sleep: async () => {} });
    expect((await getExportById(db, exportRow.id))!.status).toBe("ambiguous");
  });

  it("invalid_grant during refresh marks the connection expired and requires reauthorization", async () => {
    // Force refresh by expiring the stored access token.
    await db
      .update(encryptedOauthCredentials)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(encryptedOauthCredentials.connectionId, connectionId));

    const invalidGrantFetch = ((input: Parameters<typeof fetch>[0]) => {
      if (String(input).includes("/api/token")) {
        return Promise.resolve(jsonResponse({ error: "invalid_grant" }, { status: 400 }));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    }) as typeof fetch;

    const exportRow = await makeExport();
    await runSpotifyExportJob(db, logger, config, exportRow.id, {
      fetchFn: invalidGrantFetch,
      sleep: async () => {},
    });
    const state = await getExportById(db, exportRow.id);
    expect(state!.status).toBe("authorization_required");
    expect(state!.errorCode).toBe("invalid_grant");

    const { getOwnConnection } = await import("@resonance/db");
    const connection = await getOwnConnection(db, userId, connectionId);
    expect(connection!.status).toBe("expired");
  });

  it("recommendation output is byte-for-byte identical with or without a Spotify connection", async () => {
    const bare = await db
      .insert(users)
      .values({ emailNormalized: `spx-clean-${RUN}@example.test` })
      .returning({ id: users.id });
    const cleanUserId = bare[0]!.id;
    await insertSeeds(db, cleanUserId, [
      { entityType: "artist", artistId: artistUuid(0), sentiment: "strong_positive", strength: 1 },
      { entityType: "artist", artistId: artistUuid(1), sentiment: "positive", strength: 0.8 },
    ]);

    const seed = `byte4byte-${RUN}`;
    const runA = await createRecommendationRun(db, {
      userId: cleanUserId,
      contextId: null,
      requestedCount: 20,
      discoveryLevel: 50,
      randomSeed: seed,
    });
    await runRecommendationJob(db, logger, runA.id);
    const itemsBefore = await listRunItems(db, runA.id);

    // Now the user connects Spotify — recommendations must not change.
    await activateConnection(db, {
      userId: cleanUserId,
      service: "spotify",
      scopeSet: ["playlist-modify-private"],
      accessToken: cipher.encrypt("clean-user-token"),
      refreshToken: null,
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      reauthorizationDueAt: new Date(Date.now() + 150 * 24 * 3600_000),
    });
    const runB = await createRecommendationRun(db, {
      userId: cleanUserId,
      contextId: null,
      requestedCount: 20,
      discoveryLevel: 50,
      randomSeed: seed,
    });
    await runRecommendationJob(db, logger, runB.id);
    const itemsAfter = await listRunItems(db, runB.id);

    expect(JSON.stringify(itemsAfter.map((item) => ({ r: item.recording.id, p: item.position })))).toBe(
      JSON.stringify(itemsBefore.map((item) => ({ r: item.recording.id, p: item.position }))),
    );
  });

  it("feature flag off fails the export closed", async () => {
    const exportRow = await makeExport();
    await runSpotifyExportJob(
      db,
      logger,
      { ...config, featureSpotifyExport: false },
      exportRow.id,
      { fetchFn: happySpotifyFetch(), sleep: async () => {} },
    );
    expect((await getExportById(db, exportRow.id))!.status).toBe("failed");
    expect((await getExportById(db, exportRow.id))!.errorCode).toBe("feature_disabled");
  });

});
