import { isUseAllowed } from "@resonance/domain";
import {
  getCachedSearch,
  putCachedSearch,
  upsertArtistByMbid,
  upsertRecordingByMbid,
} from "@resonance/db";
import type { Database } from "@resonance/db";
import { MusicBrainzError } from "@resonance/musicbrainz";
import type { MusicBrainzClient } from "@resonance/musicbrainz";
import type { Logger } from "@resonance/observability";

/**
 * Catalog search (spec §13.3): query the provider, ingest results into the
 * canonical catalog with provenance + license policy, and answer with
 * disambiguation-carrying items. Responses are cached (provider etiquette)
 * and every displayed field is covered by an approved display license —
 * enforced here, not assumed.
 */

const MUSICBRAINZ_CORE_POLICY = "musicbrainz-core@1";
const SEARCH_CACHE_TTL_SECONDS = 24 * 3600;
const SOURCE_ATTRIBUTION = ["MusicBrainz"];

export interface CatalogSearchItem {
  entityType: "artist" | "recording";
  id: string;
  title: string;
  artists: { id: string | null; name: string }[];
  disambiguation: string | null;
  externalIdentity: { musicbrainzMbid: string | null };
  sourceAttribution: string[];
}

export interface CatalogSearchResult {
  items: CatalogSearchItem[];
  nextCursor: null;
  /** True when the provider failed and results may be incomplete. */
  degraded: boolean;
}

export async function searchCatalog(
  db: Database,
  musicbrainz: MusicBrainzClient,
  logger: Logger,
  input: { query: string; types: ("artist" | "recording")[]; limit: number },
): Promise<CatalogSearchResult> {
  if (!isUseAllowed(MUSICBRAINZ_CORE_POLICY, "display")) {
    // Registry misconfiguration: refuse to show unlicensed fields (spec §6.3).
    throw new Error("musicbrainz-core display license is not approved in the registry");
  }

  const cacheKey = `${input.types.sort().join(",")}|${input.limit}|${input.query.toLowerCase()}`;
  const cached = (await getCachedSearch(db, cacheKey)) as CatalogSearchResult | undefined;
  if (cached) return cached;

  const items: CatalogSearchItem[] = [];
  let degraded = false;

  if (input.types.includes("artist")) {
    try {
      const artists = await musicbrainz.searchArtists(input.query, input.limit);
      for (const artist of artists) {
        const row = await upsertArtistByMbid(db, {
          mbid: artist.mbid,
          name: artist.name,
          ...(artist.sortName !== undefined && { sortName: artist.sortName }),
          ...(artist.disambiguation !== undefined && { disambiguation: artist.disambiguation }),
          ...(artist.countryCode !== undefined && { countryCode: artist.countryCode }),
          ...(artist.beginDate !== undefined && { beginDate: artist.beginDate }),
          ...(artist.endDate !== undefined && { endDate: artist.endDate }),
          licensePolicyId: MUSICBRAINZ_CORE_POLICY,
        });
        items.push({
          entityType: "artist",
          id: row.id,
          title: row.name,
          artists: [],
          disambiguation: row.disambiguation,
          externalIdentity: { musicbrainzMbid: row.canonicalMbid },
          sourceAttribution: SOURCE_ATTRIBUTION,
        });
      }
    } catch (error) {
      degraded = true;
      logProviderFailure(logger, error, "artist");
    }
  }

  if (input.types.includes("recording")) {
    try {
      const recordings = await musicbrainz.searchRecordings(input.query, input.limit);
      for (const recording of recordings) {
        const credits = [];
        for (const [position, credit] of recording.credits.entries()) {
          const artistRow = await upsertArtistByMbid(db, {
            mbid: credit.artistMbid,
            name: credit.artistName,
            licensePolicyId: MUSICBRAINZ_CORE_POLICY,
          });
          credits.push({
            artistId: artistRow.id,
            creditName: credit.creditName,
            position,
            ...(credit.joinPhrase !== undefined && { joinPhrase: credit.joinPhrase }),
          });
        }
        const row = await upsertRecordingByMbid(db, {
          mbid: recording.mbid,
          title: recording.title,
          ...(recording.durationMs !== undefined && { durationMs: recording.durationMs }),
          ...(recording.disambiguation !== undefined && { disambiguation: recording.disambiguation }),
          ...(recording.firstReleaseDate !== undefined && {
            firstReleaseDate: recording.firstReleaseDate,
          }),
          licensePolicyId: MUSICBRAINZ_CORE_POLICY,
          credits,
        });
        items.push({
          entityType: "recording",
          id: row.id,
          title: row.title,
          artists: credits.map((credit) => ({ id: credit.artistId, name: credit.creditName })),
          disambiguation: row.disambiguation,
          externalIdentity: { musicbrainzMbid: row.canonicalMbid },
          sourceAttribution: SOURCE_ATTRIBUTION,
        });
      }
    } catch (error) {
      degraded = true;
      logProviderFailure(logger, error, "recording");
    }
  }

  const result: CatalogSearchResult = { items, nextCursor: null, degraded };
  if (!degraded) {
    await putCachedSearch(db, cacheKey, result, SEARCH_CACHE_TTL_SECONDS);
  }
  return result;
}

function logProviderFailure(logger: Logger, error: unknown, entity: string): void {
  if (error instanceof MusicBrainzError) {
    logger.warn({ provider: "musicbrainz", entity, kind: error.kind }, "catalog search degraded");
  } else {
    logger.error({ provider: "musicbrainz", entity }, "catalog search failed unexpectedly");
  }
}
