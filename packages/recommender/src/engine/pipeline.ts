import { explainItem } from "./explanations.js";
import { applyHardFilters } from "./hard-filters.js";
import {
  catalogExplorationProvider,
  dedupeCandidates,
  providerBudgets,
  seedNeighborhoodProvider,
} from "./providers.js";
import type { ProviderBatchResult } from "./providers.js";
import { scoreCandidate } from "./scoring.js";
import { selectWithMmr } from "./selection.js";
import { computeTastePosterior } from "./taste-posterior.js";
import type {
  CatalogSnapshot,
  EngineRequest,
  EngineResult,
  TasteProfileSnapshot,
  UserHistory,
} from "./types.js";

/**
 * The v0 engine pipeline (spec §10.1): retrieval → canonicalization/dedupe →
 * hard filters → scoring → diversity-aware selection → evidence-backed
 * explanations. Pure and reproducible: identical inputs (snapshot, profile,
 * history, request incl. randomSeed) yield an identical playlist.
 *
 * `externalBatches` carries pre-fetched Strategy-B provider results (e.g.
 * ListenBrainz) so this package performs no I/O; `degradedProviders` lists
 * providers that failed upstream and is passed through to the result.
 */
export function generateRecommendations(
  snapshot: CatalogSnapshot,
  profile: TasteProfileSnapshot,
  history: UserHistory,
  request: EngineRequest,
  externalBatches: ProviderBatchResult[] = [],
  degradedProviders: string[] = [],
): EngineResult {
  const posterior = computeTastePosterior(snapshot, profile.seeds);
  const maxCandidates = request.maxCandidates ?? 400;
  const budgets = providerBudgets(
    request.discoveryLevel,
    maxCandidates,
    externalBatches.length > 0,
  );

  const batches: ProviderBatchResult[] = [
    seedNeighborhoodProvider(snapshot, posterior, request, budgets.seedNeighborhood),
    catalogExplorationProvider(snapshot, posterior, request, budgets.exploration),
    ...externalBatches.map((batch) => ({
      ...batch,
      candidates: batch.candidates.slice(0, budgets.collaborative),
    })),
  ];

  const deduped = dedupeCandidates(batches);
  const filtered = applyHardFilters(deduped, snapshot, posterior, request);

  const scored = filtered.eligible.map((entry) =>
    scoreCandidate(entry, posterior, history, request),
  );

  const recordingsById = new Map(snapshot.recordings.map((recording) => [recording.id, recording]));
  const selection = selectWithMmr(scored, recordingsById, posterior, request);

  const items = [];
  let position = 1;
  for (const { candidate, selectionReason } of selection.selected) {
    const recording = recordingsById.get(candidate.recordingId)!;
    const explanation = explainItem(candidate, recording);
    if (!explanation) {
      // No valid evidence → the item is omitted, never explained speculatively
      // (spec §21 M2 acceptance).
      continue;
    }
    items.push({ candidate, position, selectionReason, explanation });
    position += 1;
  }

  return {
    items,
    eligible: scored,
    rejected: filtered.rejected,
    constraintRelaxations: selection.relaxations,
    degradedProviders,
  };
}
