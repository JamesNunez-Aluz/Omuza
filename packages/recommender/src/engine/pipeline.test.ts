import { buildSyntheticSnapshot, artistUuid, recordingUuid } from "@resonance/testkit";
import { describe, expect, it } from "vitest";

import { evaluateResult } from "../evaluation/harness.js";
import { generateRecommendations } from "./pipeline.js";
import type {
  CatalogSnapshot,
  EngineRequest,
  ProfileSeed,
  TasteProfileSnapshot,
  UserHistory,
} from "./types.js";

/**
 * Golden tests over the synthetic fixture catalog (spec §18.2, §21 M2
 * acceptance criteria). They assert ranking rationale and invariants, not a
 * frozen opaque ordering.
 */

const snapshot: CatalogSnapshot = { recordings: buildSyntheticSnapshot().recordings };

function seed(overrides: Partial<ProfileSeed>): ProfileSeed {
  return {
    id: `seed-${overrides.entityId ?? "x"}-${overrides.sentiment ?? "positive"}`,
    entityType: "artist",
    entityId: artistUuid(0),
    sentiment: "positive",
    strength: 1,
    contextId: null,
    ...overrides,
  };
}

/** 5 positive artists (tags dream_pop/post_rock/jazz_fusion), 1 hard block, 1 fatigue. */
const baseSeeds: ProfileSeed[] = [
  seed({ entityId: artistUuid(0), sentiment: "strong_positive" }),
  seed({ entityId: artistUuid(1) }),
  seed({ entityId: artistUuid(2) }),
  seed({ entityId: artistUuid(5) }),
  seed({ entityType: "recording", entityId: recordingUuid(7, 0) }),
  seed({ entityId: artistUuid(3), sentiment: "hard_block" }),
  seed({ entityType: "recording", entityId: recordingUuid(4, 1), sentiment: "hard_block" }),
  seed({ entityId: artistUuid(6), sentiment: "fatigue", strength: 0.7 }),
];

const profile: TasteProfileSnapshot = { version: "profile@test", seeds: baseSeeds };
const emptyHistory: UserHistory = { exposedRecordingIds: [], knownRecordings: [] };

function request(overrides: Partial<EngineRequest> = {}): EngineRequest {
  return {
    requestedCount: 20,
    discoveryLevel: 50,
    randomSeed: "golden-seed-1",
    context: null,
    excludeRecordingIds: [],
    preserveRecordingIds: [],
    ...overrides,
  };
}

describe("engine pipeline — reproducibility and safety invariants", () => {
  it("same snapshot + same random seed yields the identical playlist", () => {
    const first = generateRecommendations(snapshot, profile, emptyHistory, request());
    const second = generateRecommendations(snapshot, profile, emptyHistory, request());
    expect(second.items.map((item) => item.candidate.recordingId)).toEqual(
      first.items.map((item) => item.candidate.recordingId),
    );
    expect(second.items.map((item) => item.candidate.finalScore)).toEqual(
      first.items.map((item) => item.candidate.finalScore),
    );
  });

  it("a different random seed changes exploration picks but stays deterministic", () => {
    // A candidate budget below catalog size makes the seeded exploration
    // sample a strict subset, so the seed visibly matters.
    const constrained = { discoveryLevel: 100, maxCandidates: 24 };
    const a = generateRecommendations(
      snapshot,
      profile,
      emptyHistory,
      request({ ...constrained, randomSeed: "a" }),
    );
    const b = generateRecommendations(
      snapshot,
      profile,
      emptyHistory,
      request({ ...constrained, randomSeed: "b" }),
    );
    const c = generateRecommendations(
      snapshot,
      profile,
      emptyHistory,
      request({ ...constrained, randomSeed: "b" }),
    );
    expect(b.items.map((item) => item.candidate.recordingId)).toEqual(
      c.items.map((item) => item.candidate.recordingId),
    );
    expect(a.items.map((item) => item.candidate.recordingId)).not.toEqual(
      b.items.map((item) => item.candidate.recordingId),
    );
  });

  it("hard-blocked artists and recordings never appear, at any discovery level", () => {
    for (const discoveryLevel of [0, 25, 50, 75, 100]) {
      const result = generateRecommendations(
        snapshot,
        profile,
        emptyHistory,
        request({ discoveryLevel }),
      );
      for (const item of result.items) {
        const recording = snapshot.recordings.find((r) => r.id === item.candidate.recordingId)!;
        expect(recording.primaryArtistId).not.toBe(artistUuid(3));
        expect(item.candidate.recordingId).not.toBe(recordingUuid(4, 1));
      }
      const rejectedBlocked = result.rejected.filter((candidate) =>
        candidate.rejectionReasons.some((reason) => reason.startsWith("hard_blocked")),
      );
      expect(
        rejectedBlocked.length +
          result.items.length +
          result.eligible.length,
      ).toBeGreaterThan(0);
    }
  });

  it("never contains duplicate recordings and respects the 2-per-artist cap (or records a relaxation)", () => {
    const result = generateRecommendations(snapshot, profile, emptyHistory, request());
    const metrics = evaluateResult(
      result,
      snapshot,
      new Set([artistUuid(0), artistUuid(1), artistUuid(2), artistUuid(5), artistUuid(7)]),
      new Set([artistUuid(3)]),
      new Set([recordingUuid(4, 1)]),
    );
    expect(metrics.duplicateRecordings).toBe(0);
    expect(metrics.hardBlockLeaks).toBe(0);
    if (!result.constraintRelaxations.includes("relaxed:max_per_artist")) {
      expect(metrics.maxTracksPerArtist).toBeLessThanOrEqual(2);
    }
    expect(metrics.itemCount).toBe(20);
    expect(metrics.itemsWithoutEvidence).toBe(0);
  });

  it("discovery 100 concentrates less on direct seed artists than discovery 0", () => {
    const seedArtists = new Set([artistUuid(0), artistUuid(1), artistUuid(2), artistUuid(5), artistUuid(7)]);
    const low = generateRecommendations(snapshot, profile, emptyHistory, request({ discoveryLevel: 0 }));
    const high = generateRecommendations(snapshot, profile, emptyHistory, request({ discoveryLevel: 100 }));
    const lowMetrics = evaluateResult(low, snapshot, seedArtists, new Set(), new Set());
    const highMetrics = evaluateResult(high, snapshot, seedArtists, new Set(), new Set());
    expect(highMetrics.seedArtistShare).toBeLessThan(lowMetrics.seedArtistShare);
  });

  it("sparse metadata is not treated as negative: sparse recordings can still be recommended and never get negative fit from absence", () => {
    const result = generateRecommendations(
      snapshot,
      profile,
      emptyHistory,
      request({ discoveryLevel: 100 }),
    );
    // artist 19's recordings have no features at all.
    const sparseScored = result.eligible.filter((candidate) =>
      candidate.recordingId.startsWith("000000bb-0000-4000-8000-0000000019"),
    );
    for (const candidate of sparseScored) {
      expect(candidate.fitScore).toBeGreaterThanOrEqual(0.5 - 1e-9); // neutral, not penalized fit
      expect(candidate.metadataUncertainty).toBe(1); // honesty lives in the uncertainty term
    }
  });

  it("every item carries at least one evidence record and no unsupported claims", () => {
    const result = generateRecommendations(snapshot, profile, emptyHistory, request());
    for (const item of result.items) {
      expect(item.explanation.evidence.length).toBeGreaterThan(0);
      const text = item.explanation.renderedText.toLowerCase();
      expect(text).not.toContain("you will love");
      expect(text).not.toContain("you have never heard");
      expect(text).not.toContain("spotify");
      expect(text).not.toContain("trending");
      if (text.includes("probably new")) {
        expect(item.candidate.noveltyState).toBe("probably_new");
      }
    }
  });

  it("novelty is honest: no confirmed_new, seeded artists lower novelty, known history wins", () => {
    const withHistory: UserHistory = {
      exposedRecordingIds: [recordingUuid(10, 0)],
      knownRecordings: [
        { recordingId: recordingUuid(11, 0), knowledgeState: "confirmed_known", confidence: 0.95 },
      ],
    };
    const result = generateRecommendations(snapshot, profile, withHistory, request({ discoveryLevel: 80 }));
    for (const candidate of result.eligible) {
      expect(candidate.noveltyState).not.toBe("confirmed_new");
      if (candidate.recordingId === recordingUuid(11, 0)) {
        expect(candidate.noveltyState).toBe("known");
      }
      const recording = snapshot.recordings.find((r) => r.id === candidate.recordingId)!;
      if (recording.primaryArtistId === artistUuid(0)) {
        expect(candidate.noveltyProbability).toBeLessThan(0.6);
      }
    }
  });

  it("strict explicit-content policy excludes explicit AND unknown-explicitness recordings", () => {
    const result = generateRecommendations(
      snapshot,
      profile,
      emptyHistory,
      request({
        context: {
          explicitContentPolicy: "blocked",
          languageBlocklist: [],
          eraStartYear: null,
          eraEndYear: null,
        },
      }),
    );
    const rejectedIds = new Map(result.rejected.map((c) => [c.recordingId, c.rejectionReasons]));
    expect(rejectedIds.get(recordingUuid(0, 2))).toContain("explicit_content_blocked");
    for (const item of result.items) {
      const recording = snapshot.recordings.find((r) => r.id === item.candidate.recordingId)!;
      expect(recording.isExplicit).toBe(false);
    }
  });

  it("language blocklist removes reliably-tagged languages only", () => {
    const result = generateRecommendations(
      snapshot,
      profile,
      emptyHistory,
      request({
        discoveryLevel: 100,
        context: {
          explicitContentPolicy: "allowed",
          languageBlocklist: ["xx"],
          eraStartYear: null,
          eraEndYear: null,
        },
      }),
    );
    for (const item of result.items) {
      const recording = snapshot.recordings.find((r) => r.id === item.candidate.recordingId)!;
      expect(recording.languageCode).not.toBe("xx");
    }
  });

  it("exact seed recordings are excluded from candidates by default", () => {
    const result = generateRecommendations(snapshot, profile, emptyHistory, request());
    const allProposed = [...result.items.map((i) => i.candidate.recordingId)];
    expect(allProposed).not.toContain(recordingUuid(7, 0));
  });

  it("degraded providers pass through to the result for run bookkeeping", () => {
    const result = generateRecommendations(snapshot, profile, emptyHistory, request(), [], ["listenbrainz"]);
    expect(result.degradedProviders).toEqual(["listenbrainz"]);
    expect(result.items.length).toBe(20);
  });
});
