import { createHash } from "node:crypto";

/**
 * Deterministic pseudo-randomness for reproducible sampling (spec §10.19):
 * every "random" decision is a pure function of (runSeed, purposeKey).
 */
export function stableUnit(seed: string, key: string): number {
  const digest = createHash("sha256").update(`${seed}:${key}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

/** Reproducible weighted sample without replacement (weights > 0). */
export function weightedSample<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  count: number,
  seed: string,
  keyOf: (item: T) => string,
): T[] {
  // Efraimidis–Spirakis: key = u^(1/w) with deterministic u per item.
  return [...items]
    .map((item) => {
      const weight = Math.max(weightOf(item), 1e-6);
      const unit = stableUnit(seed, keyOf(item));
      return { item, sortKey: Math.pow(unit, 1 / weight) };
    })
    .sort((a, b) => b.sortKey - a.sortKey || keyOf(a.item).localeCompare(keyOf(b.item)))
    .slice(0, count)
    .map((entry) => entry.item);
}
