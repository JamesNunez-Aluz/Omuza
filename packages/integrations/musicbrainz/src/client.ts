/**
 * MusicBrainz adapter skeleton. Real lookups, the 1 req/s rate limiter,
 * caching, retries, and contract tests arrive in Milestone 1 (catalog
 * ingestion). Milestone 0 ships no network behavior — default test runs must
 * not call external providers.
 *
 * License posture: core data under `musicbrainz-core@1` (CC0); supplementary
 * tags/ratings are `musicbrainz-supplementary@1` and are NOT commercially
 * usable (see packages/domain/src/license-registry.ts).
 */

export interface MusicBrainzClientOptions {
  /** Required by MusicBrainz etiquette; set in Milestone 1. */
  userAgent?: string;
}

export interface MusicBrainzHealth {
  status: "not_configured";
  detail: string;
}

export class MusicBrainzClient {
  constructor(private readonly options: MusicBrainzClientOptions = {}) {}

  async healthCheck(): Promise<MusicBrainzHealth> {
    return {
      status: "not_configured",
      detail: this.options.userAgent
        ? "MusicBrainz lookups are implemented in Milestone 1"
        : "MusicBrainz client has no user agent configured; lookups are implemented in Milestone 1",
    };
  }
}
