import { describe, expect, it } from "vitest";

import { SpotifyDestinationAdapter, SpotifyExportDisabledError } from "./adapter.js";

describe("SpotifyDestinationAdapter kill switch", () => {
  const disabled = new SpotifyDestinationAdapter({ exportEnabled: false });

  it("blocks every export-path method when FEATURE_SPOTIFY_EXPORT is false", async () => {
    await expect(disabled.beginConnection()).rejects.toThrow(SpotifyExportDisabledError);
    await expect(disabled.resolveRecordings()).rejects.toThrow(SpotifyExportDisabledError);
    await expect(disabled.exportPlaylist()).rejects.toThrow(SpotifyExportDisabledError);
  });

  it("always allows disconnect so purge is never blocked by a feature flag", async () => {
    await expect(disabled.disconnect()).resolves.toBeUndefined();
  });

  it("has no real export behavior yet even when enabled (Milestone 4)", async () => {
    const enabled = new SpotifyDestinationAdapter({ exportEnabled: true });
    await expect(enabled.exportPlaylist()).rejects.toThrow(/Milestone 4/);
  });
});
