# ADR 0016 — First-party taste-language embeddings

- Status: Accepted (design constraint; implementation deferred)
- Date: 2026-07-13
- Owners: Resonance engineering
- Related policies/licenses: spec §10.20, §26; registry `user-declarations@1`

## Context

Users describe taste in language ("cinematic but not sad"). Embedding that language can power context matching — but embedding inputs are a data-provenance surface like any other feature.

## Decision

Taste-language embeddings, when introduced, obey the same provenance regime as catalog features:

- **Eligible inputs only**: user-entered free text with recorded consent, first-party feedback reason codes, and catalog text whose license permits `recommendation_feature` use.
- **Prohibited inputs**: any Spotify-derived text or metadata, unreviewed provider data, and LLM-fabricated descriptions of recordings.
- Every embedding row records source references, the embedding model + version, and a license policy id; `pgvector` is introduced only at that point (spec §7.1).
- Re-embedding on model upgrade creates new versioned rows; old versions remain for reproducibility until purged by retention policy.

## Alternatives considered

- Embedding whatever text is at hand (scraped reviews, provider blurbs): fast but unlicensable and unenforceable later.

## Consequences

### Positive

- Embeddings inherit the deny-by-default eligibility machinery already built in Milestone 0.

### Negative

- Some useful public text will be unusable until licensed.

## Security/privacy/license effects

User free text is personal data: consent-scoped, never logged raw, purgeable on account deletion.

## Verification

Future: embedding-table FK to `source_licenses`; dataset-builder checks via `assertTrainingEligible`; provenance script extension.

## Revisit triggers

First embedding implementation (Milestone 2+); embedding-model provider changes; consent-model changes.
