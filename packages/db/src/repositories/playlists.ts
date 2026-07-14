import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import {
  playlistItems,
  playlists,
  recommendationExplanations,
  recommendationItems,
  recordingArtists,
  recordingExternalIds,
  recordings,
} from "../schema.js";

export type PlaylistRow = typeof playlists.$inferSelect;

export async function createPlaylistFromRun(
  db: Database,
  input: {
    userId: string;
    name: string;
    description?: string | null;
    contextId?: string | null;
    sourceRunId: string;
  },
): Promise<PlaylistRow> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(playlists)
      .values({
        userId: input.userId,
        name: input.name,
        description: input.description ?? null,
        contextId: input.contextId ?? null,
        sourceRunId: input.sourceRunId,
      })
      .returning();
    const playlist = rows[0]!;

    const items = await tx
      .select({
        recordingId: recommendationItems.recordingId,
        position: recommendationItems.position,
        id: recommendationItems.id,
      })
      .from(recommendationItems)
      .where(eq(recommendationItems.runId, input.sourceRunId))
      .orderBy(asc(recommendationItems.position));

    if (items.length > 0) {
      await tx.insert(playlistItems).values(
        items.map((item) => ({
          playlistId: playlist.id,
          recordingId: item.recordingId,
          position: item.position,
          sourceRecommendationItemId: item.id,
        })),
      );
    }
    return playlist;
  });
}

export async function getPlaylist(
  db: Database,
  userId: string,
  playlistId: string,
): Promise<PlaylistRow | undefined> {
  const rows = await db
    .select()
    .from(playlists)
    .where(
      and(eq(playlists.id, playlistId), eq(playlists.userId, userId), eq(playlists.status, "active")),
    )
    .limit(1);
  return rows[0];
}

export async function listPlaylists(db: Database, userId: string): Promise<PlaylistRow[]> {
  return db
    .select()
    .from(playlists)
    .where(and(eq(playlists.userId, userId), eq(playlists.status, "active")))
    .orderBy(desc(playlists.createdAt));
}

/** Optimistic concurrency: update succeeds only at the expected version. */
export async function updatePlaylist(
  db: Database,
  userId: string,
  playlistId: string,
  expectedVersion: number,
  patch: { name?: string; description?: string | null },
): Promise<PlaylistRow | "conflict" | undefined> {
  const existing = await getPlaylist(db, userId, playlistId);
  if (!existing) return undefined;
  const rows = await db
    .update(playlists)
    .set({ ...patch, version: sql`${playlists.version} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(playlists.id, playlistId),
        eq(playlists.userId, userId),
        eq(playlists.version, expectedVersion),
      ),
    )
    .returning();
  return rows[0] ?? "conflict";
}

export async function softDeletePlaylist(db: Database, userId: string, playlistId: string): Promise<boolean> {
  const rows = await db
    .update(playlists)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(
      and(eq(playlists.id, playlistId), eq(playlists.userId, userId), eq(playlists.status, "active")),
    )
    .returning({ id: playlists.id });
  return rows.length > 0;
}

export interface PlaylistItemView {
  id: string;
  position: number;
  sourceRecommendationItemId: string | null;
  recording: {
    id: string;
    title: string;
    canonicalMbid: string | null;
    durationMs: number | null;
    firstReleaseDate: string | null;
    isrc: string | null;
    artists: { id: string; name: string }[];
  };
}

export async function listPlaylistItems(db: Database, playlistId: string): Promise<PlaylistItemView[]> {
  const items = await db
    .select({
      id: playlistItems.id,
      position: playlistItems.position,
      sourceRecommendationItemId: playlistItems.sourceRecommendationItemId,
      recordingId: playlistItems.recordingId,
      title: recordings.title,
      canonicalMbid: recordings.canonicalMbid,
      durationMs: recordings.durationMs,
      firstReleaseDate: recordings.firstReleaseDate,
    })
    .from(playlistItems)
    .innerJoin(recordings, eq(playlistItems.recordingId, recordings.id))
    .where(and(eq(playlistItems.playlistId, playlistId), isNull(playlistItems.removedAt)))
    .orderBy(asc(playlistItems.position));
  if (items.length === 0) return [];

  const recordingIds = items.map((item) => item.recordingId);
  const credits = await db
    .select({
      recordingId: recordingArtists.recordingId,
      artistId: recordingArtists.artistId,
      creditName: recordingArtists.creditName,
      position: recordingArtists.position,
    })
    .from(recordingArtists)
    .where(inArray(recordingArtists.recordingId, recordingIds))
    .orderBy(asc(recordingArtists.position));
  const isrcs = await db
    .select({ recordingId: recordingExternalIds.recordingId, externalId: recordingExternalIds.externalId })
    .from(recordingExternalIds)
    .where(
      and(inArray(recordingExternalIds.recordingId, recordingIds), eq(recordingExternalIds.idType, "isrc")),
    );

  const creditsByRecording = new Map<string, { id: string; name: string }[]>();
  for (const credit of credits) {
    const list = creditsByRecording.get(credit.recordingId) ?? [];
    list.push({ id: credit.artistId, name: credit.creditName });
    creditsByRecording.set(credit.recordingId, list);
  }
  const isrcByRecording = new Map(isrcs.map((row) => [row.recordingId, row.externalId]));

  return items.map((item) => ({
    id: item.id,
    position: item.position,
    sourceRecommendationItemId: item.sourceRecommendationItemId,
    recording: {
      id: item.recordingId,
      title: item.title,
      canonicalMbid: item.canonicalMbid,
      durationMs: item.durationMs,
      firstReleaseDate: item.firstReleaseDate,
      isrc: isrcByRecording.get(item.recordingId) ?? null,
      artists: creditsByRecording.get(item.recordingId) ?? [],
    },
  }));
}

/** Novelty + explanation lineage for exported items (spec §13.10 CSV columns). */
export async function loadItemLineage(
  db: Database,
  sourceItemIds: string[],
): Promise<Map<string, { noveltyState: string; explanation: string | null }>> {
  if (sourceItemIds.length === 0) return new Map();
  const items = await db
    .select({ id: recommendationItems.id, noveltyState: recommendationItems.noveltyState })
    .from(recommendationItems)
    .where(inArray(recommendationItems.id, sourceItemIds));
  const explanations = await db
    .select({
      itemId: recommendationExplanations.itemId,
      renderedText: recommendationExplanations.renderedText,
    })
    .from(recommendationExplanations)
    .where(inArray(recommendationExplanations.itemId, sourceItemIds));
  const explanationByItem = new Map(explanations.map((row) => [row.itemId, row.renderedText]));
  return new Map(
    items.map((item) => [
      item.id,
      { noveltyState: item.noveltyState, explanation: explanationByItem.get(item.id) ?? null },
    ]),
  );
}

export async function removePlaylistItem(
  db: Database,
  userId: string,
  playlistId: string,
  itemId: string,
): Promise<boolean> {
  const playlist = await getPlaylist(db, userId, playlistId);
  if (!playlist) return false;
  const rows = await db
    .update(playlistItems)
    .set({ removedAt: new Date() })
    .where(
      and(
        eq(playlistItems.id, itemId),
        eq(playlistItems.playlistId, playlistId),
        isNull(playlistItems.removedAt),
      ),
    )
    .returning({ id: playlistItems.id });
  return rows.length > 0;
}

export async function reorderPlaylistItems(
  db: Database,
  userId: string,
  playlistId: string,
  orderedItemIds: string[],
): Promise<boolean> {
  const playlist = await getPlaylist(db, userId, playlistId);
  if (!playlist) return false;
  const current = await listPlaylistItems(db, playlistId);
  const currentIds = new Set(current.map((item) => item.id));
  if (
    orderedItemIds.length !== current.length ||
    !orderedItemIds.every((id) => currentIds.has(id))
  ) {
    return false;
  }
  await db.transaction(async (tx) => {
    // Two-phase to avoid transient position collisions.
    for (const [index, itemId] of orderedItemIds.entries()) {
      await tx
        .update(playlistItems)
        .set({ position: 10000 + index })
        .where(eq(playlistItems.id, itemId));
    }
    for (const [index, itemId] of orderedItemIds.entries()) {
      await tx
        .update(playlistItems)
        .set({ position: index + 1 })
        .where(eq(playlistItems.id, itemId));
    }
    await tx
      .update(playlists)
      .set({ version: sql`${playlists.version} + 1`, updatedAt: new Date() })
      .where(eq(playlists.id, playlistId));
  });
  return true;
}

/**
 * Rebuild a playlist from a new run, preserving explicitly kept recordings
 * (spec §5.5). Kept items retain their rows/lineage; everything else is
 * soft-removed and the new run's items are appended after the kept ones.
 */
export async function rebuildPlaylistFromRun(
  db: Database,
  userId: string,
  playlistId: string,
  runId: string,
  preserveRecordingIds: string[],
): Promise<boolean> {
  const playlist = await getPlaylist(db, userId, playlistId);
  if (!playlist) return false;

  return db.transaction(async (tx) => {
    const current = await tx
      .select({
        id: playlistItems.id,
        recordingId: playlistItems.recordingId,
      })
      .from(playlistItems)
      .where(and(eq(playlistItems.playlistId, playlistId), isNull(playlistItems.removedAt)))
      .orderBy(asc(playlistItems.position));

    const preserve = new Set(preserveRecordingIds);
    const kept = current.filter((item) => preserve.has(item.recordingId));
    const dropped = current.filter((item) => !preserve.has(item.recordingId));

    if (dropped.length > 0) {
      await tx
        .update(playlistItems)
        .set({ removedAt: new Date() })
        .where(
          inArray(
            playlistItems.id,
            dropped.map((item) => item.id),
          ),
        );
    }
    for (const [index, item] of kept.entries()) {
      await tx.update(playlistItems).set({ position: index + 1 }).where(eq(playlistItems.id, item.id));
    }

    const runItems = await tx
      .select({
        recordingId: recommendationItems.recordingId,
        id: recommendationItems.id,
        position: recommendationItems.position,
      })
      .from(recommendationItems)
      .where(eq(recommendationItems.runId, runId))
      .orderBy(asc(recommendationItems.position));

    const keptRecordingIds = new Set(kept.map((item) => item.recordingId));
    const additions = runItems.filter((item) => !keptRecordingIds.has(item.recordingId));
    if (additions.length > 0) {
      await tx.insert(playlistItems).values(
        additions.map((item, index) => ({
          playlistId,
          recordingId: item.recordingId,
          position: kept.length + index + 1,
          sourceRecommendationItemId: item.id,
        })),
      );
    }

    await tx
      .update(playlists)
      .set({ version: sql`${playlists.version} + 1`, updatedAt: new Date() })
      .where(eq(playlists.id, playlistId));
    return true;
  });
}
