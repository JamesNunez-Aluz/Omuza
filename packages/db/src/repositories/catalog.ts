import { createHash } from "node:crypto";

import { and, eq, gt, inArray } from "drizzle-orm";

import type { Database } from "../client.js";
import {
  artists,
  catalogSearchCache,
  catalogSourceRecords,
  recordingArtists,
  recordings,
} from "../schema.js";

/**
 * Catalog ingestion and lookup. Every upsert records provenance + license
 * policy on the row and source lineage (hash only, no payloads) in
 * catalog_source_records (spec §8.4, §9.3).
 */

export interface CanonicalArtistInput {
  mbid: string;
  name: string;
  sortName?: string;
  disambiguation?: string;
  countryCode?: string;
  beginDate?: string;
  endDate?: string;
  licensePolicyId: string;
}

export interface ArtistRow {
  id: string;
  canonicalMbid: string | null;
  name: string;
  disambiguation: string | null;
}

export async function upsertArtistByMbid(db: Database, input: CanonicalArtistInput): Promise<ArtistRow> {
  const rows = await db
    .insert(artists)
    .values({
      canonicalMbid: input.mbid,
      name: input.name,
      sortName: input.sortName ?? null,
      disambiguation: input.disambiguation ?? null,
      countryCode: input.countryCode ?? null,
      beginDate: input.beginDate ?? null,
      endDate: input.endDate ?? null,
      provenanceProvider: "musicbrainz",
      licensePolicyId: input.licensePolicyId,
    })
    .onConflictDoUpdate({
      target: artists.canonicalMbid,
      set: {
        name: input.name,
        sortName: input.sortName ?? null,
        disambiguation: input.disambiguation ?? null,
        countryCode: input.countryCode ?? null,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: artists.id,
      canonicalMbid: artists.canonicalMbid,
      name: artists.name,
      disambiguation: artists.disambiguation,
    });
  await recordSourceLineage(db, "musicbrainz", "artist", input.mbid, input, input.licensePolicyId);
  return rows[0]!;
}

export interface CanonicalRecordingInput {
  mbid: string;
  title: string;
  durationMs?: number;
  disambiguation?: string;
  firstReleaseDate?: string;
  licensePolicyId: string;
  credits: {
    artistId: string;
    creditName: string;
    position: number;
    joinPhrase?: string;
  }[];
}

export interface RecordingRow {
  id: string;
  canonicalMbid: string | null;
  title: string;
  disambiguation: string | null;
}

export async function upsertRecordingByMbid(
  db: Database,
  input: CanonicalRecordingInput,
): Promise<RecordingRow> {
  return db.transaction(async (tx) => {
    const primary = input.credits[0];
    if (!primary) {
      throw new Error("recording requires at least one artist credit");
    }
    const rows = await tx
      .insert(recordings)
      .values({
        canonicalMbid: input.mbid,
        title: input.title,
        primaryArtistId: primary.artistId,
        durationMs: input.durationMs ?? null,
        disambiguation: input.disambiguation ?? null,
        firstReleaseDate: input.firstReleaseDate ?? null,
        provenanceProvider: "musicbrainz",
        licensePolicyId: input.licensePolicyId,
      })
      .onConflictDoUpdate({
        target: recordings.canonicalMbid,
        set: {
          title: input.title,
          durationMs: input.durationMs ?? null,
          disambiguation: input.disambiguation ?? null,
          firstReleaseDate: input.firstReleaseDate ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: recordings.id,
        canonicalMbid: recordings.canonicalMbid,
        title: recordings.title,
        disambiguation: recordings.disambiguation,
      });
    const recording = rows[0]!;

    await tx.delete(recordingArtists).where(eq(recordingArtists.recordingId, recording.id));
    await tx.insert(recordingArtists).values(
      input.credits.map((credit) => ({
        recordingId: recording.id,
        artistId: credit.artistId,
        creditName: credit.creditName,
        position: credit.position,
        joinPhrase: credit.joinPhrase ?? null,
      })),
    );

    await recordSourceLineage(tx, "musicbrainz", "recording", input.mbid, input, input.licensePolicyId);
    return recording;
  });
}

async function recordSourceLineage(
  db: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
  provider: string,
  entityType: "artist" | "recording",
  externalId: string,
  content: unknown,
  licensePolicyId: string,
): Promise<void> {
  const contentHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  await db
    .insert(catalogSourceRecords)
    .values({ provider, entityType, externalId, contentHash, licensePolicyId })
    .onConflictDoUpdate({
      target: [catalogSourceRecords.provider, catalogSourceRecords.entityType, catalogSourceRecords.externalId],
      set: { contentHash, fetchedAt: new Date() },
    });
}

export function searchCacheKey(query: string): string {
  return createHash("sha256").update(query).digest("hex");
}

export async function getCachedSearch(db: Database, query: string): Promise<unknown | undefined> {
  const rows = await db
    .select({ response: catalogSearchCache.response })
    .from(catalogSearchCache)
    .where(
      and(eq(catalogSearchCache.queryHash, searchCacheKey(query)), gt(catalogSearchCache.expiresAt, new Date())),
    )
    .limit(1);
  return rows[0]?.response;
}

export async function putCachedSearch(
  db: Database,
  query: string,
  response: unknown,
  ttlSeconds: number,
): Promise<void> {
  await db
    .insert(catalogSearchCache)
    .values({
      queryHash: searchCacheKey(query),
      query,
      response,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    })
    .onConflictDoUpdate({
      target: catalogSearchCache.queryHash,
      set: { response, fetchedAt: new Date(), expiresAt: new Date(Date.now() + ttlSeconds * 1000) },
    });
}

export interface SeedEntitySummary {
  id: string;
  name: string;
  entityType: "artist" | "recording";
  disambiguation: string | null;
}

/** Resolve entity ids to display summaries (for review screens and exports). */
export async function findSeedEntities(
  db: Database,
  artistIds: string[],
  recordingIds: string[],
): Promise<SeedEntitySummary[]> {
  const results: SeedEntitySummary[] = [];
  if (artistIds.length > 0) {
    const artistRows = await db
      .select({ id: artists.id, name: artists.name, disambiguation: artists.disambiguation })
      .from(artists)
      .where(inArray(artists.id, artistIds));
    results.push(...artistRows.map((row) => ({ ...row, entityType: "artist" as const })));
  }
  if (recordingIds.length > 0) {
    const recordingRows = await db
      .select({ id: recordings.id, name: recordings.title, disambiguation: recordings.disambiguation })
      .from(recordings)
      .where(inArray(recordings.id, recordingIds));
    results.push(...recordingRows.map((row) => ({ ...row, entityType: "recording" as const })));
  }
  return results;
}

export async function artistExists(db: Database, id: string): Promise<boolean> {
  const rows = await db.select({ id: artists.id }).from(artists).where(eq(artists.id, id)).limit(1);
  return rows.length > 0;
}

export async function recordingExists(db: Database, id: string): Promise<boolean> {
  const rows = await db.select({ id: recordings.id }).from(recordings).where(eq(recordings.id, id)).limit(1);
  return rows.length > 0;
}
