-- Milestone 1: identity, consent, taste, context, privacy, catalog extensions.
-- Conventions: UTC timestamptz; append-only where history matters; user-scoped
-- personal data (Zone A). Taste tables contain NO destination-service fields
-- (spec §21 M1 acceptance) — enforced by policy test.

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table users (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null unique,
  display_name text,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'deletion_pending', 'deleted')),
  locale text not null default 'en',
  time_zone text not null default 'UTC',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Passwordless email login tokens (spec §16.2). Stored hashed, single-use.
create table auth_tokens (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null,
  token_hash text not null unique,
  purpose text not null default 'login' check (purpose in ('login')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_tokens_email_created_idx on auth_tokens (email_normalized, created_at);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  rotated_from uuid,
  revoked_at timestamptz
);
create index sessions_user_idx on sessions (user_id);

-- ---------------------------------------------------------------------------
-- Consent (append-only; spec §9.1)
-- ---------------------------------------------------------------------------

create table consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  purpose text not null check (purpose in
    ('terms_privacy', 'core_personalization', 'analytics', 'model_improvement', 'research', 'marketing')),
  policy_version text not null,
  status text not null check (status in ('granted', 'withdrawn')),
  occurred_at timestamptz not null default now(),
  source text not null default 'web',
  metadata jsonb not null default '{}'::jsonb
);
create index consent_records_user_purpose_idx on consent_records (user_id, purpose, occurred_at desc);

create function consent_records_append_only() returns trigger as $$
begin
  raise exception 'consent_records is append-only: % is not permitted', tg_op;
end;
$$ language plpgsql;

create trigger consent_records_no_update
  before update or delete on consent_records
  for each row execute function consent_records_append_only();

-- ---------------------------------------------------------------------------
-- Catalog extensions (spec §9.3)
-- ---------------------------------------------------------------------------

alter table artists
  add column sort_name text,
  add column disambiguation text,
  add column country_code text,
  add column begin_date text,
  add column end_date text,
  add column updated_at timestamptz not null default now();

alter table recordings
  add column language_code text,
  add column is_explicit boolean,
  add column first_release_date text,
  add column disambiguation text,
  add column status text not null default 'active' check (status in ('active', 'merged', 'retired')),
  add column updated_at timestamptz not null default now();

create table recording_artists (
  recording_id uuid not null references recordings (id) on delete cascade,
  artist_id uuid not null references artists (id),
  credit_name text not null,
  position integer not null,
  join_phrase text,
  primary key (recording_id, artist_id, position)
);

create table recording_external_ids (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references recordings (id) on delete cascade,
  id_type text not null check (id_type in ('isrc')),
  provider text not null,
  external_id text not null,
  provenance_provider text not null,
  license_policy_id text not null references source_licenses (id),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  unique (provider, id_type, external_id)
);

-- Source lineage without storing raw provider payloads (spec §9.3).
create table catalog_source_records (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  entity_type text not null check (entity_type in ('artist', 'recording')),
  external_id text not null,
  content_hash text not null,
  license_policy_id text not null references source_licenses (id),
  fetched_at timestamptz not null default now(),
  unique (provider, entity_type, external_id)
);

-- Provider search cache (spec §21 M1 "provider rate limiting and cache").
create table catalog_search_cache (
  query_hash text primary key,
  query text not null,
  response jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- ---------------------------------------------------------------------------
-- Taste and context (spec §9.4). No destination-service fields, ever.
-- ---------------------------------------------------------------------------

create table context_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null,
  system_key text check (system_key in
    ('general', 'focus', 'drive', 'workout', 'wind_down', 'social')),
  discovery_level integer not null default 50 check (discovery_level between 0 and 100),
  explicit_content_policy text not null default 'allowed'
    check (explicit_content_policy in ('allowed', 'blocked', 'context_specific')),
  familiarity_preference text not null default 'balanced'
    check (familiarity_preference in ('mostly_adjacent', 'balanced', 'farther_afield')),
  popularity_preference text not null default 'any'
    check (popularity_preference in ('any', 'avoid_hits', 'deep_cuts')),
  vocal_preference text not null default 'any'
    check (vocal_preference in ('any', 'mostly_vocal', 'mostly_instrumental')),
  language_allowlist text[] not null default '{}',
  language_blocklist text[] not null default '{}',
  era_start_year integer check (era_start_year between 1900 and 2100),
  era_end_year integer check (era_end_year between 1900 and 2100),
  structured_intent jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, name)
);

create table user_seed_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  entity_type text not null check (entity_type in ('artist', 'recording')),
  artist_id uuid references artists (id),
  recording_id uuid references recordings (id),
  sentiment text not null check (sentiment in
    ('strong_positive', 'positive', 'negative', 'hard_block', 'fatigue')),
  strength numeric(3, 2) not null default 1.0 check (strength between 0 and 1),
  context_id uuid references context_profiles (id),
  declared_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint seed_exactly_one_entity check (
    (entity_type = 'artist' and artist_id is not null and recording_id is null) or
    (entity_type = 'recording' and recording_id is not null and artist_id is null)
  )
);
create index user_seed_items_user_idx on user_seed_items (user_id) where removed_at is null;

create table user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  context_id uuid references context_profiles (id),
  namespace text not null,
  key text not null,
  preference_value numeric(4, 3) not null check (preference_value between -1 and 1),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  evidence_count integer not null default 1,
  origin text not null check (origin in ('explicit', 'first_party_feedback', 'derived')),
  last_evidence_at timestamptz not null default now(),
  model_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (user_id, context_id, namespace, key, origin)
);

create table preference_evidence (
  id uuid primary key default gen_random_uuid(),
  user_preference_id uuid not null references user_preferences (id) on delete cascade,
  event_type text not null,
  source_entity_id uuid,
  weight numeric(4, 3) not null,
  occurred_at timestamptz not null default now(),
  reversal_of_id uuid references preference_evidence (id)
);

-- ---------------------------------------------------------------------------
-- Privacy requests and audit (spec §9.9, §13.13)
-- ---------------------------------------------------------------------------

create table privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  kind text not null check (kind in ('export', 'delete')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  -- Export payload; cleared after expiry by retention job (Milestone 5).
  payload jsonb,
  failure_reason text
);
create index privacy_requests_user_idx on privacy_requests (user_id, requested_at desc);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  entity_type text,
  entity_id text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index audit_events_user_idx on audit_events (user_id, occurred_at desc);

-- Idempotency keys for retryable mutations (spec §13.2).
create table idempotency_keys (
  key text not null,
  user_id uuid not null references users (id) on delete cascade,
  route text not null,
  request_hash text not null,
  status integer not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key, user_id, route)
);
