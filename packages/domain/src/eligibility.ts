import { isUseAllowed } from "./license-registry.js";
import type { FeatureRow } from "./provenance.js";

/**
 * Training-data assertion (spec §6.2). Dataset builders must call this before
 * any feature row can enter a training set. Spotify-sourced rows are rejected
 * unconditionally, independent of what their flags claim.
 */
export function assertTrainingEligible(rows: readonly FeatureRow[]): void {
  const prohibited = rows.filter(
    (row) =>
      row.trainingEligible !== true ||
      row.provenance.provider === "spotify" ||
      !isUseAllowed(row.provenance.licensePolicyId, "model_training"),
  );

  if (prohibited.length > 0) {
    throw new Error(
      `Training dataset contains ${prohibited.length} prohibited row(s): ` +
        prohibited
          .map((row) => `${row.feature}[${row.provenance.provider}/${row.provenance.licensePolicyId}]`)
          .join(", "),
    );
  }
}

/**
 * Recommendation-feature eligibility. Unknown license or provenance means
 * ineligible; Spotify provenance is never eligible (spec §6.2).
 */
export function isRecommendationEligible(row: FeatureRow): boolean {
  if (row.provenance.provider === "spotify") return false;
  if (!row.recommendationEligible) return false;
  return isUseAllowed(row.provenance.licensePolicyId, "recommendation_feature");
}
