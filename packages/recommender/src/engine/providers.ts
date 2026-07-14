import { weightedSample } from "./rng.js";
import type { TastePosterior } from "./taste-posterior.js";
import type { Candidate, CatalogSnapshot, EngineRequest } from "./types.js";

/**
 * First-party candidate providers (spec §10.3). Each returns canonical
 * recording IDs with source evidence and a strategy label — never final
 * recommendations. External providers (Strategy B) are fetched by the worker
 * and passed in as extra batches; they are re-ranked and filtered like any
 * other source.
 */

export interface ProviderBatchResult {
  providerId: string;
  strategy: string;
  candidates: Candidate[];
}

/** Provider budget allocation (spec §10.4), normalized over enabled providers. */
export function providerBudgets(
  discoveryLevel: number,
  maxCandidates: number,
  collaborativeEnabled: boolean,
): { seedNeighborhood: number; collaborative: number; exploration: number } {
  const D = discoveryLevel / 100;
  let seedShare = 0.55 - 0.25 * D;
  let collabShare = collaborativeEnabled ? 0.25 : 0;
  // wildcard/bridge share folded into exploration for v0.
  let exploreShare = 0.15 + 0.15 * D + (0.05 + 0.1 * D);
  const total = seedShare + collabShare + exploreShare;
  seedShare /= total;
  collabShare /= total;
  exploreShare /= total;
  return {
    seedNeighborhood: Math.ceil(maxCandidates * seedShare),
    collaborative: Math.ceil(maxCandidates * collabShare),
    exploration: Math.ceil(maxCandidates * exploreShare),
  };
}

/**
 * Strategy A — seed neighborhood: recordings by positively-seeded artists
 * (excluding exact seed recordings) plus recordings sharing high-affinity
 * features with the taste posterior. Relationship paths are preserved as
 * evidence for explanations and auditing.
 */
export function seedNeighborhoodProvider(
  snapshot: CatalogSnapshot,
  posterior: TastePosterior,
  request: EngineRequest,
  budget: number,
): ProviderBatchResult {
  const D = request.discoveryLevel / 100;
  const scored: { candidate: Candidate; weight: number }[] = [];

  for (const recording of snapshot.recordings) {
    if (posterior.seedRecordingIds.has(recording.id)) continue; // exclude exact seeds

    const artistAffinity = posterior.artists.get(recording.primaryArtistId);
    const isSeedArtist = posterior.seedArtistIds.has(recording.primaryArtistId);

    let weight = 0;
    const evidence: Candidate["sourceEvidence"] = [];

    if (isSeedArtist && artistAffinity && artistAffinity.affinity > 0) {
      // Seed-artist weight shrinks as discovery rises (spec §10.3 A rules).
      weight += artistAffinity.affinity * artistAffinity.confidence * (1 - 0.6 * D);
      evidence.push({
        type: "explicit_seed",
        label: `By ${recording.primaryArtistName}, an artist you seeded`,
        refId: artistAffinity.seedIds[0] ?? recording.primaryArtistId,
      });
    }

    let bestFeature: { key: string; contribution: number } | undefined;
    for (const feature of recording.features) {
      const affinity = posterior.features.get(feature.feature);
      if (!affinity || affinity.affinity <= 0) continue;
      const contribution = affinity.affinity * affinity.confidence * feature.value;
      if (!bestFeature || contribution > bestFeature.contribution) {
        bestFeature = { key: feature.feature, contribution };
      }
    }
    if (bestFeature && bestFeature.contribution > 0.05) {
      weight += bestFeature.contribution;
      evidence.push({
        type: "feature_match",
        label: `Shares ${humanizeFeature(bestFeature.key)} with music you love`,
        refId: bestFeature.key,
      });
    }

    if (weight > 0 && evidence.length > 0) {
      scored.push({
        candidate: {
          recordingId: recording.id,
          provider: "first_party",
          providerStrategy: "seed_neighborhood",
          providerRank: 0,
          providerScore: weight,
          sourceEvidence: evidence,
        },
        weight,
      });
    }
  }

  const ranked = scored
    .sort(
      (a, b) => b.weight - a.weight || a.candidate.recordingId.localeCompare(b.candidate.recordingId),
    )
    .slice(0, budget)
    .map((entry, index) => ({ ...entry.candidate, providerRank: index + 1 }));

  return { providerId: "first_party", strategy: "seed_neighborhood", candidates: ranked };
}

/**
 * Strategy C — controlled catalog exploration: reproducible weighted sampling
 * from eligible catalog slices outside the seed neighborhood (spec §10.3 C).
 */
export function catalogExplorationProvider(
  snapshot: CatalogSnapshot,
  posterior: TastePosterior,
  request: EngineRequest,
  budget: number,
): ProviderBatchResult {
  const pool = snapshot.recordings.filter(
    (recording) =>
      !posterior.seedRecordingIds.has(recording.id) &&
      !posterior.seedArtistIds.has(recording.primaryArtistId),
  );

  const sampled = weightedSample(
    pool,
    (recording) => {
      // Prefer recordings with some metadata confidence and a mild bridge to
      // known-liked features; wild randomness is not rewarded (spec §10.11).
      const metadataConfidence = Math.min(recording.features.length / 3, 1);
      let bridge = 0.2;
      for (const feature of recording.features) {
        const affinity = posterior.features.get(feature.feature);
        if (affinity && affinity.affinity > 0) bridge = Math.max(bridge, affinity.affinity);
      }
      return 0.3 + 0.4 * metadataConfidence + 0.3 * bridge;
    },
    budget,
    request.randomSeed,
    (recording) => `explore:${recording.id}`,
  );

  return {
    providerId: "first_party",
    strategy: "catalog_exploration",
    candidates: sampled.map((recording, index) => ({
      recordingId: recording.id,
      provider: "first_party",
      providerStrategy: "catalog_exploration",
      providerRank: index + 1,
      providerScore: 0.5,
      sourceEvidence: [
        {
          type: "diversity_rationale",
          label: "An exploratory pick from outside your seed neighborhood",
          refId: `exploration:${request.randomSeed.slice(0, 8)}`,
        },
      ],
    })),
  };
}

/** Canonicalization + dedupe: one entry per recording, best evidence merged. */
export function dedupeCandidates(batches: ProviderBatchResult[]): Candidate[] {
  const byRecording = new Map<string, Candidate>();
  for (const batch of batches) {
    for (const candidate of batch.candidates) {
      const existing = byRecording.get(candidate.recordingId);
      if (!existing) {
        byRecording.set(candidate.recordingId, { ...candidate });
      } else {
        // Keep the better provider score; merge distinct evidence records.
        const merged = existing.providerScore >= candidate.providerScore ? existing : { ...candidate };
        const seen = new Set(merged.sourceEvidence.map((entry) => `${entry.type}:${entry.refId}`));
        for (const entry of [...existing.sourceEvidence, ...candidate.sourceEvidence]) {
          if (!seen.has(`${entry.type}:${entry.refId}`)) {
            merged.sourceEvidence = [...merged.sourceEvidence, entry];
            seen.add(`${entry.type}:${entry.refId}`);
          }
        }
        byRecording.set(candidate.recordingId, merged);
      }
    }
  }
  return [...byRecording.values()].sort((a, b) => a.recordingId.localeCompare(b.recordingId));
}

export function humanizeFeature(key: string): string {
  if (key.startsWith("tag:")) return `the "${key.slice(4).replaceAll("_", " ")}" tag`;
  return key.replaceAll("_", " ");
}
