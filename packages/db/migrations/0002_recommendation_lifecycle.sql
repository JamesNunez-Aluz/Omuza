-- Milestone 2: recommendation lifecycle, exposures, and novelty knowledge.
-- Full decision trace per run (spec §9.6); reproducibility columns pin the
-- ranker/selector versions and random seed. Spotify is never a knowledge
-- source (spec §9.5) — enforced by CHECK.

create table recommendation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  context_id uuid references context_profiles (id),
  status text not null default 'queued'
    check (status in ('queued', 'generating', 'completed', 'degraded', 'failed', 'cancelled')),
  requested_count integer not null default 20 check (requested_count between 10 and 50),
  discovery_level integer not null check (discovery_level between 0 and 100),
  structured_intent_snapshot jsonb,
  profile_snapshot_version text,
  ranker_version text,
  selector_version text,
  random_seed text not null,
  degraded_providers text[] not null default '{}',
  constraint_relaxations text[] not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  failure_detail_redacted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recommendation_runs_user_idx on recommendation_runs (user_id, created_at desc);

create table recommendation_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references recommendation_runs (id) on delete cascade,
  recording_id uuid not null references recordings (id),
  provider text not null,
  provider_strategy text not null,
  provider_rank integer,
  provider_score double precision,
  feature_snapshot jsonb not null default '{}'::jsonb,
  eligibility_decision text not null check (eligibility_decision in ('eligible', 'rejected')),
  rejection_reasons text[] not null default '{}',
  base_score double precision,
  final_score double precision,
  selected boolean not null default false,
  created_at timestamptz not null default now()
);
create index recommendation_candidates_run_idx on recommendation_candidates (run_id);

create table recommendation_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references recommendation_runs (id) on delete cascade,
  recording_id uuid not null references recordings (id),
  position integer not null,
  score double precision not null,
  novelty_probability double precision not null check (novelty_probability between 0 and 1),
  novelty_state text not null check (novelty_state in
    ('confirmed_new', 'high_confidence_new', 'probably_new', 'unknown', 'known')),
  novelty_confidence double precision not null check (novelty_confidence between 0 and 1),
  selection_reason text not null,
  created_at timestamptz not null default now(),
  unique (run_id, position),
  unique (run_id, recording_id)
);

create table recommendation_explanations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references recommendation_items (id) on delete cascade,
  template_key text not null,
  rendered_text text not null,
  evidence jsonb not null default '[]'::jsonb,
  generator text not null default 'template' check (generator in ('template', 'llm')),
  generator_version text not null,
  validated boolean not null default true,
  created_at timestamptz not null default now()
);
create index recommendation_explanations_item_idx on recommendation_explanations (item_id);

create table exposures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  recording_id uuid not null references recordings (id),
  recommendation_run_id uuid references recommendation_runs (id) on delete set null,
  recommendation_item_id uuid references recommendation_items (id) on delete set null,
  surface text not null,
  position integer,
  shown_at timestamptz not null default now(),
  opened_destination_at timestamptz,
  novelty_state_at_exposure text,
  novelty_probability_at_exposure double precision
);
create index exposures_user_recording_idx on exposures (user_id, recording_id);

create table known_recordings (
  user_id uuid not null references users (id) on delete cascade,
  recording_id uuid not null references recordings (id),
  knowledge_state text not null check (knowledge_state in
    ('confirmed_known', 'confirmed_new', 'ledger_known', 'unknown')),
  confidence double precision not null check (confidence between 0 and 1),
  source text not null,
  first_known_at timestamptz not null default now(),
  last_confirmed_at timestamptz,
  primary key (user_id, recording_id),
  -- Spotify is not an allowed knowledge source (spec §9.5).
  constraint known_recordings_no_spotify_source check (source <> 'spotify')
);
