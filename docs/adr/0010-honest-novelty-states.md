# ADR 0010 — Honest novelty states

- Status: Accepted
- Date: 2026-07-14
- Owners: Resonance engineering
- Related policies/licenses: spec §5.3, §10.9; product principle P8 (honest uncertainty)

## Context

"New to you" is the product's core promise, but newness is fundamentally probabilistic until the user confirms it. Overclaiming destroys the trust the brand depends on.

## Decision

Novelty is a probability with an explicit confidence, mapped to five states (`confirmed_new`, `high_confidence_new`, `probably_new`, `unknown`, `known`). The v0 heuristic (spec §10.9) uses only permitted first-party evidence: prior exposures, seed relationships, and user knowledge records. Unavailable components (exposure bands, independent ledgers, provider confidence) are dropped with weights renormalized and **confidence reduced accordingly** — in v0 confidence is capped at 0.63, which makes `high_confidence_new` structurally unreachable until better evidence sources exist. `confirmed_new` is set only by an explicit user answer, never by the engine. Spotify is never a novelty evidence source (`known_recordings` CHECK constraint). Default copy is "probably new to you", never "you have never heard this".

## Alternatives considered

- Binary new/not-new flag: simpler UI but dishonest at low evidence.
- Claiming high confidence from absence of evidence: absence is not evidence of newness.

## Consequences

### Positive

- The novelty badge can be trusted; calibration (Brier score, reliability curves) becomes possible once confirmations arrive (M3).

### Negative

- Early lists show many "unknown/probably new" badges; the UI renders uncertainty as texture, not apology (spec §14.5).

## Security/privacy/license effects

Novelty evidence is Zone A only. No destination data can enter the estimate.

## Verification

`packages/recommender/src/engine/novelty.ts` + pipeline golden tests (no `confirmed_new` from the engine; seeded artists lower novelty; known history wins); `known_recordings_no_spotify_source` constraint.

## Revisit triggers

First user newness confirmations (M3 feedback); adding an approved listening ledger; calibration drift.
