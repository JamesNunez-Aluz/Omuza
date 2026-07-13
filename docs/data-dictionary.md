# Data dictionary

Tables from migrations 0000–0001 (see `packages/db/migrations/`). All
timestamps are UTC `timestamptz`. Every catalog row carries provenance and a
license policy reference (ADR 0006). Taste tables contain no
destination-service fields — enforced by `pnpm policy:check` (rule P5).

## Identity and consent (Zone A)

- **`users`** — id, `email_normalized` (unique), display_name, status
  (active/suspended/deletion_pending/deleted), locale, time_zone,
  `onboarding_completed_at`, timestamps, `deleted_at`. Deletion anonymizes:
  email becomes `deleted:<id>`.
- **`auth_tokens`** — passwordless login tokens: `token_hash` (sha-256, the
  secret itself is never stored), 15-minute expiry, single-use
  (`consumed_at`), indexed per email for rate limiting.
- **`sessions`** — `token_hash` (unique), expiry (7 days), `last_seen_at`,
  `rotated_from` (rotation lineage), `revoked_at`.
- **`consent_records`** — **append-only** (database trigger rejects
  UPDATE/DELETE): purpose, immutable `policy_version`, status
  granted/withdrawn, occurred_at, source. Latest record per purpose wins.
  Retained in anonymized form after account deletion as a legal record.

## Taste and context (Zone A)

- **`user_seed_items`** — entity_type artist|recording with a CHECK that
  exactly one entity FK is set; sentiment (strong_positive, positive,
  negative, hard_block, fatigue), strength 0–1, optional `context_id`,
  `declared_at`, `removed_at` (soft delete preserves history).
- **`context_profiles`** — name (unique per user), optional system_key,
  discovery_level 0–100, explicit/familiarity/popularity/vocal policies,
  language allow/blocklists, era range, `structured_intent` jsonb (declared
  free text; parsed intent arrives with the LLM layer).
- **`user_preferences`** — namespace/key facts with preference_value −1..1,
  confidence 0..1, evidence_count, origin (explicit | first_party_feedback |
  derived — never mixed irreversibly), `model_version`
  (e.g. `seed-derivation@1`). The explicit/seed_entity slice is fully
  recomputed from active seeds by the worker.
- **`preference_evidence`** — lineage per preference: event_type,
  source_entity_id (seed id), weight, optional `reversal_of_id`.

## Privacy and audit

- **`privacy_requests`** — kind export|delete, status queued → processing →
  completed/failed, export payload jsonb (retention job scheduled for M5).
- **`audit_events`** — action, entity, occurred_at, minimal metadata; kept
  anonymized after deletion.
- **`idempotency_keys`** — (key, user, route) → request hash + stored
  response for retry-safe mutations.

## Catalog additions (Zone B)

- **`artists`** now carries sort_name, disambiguation, country_code,
  begin/end dates.
- **`recordings`** now carries language_code, is_explicit, first_release_date,
  disambiguation, status (active/merged/retired).
- **`recording_artists`** — credited artists with position and join phrase;
  PK (recording_id, artist_id, position).
- **`recording_external_ids`** — ISRC etc. with provenance + license FK;
  unique (provider, id_type, external_id).
- **`catalog_source_records`** — source lineage (provider, entity, external
  id, content hash) without storing raw payloads.
- **`catalog_search_cache`** — 24h provider search cache (etiquette + speed).

## Milestone 0 tables

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
