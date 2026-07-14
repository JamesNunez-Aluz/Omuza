# ADR 0011 — Evidence-only explanations

- Status: Accepted
- Date: 2026-07-14
- Owners: Resonance engineering
- Related policies/licenses: spec §10.15, §2.2 P4; ADR 0015

## Context

Explanations create trust only if they are true. Invented musical claims ("sounds like…", "same chord progression…") are unverifiable and eventually wrong.

## Decision

Every recommendation explanation is generated from stored evidence records (seed relationships, feature matches with license-eligible catalog features, novelty rationale, diversity rationale) referencing first-party data by id. Milestone 2 ships deterministic templates only (`explainer-template@0.1.0`); an item with **no** valid evidence is omitted from the list rather than explained speculatively. The forbidden-claims list from spec §10.15 is enforced by tests over rendered output. When the LLM generator arrives (ADR 0015), the template generator remains the permanent fallback, and LLM output must reference the same validated evidence ids, pass prohibited-claim checks, and fall back on any failure.

## Alternatives considered

- Free-form generated copy: better prose, unverifiable claims.
- No explanations: forfeits the product's core differentiator (P4).

## Consequences

### Positive

- Every sentence shown is auditable against `recommendation_explanations.evidence`.

### Negative

- Template prose is plain; improving it means adding evidence classes, not adjectives.

## Security/privacy/license effects

Evidence labels expose no internal affinity values, provider payloads, or other users' data.

## Verification

Pipeline golden test "no unsupported claims"; explanation unit behavior in `explanations.ts`; `recommendation_explanations.validated` column.

## Revisit triggers

LLM explanation generator (M2+/M3); new evidence classes; localization.
