import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

const validEnv = {
  DATABASE_URL: "postgres://resonance:synthetic@localhost:5432/resonance",
};

describe("loadConfig", () => {
  it("loads defaults with only DATABASE_URL provided", () => {
    const config = loadConfig(validEnv);
    expect(config.nodeEnv).toBe("development");
    expect(config.featureSpotifyExport).toBe(false);
    expect(config.webPort).toBe(3000);
  });

  it("defaults FEATURE_SPOTIFY_EXPORT to false (core works without Spotify)", () => {
    expect(loadConfig(validEnv).featureSpotifyExport).toBe(false);
    expect(
      loadConfig({ ...validEnv, FEATURE_SPOTIFY_EXPORT: "true" }).featureSpotifyExport,
    ).toBe(true);
  });

  it("rejects a missing or non-postgres DATABASE_URL without echoing values", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    try {
      loadConfig({ DATABASE_URL: "mysql://user:supersecret@host/db" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("supersecret");
    }
  });

  it("rejects invalid ports and log levels", () => {
    expect(() => loadConfig({ ...validEnv, WEB_PORT: "0" })).toThrow(/WEB_PORT/);
    expect(() => loadConfig({ ...validEnv, LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});
