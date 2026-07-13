# Data dictionary

Milestone 0 tables (see `packages/db/migrations/`). All timestamps are UTC
`timestamptz`. Every catalog row carries provenance and a license policy
reference (ADR 0006).

## `source_licenses`

Machine-readable license registry, seeded from
`packages/domain/src/license-registry.ts` (code is source of truth).

| Column | Type | Notes |
|---|---|---|
| id | text PK | Versioned policy id, e.g. `musicbrainz-core@1` |
| provider | text | e.g. `musicbrainz`, `spotify`, `user`, `synthetic` |
| dataset | text | Provider-side dataset/endpoint identity |
| license_id | text | SPDX id or named policy |
| license_url | text | Where the license was reviewed |
| reviewed_at | date | Last human review |
| permitted_uses / prohibited_uses | text[] | `DataUse` values; deny-by-default outside `permitted_uses` |
| attribution_template | text? | Display attribution, when required |
| retention_days | int? | Mandatory for temporary-cache-only sources (Spotify: 1) |
| notes | text | Review rationale |

## `artists`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Internal canonical id |
| canonical_mbid | text unique? | MusicBrainz artist MBID when resolved |
| name | text | |
| provenance_provider | text | |
| license_policy_id | text FK → source_licenses | |
| ingested_at | timestamptz | |

## `recordings`

As `artists`, plus `title`, `primary_artist_id` (FK), `duration_ms?`. Recording
equivalence/multiple artists arrive in Milestone 1–2 (`recording_artists`,
`recording_external_ids` per spec §9.3).

## `recording_features`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| recording_id | uuid FK cascade | |
| feature | text | Feature name, e.g. `tempo_bucket` |
| value | double precision | |
| provenance_provider / provenance_dataset | text | |
| license_policy_id | text FK | |
| training_eligible | bool default false | **CHECK: false when provider = 'spotify'** |
| recommendation_eligible | bool default false | **CHECK: false when provider = 'spotify'** |
| ingested_at | timestamptz | |

Unique on (recording_id, feature, provenance_provider, provenance_dataset).

## `schema_migrations`

Migrator bookkeeping: name, sha256 hash (tamper detection), applied_at.

## pg-boss tables

`pgboss.*` schema is owned by pg-boss (ADR 0008). Job payloads carry IDs only —
no personal data, no provider payloads.
