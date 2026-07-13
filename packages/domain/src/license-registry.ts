import type { DataUse } from "./provenance.js";

/**
 * Code-owned, machine-readable data-source license registry (spec §6.3).
 *
 * This file is the source of truth; the `source_licenses` table is seeded from
 * it so runtime queries and database constraints can reference the same policy
 * versions. Changing any entry requires an ADR update and legal review where
 * the spec's platform-policy gate (§6.4) applies.
 *
 * Posture: DENY BY DEFAULT. `isUseAllowed` returns false for any
 * provider/dataset/use combination that is not explicitly permitted here.
 */

export interface LicensePolicy {
  /** Stable id referenced by provenance records, e.g. "musicbrainz-core@1". */
  id: string;
  provider: string;
  dataset: string;
  licenseId: string;
  licenseUrl: string;
  /** UTC date of the most recent human license review. */
  reviewedAt: string;
  permittedUses: readonly DataUse[];
  prohibitedUses: readonly DataUse[];
  attributionTemplate?: string;
  retentionDays?: number;
  notes: string;
}

export const LICENSE_REGISTRY: readonly LicensePolicy[] = [
  {
    id: "musicbrainz-core@1",
    provider: "musicbrainz",
    dataset: "core",
    licenseId: "CC0-1.0",
    licenseUrl: "https://musicbrainz.org/doc/About/Data_License",
    reviewedAt: "2026-07-13",
    permittedUses: [
      "display",
      "temporary_cache",
      "recommendation_feature",
      "model_training",
      "commercial_use",
      "redistribution",
    ],
    prohibitedUses: [],
    attributionTemplate: "Metadata from MusicBrainz (musicbrainz.org).",
    notes:
      "Core entity data (artists, recordings, releases, identifiers) is CC0. Provenance is still recorded for every field.",
  },
  {
    id: "musicbrainz-supplementary@1",
    provider: "musicbrainz",
    dataset: "supplementary",
    licenseId: "CC-BY-NC-SA-3.0",
    licenseUrl: "https://musicbrainz.org/doc/About/Data_License",
    reviewedAt: "2026-07-13",
    permittedUses: ["display", "temporary_cache"],
    prohibitedUses: ["recommendation_feature", "model_training", "commercial_use", "redistribution"],
    attributionTemplate: "Supplementary data from MusicBrainz (musicbrainz.org), CC BY-NC-SA.",
    notes:
      "Tags, ratings, annotations and derived data are noncommercial-licensed. Disabled for commercial/recommendation/training use unless a commercial agreement is recorded here via a new policy version.",
  },
  {
    id: "listenbrainz-api@1",
    provider: "listenbrainz",
    dataset: "api",
    licenseId: "UNREVIEWED",
    licenseUrl: "https://listenbrainz.readthedocs.io/",
    reviewedAt: "2026-07-13",
    permittedUses: [],
    prohibitedUses: [
      "display",
      "temporary_cache",
      "recommendation_feature",
      "model_training",
      "commercial_use",
      "redistribution",
    ],
    notes:
      "Not yet enabled. Endpoint-level terms, commercial use and training rights must be confirmed and recorded as a new policy version before any use (spec §6.3).",
  },
  {
    id: "spotify-export@1",
    provider: "spotify",
    dataset: "export-resolution",
    licenseId: "SPOTIFY-DEVELOPER-POLICY",
    licenseUrl: "https://developer.spotify.com/policy",
    reviewedAt: "2026-07-13",
    permittedUses: ["temporary_cache", "display"],
    prohibitedUses: ["recommendation_feature", "model_training", "commercial_use", "redistribution"],
    retentionDays: 1,
    notes:
      "Export-only boundary (spec §6.2). Temporary track resolution and playlist export exclusively; display is limited to user review of an export match. Never a recommendation feature, taste input, analytics dimension, or training datum.",
  },
  {
    id: "user-declarations@1",
    provider: "user",
    dataset: "declarations-and-feedback",
    licenseId: "FIRST-PARTY-CONSENT",
    licenseUrl: "about:blank",
    reviewedAt: "2026-07-13",
    permittedUses: ["display", "recommendation_feature", "model_training"],
    prohibitedUses: ["redistribution"],
    notes:
      "User-entered seeds, contexts, and first-party feedback/exposure events. Eligible only within recorded consent and purpose constraints; consent enforcement lands in Milestone 1.",
  },
  {
    id: "synthetic-fixtures@1",
    provider: "synthetic",
    dataset: "fixtures",
    licenseId: "INTERNAL",
    licenseUrl: "about:blank",
    reviewedAt: "2026-07-13",
    permittedUses: ["display", "temporary_cache", "recommendation_feature"],
    prohibitedUses: ["model_training", "commercial_use", "redistribution"],
    notes: "Synthetic test data generated in-repo. Never real provider content; never trains models.",
  },
];

export function getLicensePolicy(id: string): LicensePolicy | undefined {
  return LICENSE_REGISTRY.find((policy) => policy.id === id);
}

/**
 * Deny-by-default eligibility check. A use is allowed only when the policy
 * exists, explicitly permits the use, and does not also prohibit it.
 */
export function isUseAllowed(policyId: string, use: DataUse): boolean {
  const policy = getLicensePolicy(policyId);
  if (!policy) return false;
  if (policy.prohibitedUses.includes(use)) return false;
  return policy.permittedUses.includes(use);
}
