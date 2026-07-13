import { createHash } from "node:crypto";

import { isRecommendationEligible } from "@resonance/domain";

import type { Candidate, RankRequest, RankedCandidate, Ranker } from "../interfaces.js";

/**
 * Milestone 0 placeholder ranker: deterministic, reproducible, and
 * eligibility-enforcing. Real scoring arrives in Milestone 2 behind the same
 * versioned interface; this version exists so reproducibility and eligibility
 * invariants are testable from day one.
 *
 * Ordering is a stable hash of (randomSeed, canonicalRecordingId) — no taste
 * logic, but identical inputs always produce identical output.
 */
export const DETERMINISTIC_RANKER_VERSION = "0.0.1-skeleton";

function stableScore(seed: string, candidate: Candidate): number {
  const digest = createHash("sha256")
    .update(`${seed}:${candidate.canonicalRecordingId}`)
    .digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

export class DeterministicRanker implements Ranker {
  readonly version = DETERMINISTIC_RANKER_VERSION;

  async rank(input: RankRequest): Promise<RankedCandidate[]> {
    if (input.rankerVersion !== this.version) {
      throw new Error(
        `Ranker version mismatch: run pinned ${input.rankerVersion}, this ranker is ${this.version}`,
      );
    }

    // A candidate is droppable, not fixable: any Spotify-provenance feature or
    // any feature whose eligibility flag is not backed by its license excludes
    // the whole candidate.
    const eligible = input.candidates.filter((candidate) =>
      candidate.features.every(
        (feature) =>
          feature.provenance.provider !== "spotify" &&
          (!feature.recommendationEligible || isRecommendationEligible(feature)),
      ),
    );

    return eligible
      .map((candidate) => ({ candidate, score: stableScore(input.randomSeed, candidate) }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.candidate.canonicalRecordingId.localeCompare(b.candidate.canonicalRecordingId),
      )
      .map(({ candidate, score }, index) => ({ ...candidate, score, rank: index + 1 }));
  }
}
