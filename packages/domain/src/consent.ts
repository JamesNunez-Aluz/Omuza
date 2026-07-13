/**
 * Consent model (spec §9.1). Records are append-only: a change of mind is a
 * new record, never a mutation — the database enforces this with a trigger,
 * and this module defines the vocabulary and current policy versions.
 */

export const CONSENT_PURPOSES = [
  "terms_privacy",
  "core_personalization",
  "analytics",
  "model_improvement",
  "research",
  "marketing",
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export type ConsentStatus = "granted" | "withdrawn";

/**
 * Version identifiers of the consent text presented to users. Bump when the
 * corresponding policy copy changes; historical records keep old versions.
 */
export const CURRENT_POLICY_VERSIONS: Record<ConsentPurpose, string> = {
  terms_privacy: "terms-privacy@2026-07-13",
  core_personalization: "core-personalization@2026-07-13",
  analytics: "analytics@2026-07-13",
  model_improvement: "model-improvement@2026-07-13",
  research: "research@2026-07-13",
  marketing: "marketing@2026-07-13",
};

/** Purposes that must be granted before onboarding can proceed. */
export const REQUIRED_ONBOARDING_PURPOSES: readonly ConsentPurpose[] = [
  "terms_privacy",
  "core_personalization",
];

/** Purposes offered as genuinely optional during onboarding (no dark patterns). */
export const OPTIONAL_ONBOARDING_PURPOSES: readonly ConsentPurpose[] = [
  "model_improvement",
  "research",
];

export interface ConsentState {
  purpose: ConsentPurpose;
  status: ConsentStatus;
  policyVersion: string;
  occurredAt: string;
}

/** Latest record per purpose wins; absence of a record means not granted. */
export function effectiveConsent(records: readonly ConsentState[]): Map<ConsentPurpose, ConsentState> {
  const byPurpose = new Map<ConsentPurpose, ConsentState>();
  for (const record of records) {
    const existing = byPurpose.get(record.purpose);
    if (!existing || record.occurredAt > existing.occurredAt) {
      byPurpose.set(record.purpose, record);
    }
  }
  return byPurpose;
}

export function hasGranted(records: readonly ConsentState[], purpose: ConsentPurpose): boolean {
  return effectiveConsent(records).get(purpose)?.status === "granted";
}
