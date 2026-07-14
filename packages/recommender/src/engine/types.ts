/**
 * Recommendation engine v0 (spec §10): a pure, reproducible pipeline over an
 * injected catalog snapshot and first-party taste profile. This package never
 * touches the database or any destination integration — the worker assembles
 * inputs and persists outputs.
 */

export interface SnapshotFeature {
  feature: string;
  value: number;
  licensePolicyId: string;
  provenanceProvider: string;
  recommendationEligible: boolean;
}

export interface SnapshotRecording {
  id: string;
  title: string;
  primaryArtistId: string;
  primaryArtistName: string;
  isExplicit: boolean | null;
  languageCode: string | null;
  firstReleaseDate: string | null;
  licensePolicyId: string;
  provenanceProvider: string;
  features: SnapshotFeature[];
}

export interface CatalogSnapshot {
  recordings: SnapshotRecording[];
}

export interface ProfileSeed {
  id: string;
  entityType: "artist" | "recording";
  entityId: string;
  sentiment: "strong_positive" | "positive" | "negative" | "hard_block" | "fatigue";
  strength: number;
  contextId: string | null;
}

export interface TasteProfileSnapshot {
  version: string;
  seeds: ProfileSeed[];
}

export interface RunContextSettings {
  explicitContentPolicy: "allowed" | "blocked" | "context_specific";
  languageBlocklist: string[];
  eraStartYear: number | null;
  eraEndYear: number | null;
}

export interface UserHistory {
  exposedRecordingIds: string[];
  knownRecordings: { recordingId: string; knowledgeState: string; confidence: number }[];
}

export interface EngineRequest {
  requestedCount: number;
  discoveryLevel: number; // 0..100
  randomSeed: string;
  context: RunContextSettings | null;
  excludeRecordingIds: string[];
  preserveRecordingIds: string[];
  /** Cap on deduplicated candidates before filtering (spec §10.4). */
  maxCandidates?: number;
}

export interface Candidate {
  recordingId: string;
  provider: string;
  providerStrategy: string;
  providerRank: number;
  providerScore: number;
  /** Human-auditable evidence for why this candidate was proposed. */
  sourceEvidence: EvidenceRecord[];
}

export interface EvidenceRecord {
  type:
    | "explicit_seed"
    | "explicit_preference"
    | "feature_match"
    | "context_match"
    | "novelty_rationale"
    | "provider_path"
    | "diversity_rationale";
  label: string;
  /** Reference into first-party stored data (seed id, feature key, …). */
  refId: string;
}

export interface ScoredCandidate extends Candidate {
  fitScore: number;
  noveltyProbability: number;
  noveltyState: "high_confidence_new" | "probably_new" | "unknown" | "known";
  noveltyConfidence: number;
  serendipityScore: number;
  qualityScore: number;
  freshnessScore: number;
  knownProbability: number;
  fatiguePenalty: number;
  aversionRisk: number;
  metadataUncertainty: number;
  finalScore: number;
  fitEvidence: EvidenceRecord[];
}

export interface RejectedCandidate extends Candidate {
  rejectionReasons: string[];
}

export interface SelectedItem {
  candidate: ScoredCandidate;
  position: number;
  selectionReason: string;
  explanation: {
    templateKey: string;
    renderedText: string;
    evidence: EvidenceRecord[];
    generatorVersion: string;
  };
}

export interface EngineResult {
  items: SelectedItem[];
  eligible: ScoredCandidate[];
  rejected: RejectedCandidate[];
  constraintRelaxations: string[];
  degradedProviders: string[];
}

export const RANKER_VERSION = "ranker@0.2.0";
export const SELECTOR_VERSION = "selector-mmr@0.1.0";
export const EXPLAINER_VERSION = "explainer-template@0.1.0";
