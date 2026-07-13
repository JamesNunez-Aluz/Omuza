/**
 * Spotify-facing types are LOCAL to this package (spec §6.2 control 3).
 * Nothing outside packages/integrations/spotify may reference raw Spotify
 * payload shapes; the only thing that crosses the boundary is
 * `ExportResolution`, and only toward export flows — never toward the
 * recommender, taste, analytics, or training code.
 */

/** Raw shapes stay internal. Placeholder until Milestone 4 implements OAuth/export. */
export interface SpotifyTrackSearchResult {
  uri: string;
  id: string;
  name: string;
  artistNames: string[];
  durationMs: number;
}

/**
 * The ONLY DTO allowed out of this package (spec §6.2 control 4).
 * Temporary by construction: `expiresAt` is mandatory and enforced by the
 * purge job; display fields exist solely for user review of an export match.
 */
export interface ExportResolution {
  canonicalRecordingId: string;
  destinationUri: string;
  destinationId: string;
  confidence: number;
  matchMethod: "isrc" | "metadata" | "manual";
  displayTitle: string;
  displayArtist: string;
  /** UTC ISO-8601; rows past expiry are purged. */
  expiresAt: string;
}
