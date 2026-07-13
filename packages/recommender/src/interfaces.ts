import type { FeatureRow, Provenance } from "@resonance/domain";

/**
 * Recommendation-domain interfaces (spec §7.4).
 *
 * COMPLIANCE BOUNDARY: this package must never import destination or provider
 * integrations (spec §6.2). Candidate providers are injected behind these
 * interfaces by the application layer; enforcement lives in
 * scripts/verify-policy-boundaries.ts and the root ESLint config.
 */

export interface ProviderHealth {
  status: "ok" | "degraded" | "unavailable" | "not_configured";
  detail?: string;
}

export interface CandidateRequest {
  userId: string;
  contextProfileId?: string;
  limit: number;
}

export interface Candidate {
  canonicalRecordingId: string;
  provenance: Provenance;
  features: FeatureRow[];
}

export interface CandidateBatch {
  providerId: string;
  candidates: Candidate[];
}

export interface CandidateProvider {
  readonly id: string;
  healthCheck(): Promise<ProviderHealth>;
  generateCandidates(request: CandidateRequest): Promise<CandidateBatch>;
}

export interface RankRequest {
  userId: string;
  candidates: Candidate[];
  /** Ranker version pin for reproducibility (CLAUDE.md: version the ranker). */
  rankerVersion: string;
  randomSeed: string;
}

export interface RankedCandidate extends Candidate {
  score: number;
  rank: number;
}

export interface Ranker {
  readonly version: string;
  rank(input: RankRequest): Promise<RankedCandidate[]>;
}

export interface ExplanationEvidence {
  kind: string;
  detail: string;
  /** Evidence must reference stored data; never invented properties. */
  sourceRef: string;
}

export interface RecommendationExplanation {
  canonicalRecordingId: string;
  summary: string;
  evidence: ExplanationEvidence[];
}

export interface ExplanationGenerator {
  explain(
    item: RankedCandidate,
    evidence: ExplanationEvidence[],
  ): Promise<RecommendationExplanation>;
}
