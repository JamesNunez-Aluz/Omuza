import { and, desc, eq, lt } from "drizzle-orm";

import type { Database } from "../client.js";
import { exportItemResolutions, exports, oauthTransactions } from "../schema.js";

export type ExportRow = typeof exports.$inferSelect;
export type ExportItemResolutionRow = typeof exportItemResolutions.$inferSelect;

/** Idempotent creation: unique (user, destination, key) replays the original. */
export async function createOrGetExport(
  db: Database,
  input: {
    userId: string;
    playlistId: string;
    destination: "spotify";
    connectionId: string;
    idempotencyKey: string;
    itemCount: number;
  },
): Promise<{ export: ExportRow; created: boolean }> {
  const inserted = await db
    .insert(exports)
    .values(input)
    .onConflictDoNothing({
      target: [exports.userId, exports.destination, exports.idempotencyKey],
    })
    .returning();
  if (inserted[0]) return { export: inserted[0], created: true };
  const existing = await db
    .select()
    .from(exports)
    .where(
      and(
        eq(exports.userId, input.userId),
        eq(exports.destination, input.destination),
        eq(exports.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  return { export: existing[0]!, created: false };
}

export async function getExport(db: Database, userId: string, exportId: string): Promise<ExportRow | undefined> {
  const rows = await db
    .select()
    .from(exports)
    .where(and(eq(exports.id, exportId), eq(exports.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function getExportById(db: Database, exportId: string): Promise<ExportRow | undefined> {
  const rows = await db.select().from(exports).where(eq(exports.id, exportId)).limit(1);
  return rows[0];
}

export async function updateExport(
  db: Database,
  exportId: string,
  patch: Partial<{
    status: string;
    destinationPlaylistId: string;
    destinationUrl: string | null;
    supersededByExportId: string;
    completedAt: Date;
    itemCount: number;
    resolvedCount: number;
    insertedCount: number;
    skippedCount: number;
    failedCount: number;
    errorCode: string | null;
  }>,
): Promise<void> {
  await db
    .update(exports)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(exports.id, exportId));
}

export async function upsertItemResolution(
  db: Database,
  input: {
    exportId: string;
    recordingId: string;
    destinationItemId?: string | null;
    destinationUri?: string | null;
    matchMethod?: string | null;
    confidence?: number | null;
    status: string;
    temporaryDisplayTitle?: string | null;
    temporaryDisplayArtist?: string | null;
    ttlHours?: number;
  },
): Promise<void> {
  const expiresAt = new Date(Date.now() + (input.ttlHours ?? 24) * 3_600_000);
  await db
    .insert(exportItemResolutions)
    .values({
      exportId: input.exportId,
      recordingId: input.recordingId,
      destinationItemId: input.destinationItemId ?? null,
      destinationUri: input.destinationUri ?? null,
      matchMethod: input.matchMethod ?? null,
      confidence: input.confidence ?? null,
      status: input.status,
      temporaryDisplayTitle: input.temporaryDisplayTitle ?? null,
      temporaryDisplayArtist: input.temporaryDisplayArtist ?? null,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [exportItemResolutions.exportId, exportItemResolutions.recordingId],
      set: {
        destinationItemId: input.destinationItemId ?? null,
        destinationUri: input.destinationUri ?? null,
        matchMethod: input.matchMethod ?? null,
        confidence: input.confidence ?? null,
        status: input.status,
        temporaryDisplayTitle: input.temporaryDisplayTitle ?? null,
        temporaryDisplayArtist: input.temporaryDisplayArtist ?? null,
        expiresAt,
        updatedAt: new Date(),
      },
    });
}

export async function listItemResolutions(
  db: Database,
  exportId: string,
): Promise<ExportItemResolutionRow[]> {
  return db
    .select()
    .from(exportItemResolutions)
    .where(eq(exportItemResolutions.exportId, exportId))
    .orderBy(exportItemResolutions.createdAt);
}

export async function setResolutionStatus(
  db: Database,
  exportId: string,
  recordingId: string,
  status: "confirmed" | "rejected",
): Promise<boolean> {
  const rows = await db
    .update(exportItemResolutions)
    .set({ status, matchMethod: "manual", updatedAt: new Date() })
    .where(
      and(
        eq(exportItemResolutions.exportId, exportId),
        eq(exportItemResolutions.recordingId, recordingId),
        eq(exportItemResolutions.status, "needs_confirmation"),
      ),
    )
    .returning({ id: exportItemResolutions.id });
  return rows.length > 0;
}

export async function listExportsForPlaylist(
  db: Database,
  userId: string,
  playlistId: string,
): Promise<ExportRow[]> {
  return db
    .select()
    .from(exports)
    .where(and(eq(exports.userId, userId), eq(exports.playlistId, playlistId)))
    .orderBy(desc(exports.requestedAt));
}

/**
 * Purge expired destination data (spec §6.5, run by
 * scripts/purge-expired-provider-data.ts and schedulable later).
 */
export async function purgeExpiredDestinationData(
  db: Database,
): Promise<{ resolutions: number; oauthTransactions: number }> {
  const purgedResolutions = await db
    .delete(exportItemResolutions)
    .where(lt(exportItemResolutions.expiresAt, new Date()))
    .returning({ id: exportItemResolutions.id });
  const purgedTransactions = await db
    .delete(oauthTransactions)
    .where(lt(oauthTransactions.expiresAt, new Date()))
    .returning({ id: oauthTransactions.id });
  return { resolutions: purgedResolutions.length, oauthTransactions: purgedTransactions.length };
}
