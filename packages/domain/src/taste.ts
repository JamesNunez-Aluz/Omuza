/**
 * Taste declarations and their derivation into preference facts (spec §9.4).
 *
 * Derivation is a pure, versioned function of the active (non-removed) seeds,
 * so deleting a seed and recomputing always yields the profile that would
 * exist had the seed never been declared. Evidence lineage is preserved by
 * the recompute job in @resonance/worker.
 */

export const SEED_SENTIMENTS = [
  "strong_positive",
  "positive",
  "negative",
  "hard_block",
  "fatigue",
] as const;

export type SeedSentiment = (typeof SEED_SENTIMENTS)[number];

export type SeedEntityType = "artist" | "recording";

export const SEED_DERIVATION_VERSION = "seed-derivation@1";

/** Onboarding minimums (spec §21 M1 acceptance). */
export const MIN_POSITIVE_SEEDS = 5;
export const MIN_NEGATIVE_SEEDS = 3;

export const POSITIVE_SENTIMENTS: readonly SeedSentiment[] = ["strong_positive", "positive"];
export const NEGATIVE_SENTIMENTS: readonly SeedSentiment[] = ["negative", "hard_block", "fatigue"];

const SENTIMENT_VALUE: Record<SeedSentiment, number> = {
  strong_positive: 1,
  positive: 0.6,
  negative: -0.6,
  hard_block: -1,
  fatigue: -0.3,
};

export interface ActiveSeed {
  id: string;
  entityType: SeedEntityType;
  entityId: string;
  sentiment: SeedSentiment;
  /** 0..1 declared strength. */
  strength: number;
  contextId: string | null;
}

export interface DerivedPreference {
  contextId: string | null;
  namespace: "seed_entity";
  key: string;
  preferenceValue: number;
  confidence: number;
  origin: "explicit";
  modelVersion: string;
  evidence: {
    eventType: "seed_declared";
    sourceEntityId: string;
    weight: number;
  }[];
}

export function preferenceKeyForSeed(seed: Pick<ActiveSeed, "entityType" | "entityId">): string {
  return `${seed.entityType}:${seed.entityId}`;
}

/**
 * Derive explicit preference facts from active seeds. Multiple seeds for the
 * same entity+context combine: the strongest-magnitude sentiment wins the
 * value; confidence grows with corroborating declarations, capped at 1.
 */
export function deriveExplicitPreferences(seeds: readonly ActiveSeed[]): DerivedPreference[] {
  const grouped = new Map<string, ActiveSeed[]>();
  for (const seed of seeds) {
    const groupKey = `${seed.contextId ?? "global"}|${preferenceKeyForSeed(seed)}`;
    const group = grouped.get(groupKey) ?? [];
    group.push(seed);
    grouped.set(groupKey, group);
  }

  const preferences: DerivedPreference[] = [];
  for (const group of grouped.values()) {
    const scored = group.map((seed) => ({
      seed,
      value: SENTIMENT_VALUE[seed.sentiment] * seed.strength,
    }));
    const dominant = scored.reduce((best, entry) =>
      Math.abs(entry.value) > Math.abs(best.value) ? entry : best,
    );
    const confidence = Math.min(
      1,
      scored.reduce((sum, entry) => sum + 0.5 * entry.seed.strength, 0.5),
    );
    const first = group[0]!;
    preferences.push({
      contextId: first.contextId,
      namespace: "seed_entity",
      key: preferenceKeyForSeed(first),
      preferenceValue: clamp(dominant.value, -1, 1),
      confidence: round3(confidence),
      origin: "explicit",
      modelVersion: SEED_DERIVATION_VERSION,
      evidence: group.map((seed) => ({
        eventType: "seed_declared",
        sourceEntityId: seed.id,
        weight: round3(SENTIMENT_VALUE[seed.sentiment] * seed.strength),
      })),
    });
  }

  return preferences.sort((a, b) => a.key.localeCompare(b.key));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, round3(value)));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
