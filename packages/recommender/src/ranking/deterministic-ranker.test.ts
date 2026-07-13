import type { FeatureRow } from "@resonance/domain";
import { describe, expect, it } from "vitest";

import type { Candidate } from "../interfaces.js";
import { DETERMINISTIC_RANKER_VERSION, DeterministicRanker } from "./deterministic-ranker.js";

function feature(overrides: Partial<FeatureRow>): FeatureRow {
  return {
    canonicalRecordingId: "rec-0001",
    feature: "tempo_bucket",
    value: 0.5,
    provenance: {
      provider: "synthetic",
      dataset: "fixtures",
      licensePolicyId: "synthetic-fixtures@1",
      ingestedAt: "2026-07-13T00:00:00.000Z",
    },
    trainingEligible: false,
    recommendationEligible: true,
    ...overrides,
  };
}

function candidate(id: string, features: FeatureRow[] = []): Candidate {
  return {
    canonicalRecordingId: id,
    provenance: {
      provider: "synthetic",
      dataset: "fixtures",
      licensePolicyId: "synthetic-fixtures@1",
      ingestedAt: "2026-07-13T00:00:00.000Z",
    },
    features,
  };
}

const ranker = new DeterministicRanker();

function rankRequest(candidates: Candidate[], seed = "seed-1") {
  return {
    userId: "user-1",
    candidates,
    rankerVersion: DETERMINISTIC_RANKER_VERSION,
    randomSeed: seed,
  };
}

describe("DeterministicRanker", () => {
  it("is reproducible: identical inputs produce identical output (golden invariant)", async () => {
    const candidates = ["rec-0001", "rec-0002", "rec-0003"].map((id) =>
      candidate(id, [feature({ canonicalRecordingId: id })]),
    );
    const first = await ranker.rank(rankRequest(candidates));
    const second = await ranker.rank(rankRequest(candidates));
    expect(first).toEqual(second);
    expect(first.map((item) => item.rank)).toEqual([1, 2, 3]);
  });

  it("changes ordering with the random seed but stays deterministic per seed", async () => {
    const candidates = Array.from({ length: 8 }, (_, index) =>
      candidate(`rec-${index}`, [feature({ canonicalRecordingId: `rec-${index}` })]),
    );
    const seedA = await ranker.rank(rankRequest(candidates, "seed-a"));
    const seedB = await ranker.rank(rankRequest(candidates, "seed-b"));
    expect(seedA.map((item) => item.canonicalRecordingId)).not.toEqual(
      seedB.map((item) => item.canonicalRecordingId),
    );
  });

  it("excludes candidates carrying any Spotify-provenance feature", async () => {
    const spotifyFeature = feature({
      provenance: {
        provider: "spotify",
        dataset: "export-resolution",
        licensePolicyId: "spotify-export@1",
        ingestedAt: "2026-07-13T00:00:00.000Z",
      },
      recommendationEligible: false,
    });
    const ranked = await ranker.rank(
      rankRequest([candidate("rec-clean"), candidate("rec-tainted", [spotifyFeature])]),
    );
    expect(ranked.map((item) => item.canonicalRecordingId)).toEqual(["rec-clean"]);
  });

  it("excludes candidates whose eligibility flags are not backed by the license registry", async () => {
    const unlicensed = feature({
      provenance: {
        provider: "musicbrainz",
        dataset: "supplementary",
        licensePolicyId: "musicbrainz-supplementary@1",
        ingestedAt: "2026-07-13T00:00:00.000Z",
      },
      recommendationEligible: true,
    });
    const ranked = await ranker.rank(
      rankRequest([candidate("rec-clean"), candidate("rec-unlicensed", [unlicensed])]),
    );
    expect(ranked.map((item) => item.canonicalRecordingId)).toEqual(["rec-clean"]);
  });

  it("refuses to run under a mismatched pinned ranker version", async () => {
    await expect(
      ranker.rank({ ...rankRequest([candidate("rec-1")]), rankerVersion: "9.9.9" }),
    ).rejects.toThrow(/version mismatch/);
  });
});
