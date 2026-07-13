-- Milestone 0 foundation schema.
-- Conventions: UTC timestamptz everywhere; provenance + license policy on
-- every catalog row; database-level guard that Spotify-sourced fields can
-- never be training- or recommendation-eligible (spec §6.2 control 7).

create table source_licenses (
  id text primary key,
  provider text not null,
  dataset text not null,
  license_id text not null,
  license_url text not null,
  reviewed_at date not null,
  permitted_uses text[] not null default '{}',
  prohibited_uses text[] not null default '{}',
  attribution_template text,
  retention_days integer,
  notes text not null,
  created_at timestamptz not null default now(),
  unique (provider, dataset, id)
);

create table artists (
  id uuid primary key default gen_random_uuid(),
  canonical_mbid text unique,
  name text not null,
  provenance_provider text not null,
  license_policy_id text not null references source_licenses (id),
  ingested_at timestamptz not null default now()
);

create table recordings (
  id uuid primary key default gen_random_uuid(),
  canonical_mbid text unique,
  title text not null,
  primary_artist_id uuid not null references artists (id),
  duration_ms integer,
  provenance_provider text not null,
  license_policy_id text not null references source_licenses (id),
  ingested_at timestamptz not null default now()
);

create table recording_features (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references recordings (id) on delete cascade,
  feature text not null,
  value double precision not null,
  provenance_provider text not null,
  provenance_dataset text not null,
  license_policy_id text not null references source_licenses (id),
  training_eligible boolean not null default false,
  recommendation_eligible boolean not null default false,
  ingested_at timestamptz not null default now(),
  unique (recording_id, feature, provenance_provider, provenance_dataset),
  constraint spotify_never_training_eligible
    check (provenance_provider <> 'spotify' or training_eligible = false),
  constraint spotify_never_recommendation_eligible
    check (provenance_provider <> 'spotify' or recommendation_eligible = false)
);

create index recording_features_recording_idx on recording_features (recording_id);
