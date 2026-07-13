# ADR 0004 — First-party authentication

- Status: Accepted
- Date: 2026-07-13
- Owners: Resonance engineering
- Related policies/licenses: spec §6.2 control 12, §9.1

## Context

Using Spotify (or any destination) as the identity provider couples account existence to a platform relationship the product is designed to survive without, and violates the service-neutral core.

## Decision

Resonance accounts are first-party: email-based auth with sessions managed in our database (implementation in Milestone 1). Destination connections are optional, per-service links owned by `service_connections`, never identity. Spotify is never an authentication provider.

## Alternatives considered

- "Sign in with Spotify": lowest friction for the target audience but structurally ties identity to the export destination.
- Third-party neutral IdP (e.g. generic OAuth SaaS): viable later; deferred to keep the privacy story simple and data residency first-party.

## Consequences

### Positive

- Users can delete a destination connection without losing their taste profile.

### Negative

- We own credential security (hashing, session fixation, rate limiting) — tested in Milestone 1 acceptance.

## Security/privacy/license effects

Personal identity data is minimized and lives only in Zone A; consent records version every grant.

## Verification

Milestone 1 session/IDOR security tests; policy script R2 keeps Spotify out of identity code paths.

## Revisit triggers

Enterprise/SSO demand; measured onboarding drop-off attributable to account creation.
