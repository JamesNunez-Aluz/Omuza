# ADR 0006 — Field-level provenance and license registry

- Status: Accepted
- Date: 2026-07-13
- Owners: Resonance engineering
- Related policies/licenses: spec §6.3, §8.5; all registry entries

## Context

"Where did this field come from and what may we do with it?" must be answerable per feature, or license compliance decays into folklore.

## Decision

A code-owned registry (`packages/domain/src/license-registry.ts`) is the source of truth, mirrored into the `source_licenses` table by an idempotent seed. Every catalog row and feature carries `provenance_provider`, dataset, and a versioned `license_policy_id` foreign key. Eligibility is deny-by-default: `isUseAllowed` returns false for anything not explicitly permitted, and a use listed as prohibited wins over permitted. Policy changes create new versions (`provider-dataset@N`), never mutate history.

## Alternatives considered

- Database-only registry: loses code review/ADR gating on policy changes.
- Table-level (not field-level) licensing: too coarse — MusicBrainz core vs supplementary differ within one provider.

## Consequences

### Positive

- Training/recommendation eligibility is computable, testable, and enforced in three layers (code, CI script, database constraint).

### Negative

- Ingestion must thread policy IDs everywhere; slightly more verbose schemas.

## Security/privacy/license effects

Prevents accidental commercial use of noncommercial data (MusicBrainz supplementary); makes unknown-license data unusable rather than silently used.

## Verification

`scripts/verify-feature-provenance.ts` (blocking); domain registry tests; db FK + CHECK constraints; validation schema tests.

## Revisit triggers

Any new provider or dataset; any provider license change; quarterly platform-policy review (spec §6.4).
