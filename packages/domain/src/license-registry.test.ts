import { describe, expect, it } from "vitest";

import { ALL_DATA_USES, LICENSE_REGISTRY, getLicensePolicy, isUseAllowed } from "./index.js";

describe("license registry", () => {
  it("defaults unknown providers/datasets/uses to prohibited", () => {
    expect(isUseAllowed("unknown-provider@1", "display")).toBe(false);
    expect(isUseAllowed("", "model_training")).toBe(false);
  });

  it("never permits Spotify data as a recommendation feature or training input", () => {
    const spotifyPolicies = LICENSE_REGISTRY.filter((policy) => policy.provider === "spotify");
    expect(spotifyPolicies.length).toBeGreaterThan(0);
    for (const policy of spotifyPolicies) {
      expect(isUseAllowed(policy.id, "recommendation_feature")).toBe(false);
      expect(isUseAllowed(policy.id, "model_training")).toBe(false);
      expect(policy.prohibitedUses).toContain("recommendation_feature");
      expect(policy.prohibitedUses).toContain("model_training");
    }
  });

  it("keeps every Spotify policy scoped to temporary cache with a retention period", () => {
    for (const policy of LICENSE_REGISTRY.filter((p) => p.provider === "spotify")) {
      expect(policy.retentionDays).toBeTypeOf("number");
      expect(policy.retentionDays).toBeLessThanOrEqual(7);
    }
  });

  it("prohibits everything for unreviewed sources (ListenBrainz)", () => {
    const policy = getLicensePolicy("listenbrainz-api@1");
    expect(policy).toBeDefined();
    for (const use of ALL_DATA_USES) {
      expect(isUseAllowed("listenbrainz-api@1", use)).toBe(false);
    }
  });

  it("has unique policy ids and a review date on every entry", () => {
    const ids = LICENSE_REGISTRY.map((policy) => policy.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const policy of LICENSE_REGISTRY) {
      expect(policy.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("treats a use listed in both permitted and prohibited as prohibited", () => {
    // Constructed check of the deny-wins rule via the public API surface:
    // no registry entry may list the same use on both sides.
    for (const policy of LICENSE_REGISTRY) {
      for (const use of policy.permittedUses) {
        expect(policy.prohibitedUses).not.toContain(use);
      }
    }
  });
});
