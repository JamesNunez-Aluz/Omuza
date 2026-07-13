import { describe, expect, it } from "vitest";

import { deriveExplicitPreferences, SEED_DERIVATION_VERSION } from "./taste.js";
import type { ActiveSeed } from "./taste.js";

function seed(overrides: Partial<ActiveSeed>): ActiveSeed {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    entityType: "artist",
    entityId: "artist-1",
    sentiment: "positive",
    strength: 1,
    contextId: null,
    ...overrides,
  };
}

describe("deriveExplicitPreferences", () => {
  it("is a pure, deterministic, versioned derivation", () => {
    const seeds = [seed({}), seed({ id: "2", entityId: "artist-2", sentiment: "hard_block" })];
    const first = deriveExplicitPreferences(seeds);
    const second = deriveExplicitPreferences(seeds);
    expect(first).toEqual(second);
    expect(first.every((pref) => pref.modelVersion === SEED_DERIVATION_VERSION)).toBe(true);
  });

  it("maps sentiments to signed values scaled by strength", () => {
    const [strong] = deriveExplicitPreferences([seed({ sentiment: "strong_positive", strength: 1 })]);
    const [block] = deriveExplicitPreferences([seed({ sentiment: "hard_block", strength: 1 })]);
    const [fatigue] = deriveExplicitPreferences([seed({ sentiment: "fatigue", strength: 0.5 })]);
    expect(strong!.preferenceValue).toBe(1);
    expect(block!.preferenceValue).toBe(-1);
    expect(fatigue!.preferenceValue).toBeCloseTo(-0.15, 3);
  });

  it("keeps context-specific declarations separate from global ones", () => {
    const prefs = deriveExplicitPreferences([
      seed({}),
      seed({ id: "2", contextId: "ctx-1", sentiment: "fatigue" }),
    ]);
    expect(prefs).toHaveLength(2);
    const contexts = prefs.map((pref) => pref.contextId).sort();
    expect(contexts).toEqual(["ctx-1", null].sort());
  });

  it("recomputation without a deleted seed removes its preference", () => {
    const all = [seed({}), seed({ id: "2", entityId: "artist-2", sentiment: "negative" })];
    const afterDeletion = deriveExplicitPreferences(all.slice(0, 1));
    expect(afterDeletion).toHaveLength(1);
    expect(afterDeletion[0]!.key).toBe("artist:artist-1");
  });

  it("preserves evidence lineage per contributing seed", () => {
    const prefs = deriveExplicitPreferences([
      seed({}),
      seed({ id: "duplicate", sentiment: "strong_positive" }),
    ]);
    expect(prefs).toHaveLength(1);
    expect(prefs[0]!.evidence).toHaveLength(2);
    expect(prefs[0]!.preferenceValue).toBe(1);
  });
});
