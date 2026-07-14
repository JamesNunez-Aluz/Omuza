// Legacy M0 interfaces; the engine's Candidate supersedes the M0 one.
export type {
  ProviderHealth,
  CandidateRequest,
  CandidateBatch,
  Candidate as LegacyCandidate,
  RankRequest,
  RankedCandidate,
  Ranker,
  ExplanationEvidence,
  RecommendationExplanation,
  ExplanationGenerator,
} from "./interfaces.js";
export {
  DeterministicRanker,
  DETERMINISTIC_RANKER_VERSION,
} from "./ranking/deterministic-ranker.js";
export * from "./engine/types.js";
export { generateRecommendations } from "./engine/pipeline.js";
export { computeTastePosterior } from "./engine/taste-posterior.js";
export type { TastePosterior } from "./engine/taste-posterior.js";
export { providerBudgets, dedupeCandidates } from "./engine/providers.js";
export type { ProviderBatchResult } from "./engine/providers.js";
export { applyHardFilters } from "./engine/hard-filters.js";
export { estimateNovelty } from "./engine/novelty.js";
export { scoreCandidate } from "./engine/scoring.js";
export { selectWithMmr, similarity } from "./engine/selection.js";
export { explainItem } from "./engine/explanations.js";
export { evaluateResult } from "./evaluation/harness.js";
export type { EvaluationMetrics } from "./evaluation/harness.js";
export { stableUnit, weightedSample } from "./engine/rng.js";
