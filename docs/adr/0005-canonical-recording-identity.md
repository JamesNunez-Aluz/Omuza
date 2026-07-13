# ADR 0005 — Canonical recording identity

- Status: Accepted
- Date: 2026-07-13
- Owners: Resonance engineering
- Related policies/licenses: MusicBrainz CC0 core data; spec §8

## Context

Taste, exposure, feedback, and playlists must reference music identity that outlives any destination service and supports recording equivalence (same song, many releases).

## Decision

Internal UUIDs are the primary keys; MusicBrainz IDs (MBIDs) are the canonical external anchor (`canonical_mbid`, unique where present). Destination IDs live only in export-scoped tables with expiry (never in taste/feedback tables). Entity resolution confidence and equivalence handling are Milestone 1–2 work behind this identity model.

## Alternatives considered

- Destination (Spotify) IDs as canon: prohibited by ADR 0002 and non-portable.
- ISRC as primary: useful evidence for matching, but coverage is incomplete and it identifies recordings, not our resolution needs alone.

## Consequences

### Positive

- Playlists and taste survive destination outages, disconnects, and future providers.

### Negative

- Requires an entity-resolution investment and handling of catalog gaps (spec Scenario D).

## Security/privacy/license effects

Core identity data is CC0; provenance recorded per row via `license_policy_id`.

## Verification

`packages/db` schema (unique MBID constraints, FK to `source_licenses`); Milestone 1 disambiguation acceptance tests.

## Revisit triggers

MusicBrainz coverage proves insufficient for the target catalog; a licensed commercial catalog becomes worth adding as a second anchor.
