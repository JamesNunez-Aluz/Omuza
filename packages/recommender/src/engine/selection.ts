import type { TastePosterior } from "./taste-posterior.js";
import type { EngineRequest, ScoredCandidate, SnapshotRecording } from "./types.js";

/**
 * Diversity-aware selection with MMR and list constraints (spec §10.13).
 * Constraints relax in a documented order when the pool is insufficient, and
 * every relaxation is recorded on the run.
 *
 * Relaxation order: min-nonseed-artists → provider cap → tag cap → artist cap.
 */

export interface SelectionOutput {
  selected: { candidate: ScoredCandidate; selectionReason: string }[];
  relaxations: string[];
}

interface Constraints {
  maxPerArtist: number;
  maxTagShare: number | null;
  maxProviderShare: number | null;
  minNonSeedArtists: number | null;
}

export function selectWithMmr(
  scored: ScoredCandidate[],
  recordingsById: Map<string, SnapshotRecording>,
  posterior: TastePosterior,
  request: EngineRequest,
): SelectionOutput {
  const D = request.discoveryLevel / 100;
  const lambda = 0.85 - 0.25 * D;
  const count = request.requestedCount;

  const relaxationOrder: (keyof Constraints)[] = [
    "minNonSeedArtists",
    "maxProviderShare",
    "maxTagShare",
    "maxPerArtist",
  ];

  const constraints: Constraints = {
    maxPerArtist: 2,
    maxTagShare: 0.35,
    maxProviderShare: 0.6,
    // Balanced discovery requires non-seed representation (spec §10.13).
    minNonSeedArtists: request.discoveryLevel >= 35 && request.discoveryLevel <= 65 ? 5 : null,
  };

  const relaxations: string[] = [];

  for (let attempt = 0; attempt <= relaxationOrder.length; attempt += 1) {
    const result = trySelect(scored, recordingsById, posterior, request, lambda, count, constraints);
    if (result.length >= Math.min(count, scored.length)) {
      return {
        selected: result,
        relaxations,
      };
    }
    const toRelax = relaxationOrder[attempt];
    if (!toRelax) break;
    relaxations.push(`relaxed:${camelToSnake(toRelax)}`);
    if (toRelax === "maxPerArtist") constraints.maxPerArtist = count;
    else constraints[toRelax] = null;
  }

  const finalResult = trySelect(scored, recordingsById, posterior, request, lambda, count, constraints);
  return { selected: finalResult, relaxations };
}

function trySelect(
  scored: ScoredCandidate[],
  recordingsById: Map<string, SnapshotRecording>,
  posterior: TastePosterior,
  request: EngineRequest,
  lambda: number,
  count: number,
  constraints: Constraints,
): { candidate: ScoredCandidate; selectionReason: string }[] {
  const pool = [...scored].sort(
    (a, b) => b.finalScore - a.finalScore || a.recordingId.localeCompare(b.recordingId),
  );
  const selected: { candidate: ScoredCandidate; selectionReason: string }[] = [];
  const artistCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const strategyCounts = new Map<string, number>();
  let nonSeedArtists = 0;

  while (selected.length < count && pool.length > 0) {
    let best: { index: number; mmr: number; reason: string } | undefined;

    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index]!;
      const recording = recordingsById.get(candidate.recordingId)!;
      const artistId = recording.primaryArtistId;

      if ((artistCounts.get(artistId) ?? 0) >= constraints.maxPerArtist) continue;

      if (constraints.maxProviderShare !== null && selected.length >= 3) {
        const strategyCount = strategyCounts.get(candidate.providerStrategy) ?? 0;
        if ((strategyCount + 1) / (selected.length + 1) > constraints.maxProviderShare) continue;
      }

      const tag = dominantTag(recording);
      if (constraints.maxTagShare !== null && tag && selected.length >= 3) {
        const tagCount = tagCounts.get(tag) ?? 0;
        if ((tagCount + 1) / (selected.length + 1) > constraints.maxTagShare) continue;
      }

      // If we're at risk of missing the non-seed minimum, require non-seed
      // artists for the remaining slots.
      if (constraints.minNonSeedArtists !== null) {
        const remaining = count - selected.length;
        const needed = constraints.minNonSeedArtists - nonSeedArtists;
        if (needed >= remaining && posterior.seedArtistIds.has(artistId)) continue;
      }

      const maxSimilarity = selected.reduce((max, chosen) => {
        const chosenRecording = recordingsById.get(chosen.candidate.recordingId)!;
        return Math.max(max, similarity(recording, chosenRecording));
      }, 0);
      const mmr = lambda * candidate.finalScore - (1 - lambda) * maxSimilarity;

      if (!best || mmr > best.mmr) {
        best = {
          index,
          mmr,
          reason:
            maxSimilarity > 0.5
              ? "mmr_diversity_tradeoff"
              : candidate.providerStrategy === "catalog_exploration"
                ? "exploration_slot"
                : "top_score",
        };
      }
    }

    if (!best) break;

    const [candidate] = pool.splice(best.index, 1);
    const recording = recordingsById.get(candidate!.recordingId)!;
    artistCounts.set(recording.primaryArtistId, (artistCounts.get(recording.primaryArtistId) ?? 0) + 1);
    strategyCounts.set(
      candidate!.providerStrategy,
      (strategyCounts.get(candidate!.providerStrategy) ?? 0) + 1,
    );
    const tag = dominantTag(recording);
    if (tag) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    if (!posterior.seedArtistIds.has(recording.primaryArtistId)) nonSeedArtists += 1;

    selected.push({ candidate: candidate!, selectionReason: best.reason });
  }

  return selected;
}

/** v0 similarity: same artist ≫ shared dominant tag ≫ shared any feature. */
export function similarity(a: SnapshotRecording, b: SnapshotRecording): number {
  if (a.primaryArtistId === b.primaryArtistId) return 1;
  const tagA = dominantTag(a);
  if (tagA && tagA === dominantTag(b)) return 0.55;
  const featuresA = new Set(a.features.map((feature) => feature.feature));
  return b.features.some((feature) => featuresA.has(feature.feature)) ? 0.25 : 0;
}

export function dominantTag(recording: SnapshotRecording): string | undefined {
  let best: { tag: string; value: number } | undefined;
  for (const feature of recording.features) {
    if (feature.feature.startsWith("tag:") && (!best || feature.value > best.value)) {
      best = { tag: feature.feature, value: feature.value };
    }
  }
  return best?.tag;
}

function camelToSnake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
