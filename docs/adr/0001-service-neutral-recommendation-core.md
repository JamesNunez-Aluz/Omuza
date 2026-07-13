# ADR 0001 — Service-neutral recommendation core

- Status: Accepted
- Date: 2026-07-13
- Owners: Resonance engineering
- Related policies/licenses: Spotify Developer Policy; spec §1, §6

## Context

The product's defensible asset is a first-party taste/outcome graph. Building recommendation logic on any streaming platform's data makes the company a policy violation away from shutdown and the recommendations non-portable across destinations.

## Decision

The recommendation engine operates exclusively on service-neutral inputs: user declarations, first-party feedback/exposure events, and licensed/open canonical catalog data. Destination services (Spotify first) are export adapters only. Canonical identity comes from the independent catalog (ADR 0005), never from destination IDs.

## Alternatives considered

- Spotify-first build using its API for profiles/features: fastest demo, prohibited by platform policy for our use, and creates existential platform risk.
- Multi-provider abstraction over several streaming APIs: still inherits every provider's restrictions; no first-party asset accrues.

## Consequences

### Positive

- The core product works with zero streaming connections (`FEATURE_SPOTIFY_EXPORT=false`).
- Every taste datum is owned, consented, and model-eligible by construction.

### Negative

- Cold start is harder: onboarding must collect explicit seeds instead of importing history.
- Catalog quality depends on MusicBrainz coverage and our entity resolution.

## Security/privacy/license effects

Removes destination personal data from the profiling path entirely; shrinks the platform-policy surface to export flows.

## Verification

`pnpm policy:check` (scripts/verify-policy-boundaries.ts R1/R2), domain eligibility tests, db CHECK constraints in `packages/db/migrations/0000_init.sql`.

## Revisit triggers

A destination platform offers a licensed, contractually safe recommendation-data agreement; or the independent catalog proves insufficient for MVP quality.
