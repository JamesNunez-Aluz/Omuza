import type { ExportResolution } from "./types.js";

/**
 * Export-only Spotify destination adapter (spec §6.2, ADR 0002).
 *
 * Milestone 0 ships a disabled skeleton: every method enforces the kill
 * switch and no network call exists anywhere in this package. Real OAuth,
 * temporary track resolution, and playlist export arrive in Milestone 4
 * behind this same surface, after the platform-policy review gate (§6.4).
 *
 * This adapter must never gain methods that read listening history, saved
 * items, top items, playlists, audio features, or recommendations.
 */

export class SpotifyExportDisabledError extends Error {
  constructor() {
    super("Spotify export is disabled (FEATURE_SPOTIFY_EXPORT=false)");
    this.name = "SpotifyExportDisabledError";
  }
}

export interface SpotifyAdapterOptions {
  /** Kill switch — wired from config; the core product works when false. */
  exportEnabled: boolean;
}

export class SpotifyDestinationAdapter {
  readonly destination = "spotify" as const;

  constructor(private readonly options: SpotifyAdapterOptions) {}

  private assertEnabled(): void {
    if (!this.options.exportEnabled) {
      throw new SpotifyExportDisabledError();
    }
  }

  async beginConnection(): Promise<never> {
    this.assertEnabled();
    throw new Error("Spotify OAuth is implemented in Milestone 4");
  }

  async resolveRecordings(): Promise<ExportResolution[]> {
    this.assertEnabled();
    throw new Error("Spotify track resolution is implemented in Milestone 4");
  }

  async exportPlaylist(): Promise<never> {
    this.assertEnabled();
    throw new Error("Spotify playlist export is implemented in Milestone 4");
  }

  async disconnect(): Promise<void> {
    // Disconnect must always work, even with export disabled, so users can
    // sever a connection and trigger purge regardless of feature flags.
    return;
  }
}
