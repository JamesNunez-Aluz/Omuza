# ADR 0009 — Append-only feedback

- Status: Accepted
- Date: 2026-07-14
- Owners: Resonance engineering
- Related policies/licenses: spec §9.5, §10.7; ADR 0006 (evidence lineage)

## Context

Feedback is the company's core asset and must support revision, audit, deletion, and recomputation. Mutating feedback rows in place destroys lineage and makes double-counting bugs invisible.

## Decision

`feedback_events` is append-only, enforced by a database trigger (like consents). A user changing their mind appends a new event with `supersedes_event_id` pointing at the old one; derivation resolves supersede chains and only terminal events carry weight. Preference facts (`user_preferences` origin `first_party_feedback`) are always **recomputed from scratch** from the effective event set by a versioned pure function (`feedback-derivation@1`) — never incrementally mutated — so revisions cannot double-count and account deletion removes all influence by deleting the events and re-deriving (to nothing). Idempotency uses a unique `(user_id, client_event_id)`; duplicates return the original event. Weights follow spec §10.7: "not now" carries context-only weight, "already knew"/newness answers update the knowledge ledger and never taste, and reason codes add bounded weight only to eligible features actually present on the recording.

## Alternatives considered

- Mutable feedback row per (user, recording): simpler reads, but loses history, breaks auditing, and makes reversal semantics ambiguous.
- Incremental profile updates per event: cheaper, but drift and double-count bugs are undetectable without a recompute path anyway.

## Consequences

### Positive

- Recompute-from-evidence makes correctness testable as a pure function; reversal and deletion are trivially correct.

### Negative

- Derivation cost grows with event count; acceptable for years at expected volumes, then snapshot+delta if measured.

## Security/privacy/license effects

Feedback is Zone A, consent-scoped, deleted (not anonymized) on account deletion. Spotify can never be a feedback or knowledge source.

## Verification

DB trigger tests; `packages/domain/src/feedback.test.ts` (supersede chains, no double count, weight table semantics); worker recompute integration tests.

## Revisit triggers

Event volume making full recompute slow; feedback decay implementation (spec §10.7 decay is versioned with the model).
