-- Milestone 4: destination connections and Spotify export (Zone C, spec
-- §6.1/§9.2/§9.7). Destination data is export-only: nothing here may ever be
-- joined into recommendation features (policy gate P6), every cache row has a
-- mandatory expiry, and credentials are stored only as app-layer AES-256-GCM
-- ciphertext (ADR 0012).

create table service_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  service text not null check (service in ('spotify')),
  external_user_id_hash text,
  status text not null default 'active'
    check (status in ('active', 'expired', 'revoked', 'error')),
  scope_set text[] not null default '{}',
  authorized_at timestamptz not null default now(),
  expires_at timestamptz,
  reauthorization_due_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz
);
-- One active connection per (user, service).
create unique index service_connections_active_unique
  on service_connections (user_id, service) where status = 'active';

create table encrypted_oauth_credentials (
  connection_id uuid primary key references service_connections (id) on delete cascade,
  encrypted_access_token bytea not null,
  encrypted_refresh_token bytea,
  key_version text not null,
  access_nonce bytea not null,
  access_auth_tag bytea not null,
  refresh_nonce bytea,
  refresh_auth_tag bytea,
  access_token_expires_at timestamptz not null,
  rotated_at timestamptz not null default now()
);

-- One-time OAuth callback transactions (spec §12.3): hashed state, encrypted
-- PKCE verifier, short lifetime, single consumption.
create table oauth_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  service text not null check (service in ('spotify')),
  state_hash text not null unique,
  encrypted_code_verifier bytea not null,
  verifier_nonce bytea not null,
  verifier_auth_tag bytea not null,
  key_version text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  playlist_id uuid not null references playlists (id) on delete cascade,
  destination text not null check (destination in ('spotify')),
  connection_id uuid references service_connections (id) on delete set null,
  idempotency_key text not null,
  status text not null default 'requested' check (status in
    ('requested', 'resolving', 'needs_review', 'creating_playlist', 'inserting_items',
     'completed', 'rate_limited', 'authorization_required', 'partial', 'ambiguous',
     'failed', 'superseded', 'cancelled')),
  -- Once set, ordinary retries must never create another playlist (§12.8).
  destination_playlist_id text,
  destination_url text,
  superseded_by_export_id uuid references exports (id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  item_count integer not null default 0,
  resolved_count integer not null default 0,
  inserted_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, destination, idempotency_key)
);
create index exports_playlist_idx on exports (playlist_id, requested_at desc);

-- Destination-zone temporary cache: display fields exist solely for user
-- review of a match; expiry is mandatory and rows are purged by
-- scripts/purge-expired-provider-data.ts. Never joinable into
-- recommendation features (spec §9.7).
create table export_item_resolutions (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references exports (id) on delete cascade,
  recording_id uuid not null references recordings (id),
  destination_item_id text,
  destination_uri text,
  match_method text check (match_method in ('isrc', 'artist_title', 'manual')),
  confidence double precision check (confidence between 0 and 1),
  status text not null default 'pending' check (status in
    ('pending', 'auto_resolved', 'needs_confirmation', 'confirmed', 'rejected',
     'unresolved', 'inserted')),
  temporary_display_title text,
  temporary_display_artist text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (export_id, recording_id)
);
