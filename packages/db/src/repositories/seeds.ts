import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../client.js";
import { userSeedItems } from "../schema.js";

export interface SeedInput {
  entityType: "artist" | "recording";
  artistId?: string;
  recordingId?: string;
  sentiment: string;
  strength: number;
  contextId?: string | null;
}

export interface SeedRow {
  id: string;
  entityType: string;
  artistId: string | null;
  recordingId: string | null;
  sentiment: string;
  strength: string;
  contextId: string | null;
  declaredAt: Date;
}

const seedColumns = {
  id: userSeedItems.id,
  entityType: userSeedItems.entityType,
  artistId: userSeedItems.artistId,
  recordingId: userSeedItems.recordingId,
  sentiment: userSeedItems.sentiment,
  strength: userSeedItems.strength,
  contextId: userSeedItems.contextId,
  declaredAt: userSeedItems.declaredAt,
};

export async function insertSeeds(db: Database, userId: string, items: SeedInput[]): Promise<SeedRow[]> {
  return db
    .insert(userSeedItems)
    .values(
      items.map((item) => ({
        userId,
        entityType: item.entityType,
        artistId: item.artistId ?? null,
        recordingId: item.recordingId ?? null,
        sentiment: item.sentiment,
        strength: item.strength.toFixed(2),
        contextId: item.contextId ?? null,
      })),
    )
    .returning(seedColumns);
}

export async function listActiveSeeds(db: Database, userId: string): Promise<SeedRow[]> {
  return db
    .select(seedColumns)
    .from(userSeedItems)
    .where(and(eq(userSeedItems.userId, userId), isNull(userSeedItems.removedAt)))
    .orderBy(userSeedItems.declaredAt);
}

/** User-scoped update (IDOR-safe: the WHERE clause includes userId). */
export async function updateSeed(
  db: Database,
  userId: string,
  seedId: string,
  patch: { sentiment?: string; strength?: number; contextId?: string | null },
): Promise<SeedRow | undefined> {
  const set: Record<string, unknown> = {};
  if (patch.sentiment !== undefined) set.sentiment = patch.sentiment;
  if (patch.strength !== undefined) set.strength = patch.strength.toFixed(2);
  if (patch.contextId !== undefined) set.contextId = patch.contextId;
  const rows = await db
    .update(userSeedItems)
    .set(set)
    .where(
      and(eq(userSeedItems.id, seedId), eq(userSeedItems.userId, userId), isNull(userSeedItems.removedAt)),
    )
    .returning(seedColumns);
  return rows[0];
}

/** Soft delete preserves the declaration history (append-only evidence). */
export async function softDeleteSeed(db: Database, userId: string, seedId: string): Promise<boolean> {
  const rows = await db
    .update(userSeedItems)
    .set({ removedAt: new Date() })
    .where(
      and(eq(userSeedItems.id, seedId), eq(userSeedItems.userId, userId), isNull(userSeedItems.removedAt)),
    )
    .returning({ id: userSeedItems.id });
  return rows.length > 0;
}
