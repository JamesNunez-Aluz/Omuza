import { describe, expect, it } from "vitest";

import {
  activeDislikedRecordingIds,
  deriveFeedbackPreferences,
  effectiveFeedbackEvents,
  knowledgeUpdateFor,
  reasonCodeFeatureKeys,
} from "./feedback.js";
import type { RawFeedbackEvent } from "./feedback.js";

function event(overrides: Partial<RawFeedbackEvent>): RawFeedbackEvent {
  return {
    id: overrides.id ?? "event-1",
    recordingId: "rec-1",
    primaryArtistId: "artist-1",
    primaryResponse: "like",
    reasonCodes: [],
    contextId: null,
    occurredAt: "2026-07-14T00:00:00.000Z",
    supersedesEventId: null,
    recordingFeatures: [
      { key: "tag:dream_pop", value: 1 },
      { key: "energy_estimate", value: 0.6 },
    ],
    ...overrides,
  };
}

describe("effectiveFeedbackEvents (append-only revision, ADR 0009)", () => {
  it("a revision supersedes the prior event so it never double-counts", () => {
    const original = event({ id: "a", primaryResponse: "love" });
    const revision = event({ id: "b", primaryResponse: "dislike", supersedesEventId: "a" });
    const effective = effectiveFeedbackEvents([original, revision]);
    expect(effective.map((entry) => entry.id)).toEqual(["b"]);

    const facts = deriveFeedbackPreferences(effective);
    const recordingFact = facts.find((fact) => fact.key === "recording:rec-1" && fact.contextId === null);
    expect(recordingFact!.preferenceValue).toBeLessThan(0); // only the dislike counts
  });

  it("supersede chains resolve to the terminal event", () => {
    const chain = [
      event({ id: "a", primaryResponse: "dislike" }),
      event({ id: "b", primaryResponse: "neutral", supersedesEventId: "a" }),
      event({ id: "c", primaryResponse: "love", supersedesEventId: "b" }),
    ];
    const effective = effectiveFeedbackEvents(chain);
    expect(effective.map((entry) => entry.id)).toEqual(["c"]);
    expect(activeDislikedRecordingIds(effective)).toEqual([]);
  });
});

describe("deriveFeedbackPreferences (spec §10.7)", () => {
  it("recomputation is idempotent: same events, same facts", () => {
    const events = effectiveFeedbackEvents([event({ id: "a", primaryResponse: "love" })]);
    expect(deriveFeedbackPreferences(events)).toEqual(deriveFeedbackPreferences(events));
  });

  it("'already knew' updates novelty knowledge but never taste", () => {
    const facts = deriveFeedbackPreferences(
      effectiveFeedbackEvents([event({ id: "a", primaryResponse: "already_knew" })]),
    );
    expect(facts).toEqual([]);
    expect(knowledgeUpdateFor("already_knew", null)).toEqual({
      knowledgeState: "confirmed_known",
      confidence: 0.95,
    });
    expect(knowledgeUpdateFor("love", "new_to_me")).toEqual({
      knowledgeState: "confirmed_new",
      confidence: 0.95,
    });
    expect(knowledgeUpdateFor("love", null)).toBeNull();
  });

  it("'not now' affects the context layer only, never the global profile", () => {
    const facts = deriveFeedbackPreferences(
      effectiveFeedbackEvents([event({ id: "a", primaryResponse: "not_now", contextId: "ctx-1" })]),
    );
    const globalFacts = facts.filter((fact) => fact.contextId === null);
    const contextFacts = facts.filter((fact) => fact.contextId === "ctx-1");
    expect(globalFacts).toEqual([]);
    expect(contextFacts.length).toBeGreaterThan(0);
    expect(contextFacts.find((fact) => fact.key === "recording:rec-1")!.preferenceValue).toBeLessThan(0);
  });

  it("love with a context affects context more strongly than global (3.5 vs 3.0)", () => {
    const facts = deriveFeedbackPreferences(
      effectiveFeedbackEvents([event({ id: "a", primaryResponse: "love", contextId: "ctx-1" })]),
    );
    const globalFact = facts.find((fact) => fact.key === "recording:rec-1" && fact.contextId === null)!;
    const contextFact = facts.find((fact) => fact.key === "recording:rec-1" && fact.contextId === "ctx-1")!;
    expect(contextFact.confidence).toBeGreaterThan(globalFact.confidence);
  });

  it("reason codes update only features that exist and are eligible on the recording", () => {
    expect(reasonCodeFeatureKeys("energy", ["energy_estimate", "tag:folk"])).toEqual(["energy_estimate"]);
    expect(reasonCodeFeatureKeys("vocals", ["energy_estimate", "tag:folk"])).toEqual([]);
    expect(reasonCodeFeatureKeys("mood", ["tag:folk"])).toEqual(["tag:folk"]);

    const withUnsupportedReason = deriveFeedbackPreferences(
      effectiveFeedbackEvents([
        event({ id: "a", primaryResponse: "love", reasonCodes: ["vocals", "lyrics"] }),
      ]),
    );
    expect(withUnsupportedReason.some((fact) => fact.namespace === "feedback_feature")).toBe(false);

    const withSupportedReason = deriveFeedbackPreferences(
      effectiveFeedbackEvents([
        event({ id: "a", primaryResponse: "love", reasonCodes: ["mood", "energy"] }),
      ]),
    );
    const featureFacts = withSupportedReason.filter((fact) => fact.namespace === "feedback_feature");
    expect(featureFacts.map((fact) => fact.key).sort()).toEqual(["energy_estimate", "tag:dream_pop"]);
    for (const fact of featureFacts) {
      expect(fact.preferenceValue).toBeGreaterThan(0);
    }

    // A recording with no eligible features yields no feature facts at all.
    const sparse = deriveFeedbackPreferences(
      effectiveFeedbackEvents([
        event({ id: "a", primaryResponse: "love", reasonCodes: ["mood"], recordingFeatures: [] }),
      ]),
    );
    expect(sparse.some((fact) => fact.namespace === "feedback_feature")).toBe(false);
  });

  it("artist facts inherit a damped share of the recording signal", () => {
    const facts = deriveFeedbackPreferences(
      effectiveFeedbackEvents([event({ id: "a", primaryResponse: "love" })]),
    );
    const recording = facts.find((fact) => fact.key === "recording:rec-1")!;
    const artist = facts.find((fact) => fact.key === "artist:artist-1")!;
    expect(artist.confidence).toBeLessThan(recording.confidence);
    expect(artist.preferenceValue).toBeGreaterThan(0);
  });

  it("tracks active dislikes for hard filtering until superseded", () => {
    const disliked = effectiveFeedbackEvents([event({ id: "a", primaryResponse: "dislike" })]);
    expect(activeDislikedRecordingIds(disliked)).toEqual(["rec-1"]);

    const reversed = effectiveFeedbackEvents([
      event({ id: "a", primaryResponse: "dislike" }),
      event({ id: "b", primaryResponse: "like", supersedesEventId: "a" }),
    ]);
    expect(activeDislikedRecordingIds(reversed)).toEqual([]);
  });
});
