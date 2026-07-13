# ADR 0002 — Spotify export-only boundary

- Status: Accepted
- Date: 2026-07-13
- Owners: Resonance engineering
- Related policies/licenses: Spotify Developer Policy/ToS; spec §6.2; registry `spotify-export@1`

## Context

Spotify data must never influence recommendations, taste profiles, taste analytics, or model training. Convention alone will not survive feature pressure; the boundary must be structural.

## Decision

`packages/integrations/spotify` is the only code allowed to speak to Spotify, for exactly three capabilities: OAuth connection, temporary track resolution, playlist export. Raw payload types stay package-local; the only exported DTO is `ExportResolution` (canonical ID, destination URI/ID, confidence, match method, temporary display fields, mandatory expiry). Enforcement is layered: ESLint restricted imports, `scripts/verify-policy-boundaries.ts` (blocking CI gate), database CHECK constraints (`spotify_never_training_eligible`, `spotify_never_recommendation_eligible`), license registry prohibitions, and fixture policy tests.

## Alternatives considered

- Application-level guards only: too easy to bypass in a refactor.
- A separate microservice for Spotify: stronger isolation but violates the modular-monolith decision (ADR 0003) without measured need.

## Consequences

### Positive

- A prohibited data flow requires deliberately defeating five independent controls, each of which fails CI.

### Negative

- Export features pay an adapter/DTO translation tax; some duplication of display fields.

## Security/privacy/license effects

OAuth tokens will be encrypted at rest (ADR 0012, Milestone 4); export cache rows carry expiry and a purge obligation; disconnect always works regardless of feature flags.

## Verification

`pnpm policy:check`; `packages/testkit` fixture policy tests; db integration tests; Spotify adapter kill-switch tests.

## Revisit triggers

Spotify platform policy changes; adding another destination (generalize, don't weaken); Milestone 4 implementation review.
