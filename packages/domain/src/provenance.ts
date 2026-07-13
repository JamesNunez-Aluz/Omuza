/**
 * Field-level provenance and eligibility (spec §6.1–§6.3, §8.5).
 *
 * Every catalog feature must carry provenance, a license-policy version, and
 * eligibility flags. Unknown license or provenance means ineligible.
 */

/** Data providers known to the system. Extend only alongside a license-registry entry. */
export type DataProvider =
  | "musicbrainz"
  | "listenbrainz"
  | "spotify"
  | "user"
  | "resonance"
  | "synthetic";

/** Uses a data source may be put to. Anything not explicitly permitted is prohibited. */
export type DataUse =
  | "display"
  | "temporary_cache"
  | "recommendation_feature"
  | "model_training"
  | "commercial_use"
  | "redistribution";

export const ALL_DATA_USES: readonly DataUse[] = [
  "display",
  "temporary_cache",
  "recommendation_feature",
  "model_training",
  "commercial_use",
  "redistribution",
];

export interface Provenance {
  provider: DataProvider;
  /** Provider-side dataset or endpoint identity, e.g. "core" or "export-search". */
  dataset: string;
  /** License-registry policy id this field was ingested under. */
  licensePolicyId: string;
  /** UTC ISO-8601 timestamp of ingestion. */
  ingestedAt: string;
}

/** A single feature value with the metadata required for eligibility decisions. */
export interface FeatureRow {
  canonicalRecordingId: string;
  feature: string;
  value: number;
  provenance: Provenance;
  trainingEligible: boolean;
  recommendationEligible: boolean;
}
