-- Milestone 3: append-only feedback, playlists, and minimal analytics events.
-- Feedback is never updated in place (spec §9.5): revisions append a new
-- event that supersedes the prior one — enforced by trigger like consents.

create table feedback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  recording_id uuid not null references recordings (id),
  exposure_id uuid references exposures (id) on delete set null,
  recommendation_run_id uuid references recommendation_runs (id) on delete set null,
  primary_response text not null check (primary_response in
    ('love', 'like', 'neutral', 'dislike', 'not_now', 'already_knew')),
  reason_codes text[] not null default '{}',
  newness_response text check (newness_response in ('new_to_me', 'already_knew')),
  context_id uuid references context_profiles (id),
  occurred_at timestamptz not null default now(),
  supersedes_event_id uuid references feedback_events (id),
  client_event_id text not null,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);
create index feedback_events_user_recording_idx on feedback_events (user_id, recording_id);
create index feedback_events_run_idx on feedback_events (recommendation_run_id);

-- Append-only with one carve-out: privacy deletion (the right to erasure
-- beats immutability). The purge path sets a transaction-local flag; every
-- other UPDATE/DELETE is rejected.
create function feedback_events_append_only() returns trigger as $$
begin
  if tg_op = 'DELETE' and current_setting('resonance.allow_feedback_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'feedback_events is append-only: % is not permitted', tg_op;
end;
$$ language plpgsql;

create trigger feedback_events_no_update
  before update or delete on feedback_events
  for each row execute function feedback_events_append_only();

-- ---------------------------------------------------------------------------
-- Playlists (spec §9.7) — service-neutral, canonical recordings only.
-- ---------------------------------------------------------------------------

create table playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null,
  description text,
  context_id uuid references context_profiles (id),
  source_run_id uuid references recommendation_runs (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'deleted')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index playlists_user_idx on playlists (user_id, created_at desc);

create table playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references playlists (id) on delete cascade,
  recording_id uuid not null references recordings (id),
  position integer not null,
  source_recommendation_item_id uuid references recommendation_items (id) on delete set null,
  added_at timestamptz not null default now(),
  removed_at timestamptz
);
create index playlist_items_playlist_idx on playlist_items (playlist_id) where removed_at is null;

-- ---------------------------------------------------------------------------
-- Analytics events (spec §14.6, §15.1): semantic names, minimal typed
-- properties. No raw free text, emails, or provider payloads — enforced by
-- the application schema layer and verified by tests.
-- ---------------------------------------------------------------------------

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete set null,
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index analytics_events_name_idx on analytics_events (event_name, occurred_at);
