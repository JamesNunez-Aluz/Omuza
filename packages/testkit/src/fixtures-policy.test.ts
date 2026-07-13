import { assertTrainingEligible, isRecommendationEligible } from "@resonance/domain";
import { describe, expect, it } from "vitest";

import { loadCatalogFixtures, loadFeatureRowFixtures } from "./fixtures.js";

/**
 * Fixture policy gate (Milestone 0 acceptance): a deliberately model-eligible
 * Spotify feature fixture must cause a test failure. These tests scan every
 * fixture row, so adding such a row anywhere in feature-rows.json fails CI.
 */

describe("fixture policy", () => {
  it("contains a Spotify export-resolution fixture so the boundary is exercised", () => {
    const rows = loadFeatureRowFixtures();
    expect(rows.some((row) => row.provenance.provider === "spotify")).toBe(true);
  });

  it("never marks a Spotify-sourced fixture as training- or recommendation-eligible", () => {
    for (const row of loadFeatureRowFixtures()) {
      if (row.provenance.provider === "spotify") {
        expect(row.trainingEligible, `${row.feature} must not be training eligible`).toBe(false);
        expect(
          row.recommendationEligible,
          `${row.feature} must not be recommendation eligible`,
        ).toBe(false);
        expect(isRecommendationEligible(row)).toBe(false);
      }
    }
  });

  it("rejects the full fixture set as training data while any ineligible row is present", () => {
    const rows = loadFeatureRowFixtures();
    expect(() => assertTrainingEligible(rows)).toThrow(/prohibited/);
    const eligibleOnly = rows.filter(
      (row) => row.trainingEligible && row.provenance.provider !== "spotify",
    );
    expect(() => assertTrainingEligible(eligibleOnly)).not.toThrow();
  });

  it("uses only synthetic or registry-known providers in catalog fixtures", () => {
    const catalog = loadCatalogFixtures();
    for (const entity of [...catalog.artists, ...catalog.recordings]) {
      expect(entity.provenanceProvider).toBe("synthetic");
      expect(entity.licensePolicyId).toBe("synthetic-fixtures@1");
    }
  });
});
