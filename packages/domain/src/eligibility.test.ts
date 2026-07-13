import { describe, expect, it } from "vitest";

import { assertTrainingEligible, isRecommendationEligible } from "./index.js";
import type { FeatureRow } from "./index.js";

function syntheticRow(overrides: Partial<FeatureRow> = {}): FeatureRow {
  return {
    canonicalRecordingId: "rec-synthetic-0001",
    feature: "tempo_bucket",
    value: 0.5,
    provenance: {
      provider: "musicbrainz",
      dataset: "core",
      licensePolicyId: "musicbrainz-core@1",
      ingestedAt: "2026-07-13T00:00:00.000Z",
      ...overrides.provenance,
    },
    trainingEligible: true,
    recommendationEligible: true,
    ...overrides,
  };
}

describe("assertTrainingEligible", () => {
  it("accepts rows with permissive licenses and eligible flags", () => {
    expect(() => assertTrainingEligible([syntheticRow()])).not.toThrow();
  });

  it("rejects any Spotify-sourced row even if flags claim eligibility", () => {
    const tampered = syntheticRow({
      provenance: {
        provider: "spotify",
        dataset: "export-resolution",
        licensePolicyId: "spotify-export@1",
        ingestedAt: "2026-07-13T00:00:00.000Z",
      },
      trainingEligible: true,
    });
    expect(() => assertTrainingEligible([tampered])).toThrow(/prohibited/);
  });

  it("rejects rows whose flags are eligible but whose license prohibits training", () => {
    const supplementary = syntheticRow({
      provenance: {
        provider: "musicbrainz",
        dataset: "supplementary",
        licensePolicyId: "musicbrainz-supplementary@1",
        ingestedAt: "2026-07-13T00:00:00.000Z",
      },
    });
    expect(() => assertTrainingEligible([supplementary])).toThrow(/prohibited/);
  });

  it("rejects rows with unknown license policies (unknown means ineligible)", () => {
    const unknown = syntheticRow({
      provenance: {
        provider: "musicbrainz",
        dataset: "core",
        licensePolicyId: "does-not-exist@1",
        ingestedAt: "2026-07-13T00:00:00.000Z",
      },
    });
    expect(() => assertTrainingEligible([unknown])).toThrow(/prohibited/);
  });

  it("rejects rows explicitly flagged ineligible", () => {
    expect(() => assertTrainingEligible([syntheticRow({ trainingEligible: false })])).toThrow(
      /prohibited/,
    );
  });
});

describe("isRecommendationEligible", () => {
  it("never allows Spotify provenance", () => {
    const row = syntheticRow({
      provenance: {
        provider: "spotify",
        dataset: "export-resolution",
        licensePolicyId: "spotify-export@1",
        ingestedAt: "2026-07-13T00:00:00.000Z",
      },
    });
    expect(isRecommendationEligible(row)).toBe(false);
  });

  it("requires both the flag and the license to permit the use", () => {
    expect(isRecommendationEligible(syntheticRow())).toBe(true);
    expect(isRecommendationEligible(syntheticRow({ recommendationEligible: false }))).toBe(false);
    const unlicensed = syntheticRow({
      provenance: {
        provider: "musicbrainz",
        dataset: "supplementary",
        licensePolicyId: "musicbrainz-supplementary@1",
        ingestedAt: "2026-07-13T00:00:00.000Z",
      },
    });
    expect(isRecommendationEligible(unlicensed)).toBe(false);
  });
});
