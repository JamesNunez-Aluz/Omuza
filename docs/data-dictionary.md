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

## Recommendation lifecycle (Milestone 2)

- **`recommendation_runs`** — status queued→generating→completed/degraded/
  failed/cancelled; requested_count (10–50), discovery_level, versions
  (`ranker_version`, `selector_version`, `profile_snapshot_version`),
  `random_seed` (reproducibility pin), `degraded_providers`,
  `constraint_relaxations`, redacted failure fields.
- **`recommendation_candidates`** — full decision trace: every considered
  candidate with provider/strategy/rank/score, eligible-features-only
  `feature_snapshot` (score breakdown + evidence), eligibility decision,
  rejection reasons, base/final score, selected flag.
- **`recommendation_items`** — final list: position, score, novelty
  probability/state/confidence, selection reason; unique (run, position) and
  (run, recording).
- **`recommendation_explanations`** — template key, rendered text, evidence
  JSON (typed records referencing first-party data), generator
  (template|llm) + version, validated flag.
- **`exposures`** — recorded at first owner view of a completed run (a
  *shown* recommendation), with novelty state/probability at exposure.
- **`known_recordings`** — user knowledge states (confirmed_known,
  confirmed_new, ledger_known, unknown) with confidence and source;
  **CHECK: source ≠ 'spotify'**.

## Feedback, playlists, analytics (Milestone 3)

- **`feedback_events`** — **append-only** (trigger; UPDATE always rejected,
  DELETE only via the privacy-purge carve-out `resonance.allow_feedback_purge`):
  primary_response (love/like/neutral/dislike/not_now/already_knew),
  reason_codes[], newness_response, context_id, `supersedes_event_id`
  (revision chains — only terminal events carry weight), unique
  (user_id, client_event_id) for idempotency. Derived facts live in
  `user_preferences` origin `first_party_feedback`
  (namespaces feedback_entity / feedback_feature, `feedback-derivation@1`)
  and are recomputed, never mutated (ADR 0009).
- **`playlists`** — name, description, context/run lineage, status,
  `version` (optimistic concurrency).
- **`playlist_items`** — position, recording FK,
  `source_recommendation_item_id` lineage, soft delete via `removed_at`.
- **`analytics_events`** — semantic event names with strictly-typed minimal
  properties (Zod-validated, unknown keys rejected). No free text, emails,
  or provider payloads by construction; verified by tests. Powers
  `pnpm report:funnel`.

## Destination zone (Milestone 4 — Zone C, export only)

Nothing in this section may ever be joined into recommendation features,
taste tables, analytics of taste, or training data (spec §6.2; policy gates
R1–R6/P4–P7). Deleted on disconnect and on account deletion.

- **`service_connections`** — one active per (user, service); status
  active/expired/revoked/error, exact granted `scope_set`,
  `reauthorization_due_at` reminder.
- **`encrypted_oauth_credentials`** — AES-256-GCM ciphertext + nonce + auth
  tag + `key_version` (ADR 0012); cascade-deleted with the connection.
- **`oauth_transactions`** — one-time OAuth state (hashed) + encrypted PKCE
  verifier; 10-minute expiry; purged by `pnpm purge:provider-data`.
- **`exports`** — §12.8 state machine with persisted
  `destination_playlist_id` (retries never create a second playlist),
  supersede lineage, per-batch counts, unique
  (user, destination, idempotency_key).
- **`export_item_resolutions`** — temporary match cache: destination ids,
  method, confidence, display fields for review, **mandatory `expires_at`**
  (24h), purged on schedule and expired on disconnect.

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
