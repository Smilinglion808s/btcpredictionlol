create extension if not exists pgcrypto;

do $$ begin
  create type public.binance_ob_market_kind as enum ('SPOT', 'USD_M_PERP');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.binance_ob_capture_status as enum (
    'FRESH',
    'STALE',
    'NO_DATA',
    'SEQUENCE_GAP',
    'RESYNCING',
    'INCOMPLETE_BOOK',
    'CROSSED_BOOK',
    'REST_FALLBACK',
    'REGION_BLOCKED',
    'COLLECTOR_ERROR'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.binance_ob_policy_name as enum (
    'SPOT_FOLLOW_CURRENT_BAND',
    'SPOT_FADE_CURRENT_BAND',
    'SPOT_FOLLOW_PERSISTENT',
    'SPOT_FADE_PERSISTENT',
    'SPOT_PERP_CONSENSUS_FOLLOW',
    'SPOT_PERP_CONSENSUS_FADE'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.binance_ob_mode as enum ('SHADOW_ONLY', 'ACTIVE');
exception when duplicate_object then null;
end $$;

create table if not exists public.b4x4_es1_binance_ob_observations (
  id uuid primary key default gen_random_uuid(),
  target_ts timestamptz not null,
  market_kind public.binance_ob_market_kind not null,
  venue text not null default 'BINANCE_GLOBAL' check (venue = 'BINANCE_GLOBAL'),
  symbol text not null default 'BTCUSDT' check (symbol = 'BTCUSDT'),
  sample_offset_seconds smallint not null check (sample_offset_seconds between 2 and 60),
  sample_ts timestamptz not null,
  feature_cutoff_ts timestamptz not null,

  exchange_event_ts timestamptz,
  received_at timestamptz,
  exchange_to_receive_ms integer,
  target_age_ms integer,

  first_update_id bigint,
  last_update_id bigint,
  previous_update_id bigint,
  sequence_ok boolean not null default false,
  local_book_initialized boolean not null default false,
  book_complete_10bps boolean not null default false,
  resync_generation integer not null default 0 check (resync_generation >= 0),
  update_count_1s integer not null default 0 check (update_count_1s >= 0),

  best_bid double precision,
  best_bid_qty_btc double precision,
  best_ask double precision,
  best_ask_qty_btc double precision,
  mid_price double precision,
  spread_bps double precision,
  microprice double precision,
  microprice_displacement_bps double precision,

  bid_depth_btc_1bps double precision,
  ask_depth_btc_1bps double precision,
  total_depth_btc_1bps double precision,
  imbalance_1bps double precision,
  bid_depth_btc_2bps double precision,
  ask_depth_btc_2bps double precision,
  total_depth_btc_2bps double precision,
  imbalance_2bps double precision,
  bid_depth_btc_5bps double precision,
  ask_depth_btc_5bps double precision,
  total_depth_btc_5bps double precision,
  imbalance_5bps double precision,
  bid_depth_btc_10bps double precision,
  ask_depth_btc_10bps double precision,
  total_depth_btc_10bps double precision,
  bid_depth_usd_10bps double precision,
  ask_depth_usd_10bps double precision,
  total_depth_usd_10bps double precision,
  imbalance_10bps double precision,
  abs_imbalance_10bps double precision,

  bid_added_btc_1s double precision,
  bid_removed_btc_1s double precision,
  ask_added_btc_1s double precision,
  ask_removed_btc_1s double precision,
  normalized_ofi_1s double precision,

  capture_status public.binance_ob_capture_status not null,
  capture_reason text,
  source_ws_url_id text not null,
  collector_version text not null,
  implementation_revision text not null default 'binance-ob-r1',
  build_identifier text,
  config_hash text not null,
  feature_schema_hash text not null,
  created_at timestamptz not null default now(),

  constraint binance_ob_observation_unique
    unique (target_ts, market_kind, sample_offset_seconds, collector_version),
  constraint binance_ob_observation_time_order
    check (sample_ts < target_ts and feature_cutoff_ts < target_ts),
  constraint binance_ob_event_pre_target
    check (exchange_event_ts is null or exchange_event_ts < target_ts),
  constraint binance_ob_receive_pre_target
    check (received_at is null or received_at < target_ts),
  constraint binance_ob_bid_ask_order
    check (best_bid is null or best_ask is null or best_bid < best_ask),
  constraint binance_ob_imbalance_bounds
    check (
      (imbalance_1bps is null or imbalance_1bps between -1 and 1) and
      (imbalance_2bps is null or imbalance_2bps between -1 and 1) and
      (imbalance_5bps is null or imbalance_5bps between -1 and 1) and
      (imbalance_10bps is null or imbalance_10bps between -1 and 1) and
      (abs_imbalance_10bps is null or abs_imbalance_10bps between 0 and 1)
    )
);

create index if not exists b4x4_es1_binance_ob_obs_target_idx
  on public.b4x4_es1_binance_ob_observations (target_ts desc, market_kind);

create index if not exists b4x4_es1_binance_ob_obs_status_idx
  on public.b4x4_es1_binance_ob_observations (capture_status, target_ts desc);

create table if not exists public.b4x4_es1_binance_ob_boundary_features (
  id uuid primary key default gen_random_uuid(),
  target_ts timestamptz not null,
  market_kind public.binance_ob_market_kind not null,
  venue text not null default 'BINANCE_GLOBAL' check (venue = 'BINANCE_GLOBAL'),
  symbol text not null default 'BTCUSDT' check (symbol = 'BTCUSDT'),
  feature_cutoff_ts timestamptz not null,

  capture_status public.binance_ob_capture_status not null,
  ready boolean not null default false,
  ready_reason text,
  history_ready boolean not null default false,
  history_ready_reason text,
  observation_count_60s smallint not null default 0 check (observation_count_60s between 0 and 59),
  expected_observation_count_60s smallint not null default 59 check (expected_observation_count_60s = 59),
  history_count_96 smallint not null default 0 check (history_count_96 between 0 and 96),

  final_exchange_event_ts timestamptz,
  final_received_at timestamptz,
  final_target_age_ms integer,
  final_update_id bigint,
  sequence_ok boolean not null default false,
  book_complete_10bps boolean not null default false,
  resync_generation integer not null default 0 check (resync_generation >= 0),

  final_best_bid double precision,
  final_best_ask double precision,
  final_mid_price double precision,
  final_spread_bps double precision,
  final_microprice_displacement_bps double precision,
  final_bid_depth_btc_10bps double precision,
  final_ask_depth_btc_10bps double precision,
  final_total_depth_btc_10bps double precision,
  final_total_depth_usd_10bps double precision,
  final_imbalance_1bps double precision,
  final_imbalance_2bps double precision,
  final_imbalance_5bps double precision,
  final_imbalance_10bps double precision,
  final_abs_imbalance_10bps double precision,

  mean_imbalance_10bps_5s double precision,
  mean_imbalance_10bps_15s double precision,
  mean_imbalance_10bps_60s double precision,
  median_imbalance_10bps_5s double precision,
  median_imbalance_10bps_15s double precision,
  median_imbalance_10bps_60s double precision,
  slope_imbalance_10bps_5s double precision,
  slope_imbalance_10bps_15s double precision,
  slope_imbalance_10bps_60s double precision,
  stddev_imbalance_10bps_5s double precision,
  stddev_imbalance_10bps_15s double precision,
  stddev_imbalance_10bps_60s double precision,
  range_imbalance_10bps_5s double precision,
  range_imbalance_10bps_15s double precision,
  range_imbalance_10bps_60s double precision,
  sign_persistence_5s double precision,
  sign_persistence_15s double precision,
  sign_persistence_60s double precision,
  sign_change_count_60s smallint,

  normalized_ofi_5s double precision,
  normalized_ofi_15s double precision,
  normalized_ofi_60s double precision,
  bid_replenishment_btc_5s double precision,
  bid_replenishment_btc_15s double precision,
  bid_replenishment_btc_60s double precision,
  ask_replenishment_btc_5s double precision,
  ask_replenishment_btc_15s double precision,
  ask_replenishment_btc_60s double precision,

  abs_imbalance_percentile_96 double precision,
  total_depth_percentile_96 double precision,
  spread_percentile_96 double precision,
  receive_latency_p50_ms double precision,
  receive_latency_p95_ms double precision,

  source_ws_url_id text not null,
  collector_version text not null,
  feature_version text not null default 'binance-ob-r1',
  implementation_revision text not null default 'binance-ob-r1',
  build_identifier text,
  config_hash text not null,
  feature_schema_hash text not null,
  feature_values_hash text not null,
  finalized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint binance_ob_boundary_unique
    unique (target_ts, market_kind, feature_version),
  constraint binance_ob_boundary_cutoff
    check (feature_cutoff_ts < target_ts),
  constraint binance_ob_boundary_event_pre_target
    check (final_exchange_event_ts is null or final_exchange_event_ts < target_ts),
  constraint binance_ob_boundary_receive_pre_target
    check (final_received_at is null or final_received_at < target_ts),
  constraint binance_ob_boundary_percentile_bounds
    check (
      (abs_imbalance_percentile_96 is null or abs_imbalance_percentile_96 between 0 and 1) and
      (total_depth_percentile_96 is null or total_depth_percentile_96 between 0 and 1) and
      (spread_percentile_96 is null or spread_percentile_96 between 0 and 1) and
      (sign_persistence_5s is null or sign_persistence_5s between 0 and 1) and
      (sign_persistence_15s is null or sign_persistence_15s between 0 and 1) and
      (sign_persistence_60s is null or sign_persistence_60s between 0 and 1)
    )
);

create index if not exists b4x4_es1_binance_ob_feature_target_idx
  on public.b4x4_es1_binance_ob_boundary_features (target_ts desc, market_kind);

create index if not exists b4x4_es1_binance_ob_feature_ready_idx
  on public.b4x4_es1_binance_ob_boundary_features (market_kind, ready, history_ready, target_ts desc);

create table if not exists public.b4x4_es1_binance_ob_policy_shadows (
  id uuid primary key default gen_random_uuid(),
  target_ts timestamptz not null,
  prediction_id uuid,
  policy_name public.binance_ob_policy_name not null,
  policy_version text not null default 'binance-ob-policy-r1',
  spot_feature_id uuid references public.b4x4_es1_binance_ob_boundary_features(id),
  perp_feature_id uuid references public.b4x4_es1_binance_ob_boundary_features(id),

  qualified boolean not null default false,
  qualification_reason text not null,
  candidate_direction text check (candidate_direction is null or candidate_direction in ('GREEN', 'RED')),
  would_trade boolean not null default false,
  decision_reason text not null,

  spot_final_imbalance_10bps double precision,
  spot_abs_percentile_96 double precision,
  spot_sign_persistence_15s double precision,
  perp_final_imbalance_10bps double precision,
  perp_abs_percentile_96 double precision,
  perp_sign_persistence_15s double precision,
  spot_perp_sign_agree boolean,
  input_values_hash text not null,

  actual_direction text check (actual_direction is null or actual_direction in ('GREEN', 'RED', 'PUSH')),
  result text check (result is null or result in ('WIN', 'LOSS', 'PUSH')),
  result_score smallint check (result_score is null or result_score in (-1, 0, 1)),
  resolved_at timestamptz,
  resolver_version text,
  resolution_attempt_count integer not null default 0 check (resolution_attempt_count >= 0),
  last_resolution_attempt_at timestamptz,
  last_resolution_error text,

  run_mode text not null check (run_mode in ('LIVE', 'BACKFILL', 'CATCHUP')),
  webhook_eligible boolean not null default false check (webhook_eligible = false),
  implementation_revision text not null default 'binance-ob-r1',
  config_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint binance_ob_policy_shadow_unique
    unique (target_ts, policy_name, policy_version)
);

create index if not exists b4x4_es1_binance_ob_policy_target_idx
  on public.b4x4_es1_binance_ob_policy_shadows (target_ts desc, policy_name);

create index if not exists b4x4_es1_binance_ob_policy_resolution_idx
  on public.b4x4_es1_binance_ob_policy_shadows (resolved_at, target_ts)
  where would_trade = true;

create table if not exists public.b4x4_es1_binance_ob_collector_health (
  market_kind public.binance_ob_market_kind primary key,
  venue text not null default 'BINANCE_GLOBAL' check (venue = 'BINANCE_GLOBAL'),
  symbol text not null default 'BTCUSDT' check (symbol = 'BTCUSDT'),
  collector_status text not null,
  connection_started_at timestamptz,
  last_heartbeat_at timestamptz not null,
  last_exchange_event_ts timestamptz,
  last_received_at timestamptz,
  last_update_id bigint,
  sequence_ok boolean not null default false,
  local_book_initialized boolean not null default false,
  resync_count bigint not null default 0 check (resync_count >= 0),
  reconnect_count bigint not null default 0 check (reconnect_count >= 0),
  consecutive_error_count integer not null default 0 check (consecutive_error_count >= 0),
  last_error_code text,
  last_error_message text,
  collector_version text not null,
  build_identifier text,
  config_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.b4x4_es1_binance_ob_activation (
  singleton_key text primary key default 'B4X4_ES1_BINANCE_OB'
    check (singleton_key = 'B4X4_ES1_BINANCE_OB'),
  mode public.binance_ob_mode not null default 'SHADOW_ONLY',
  selected_policy public.binance_ob_policy_name,
  policy_version text,
  activation_target_ts timestamptz,
  config_hash text,
  approved_at timestamptz,
  approval_note text,
  activated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint binance_ob_activation_complete check (
    mode = 'SHADOW_ONLY'
    or (
      selected_policy is not null and
      policy_version is not null and
      activation_target_ts is not null and
      config_hash is not null and
      approved_at is not null and
      approval_note is not null
    )
  ),
  constraint binance_ob_activation_boundary check (
    activation_target_ts is null
    or extract(second from activation_target_ts) = 0
       and mod(extract(minute from activation_target_ts)::integer, 15) = 0
  )
);

insert into public.b4x4_es1_binance_ob_activation (
  singleton_key,
  mode,
  approval_note
) values (
  'B4X4_ES1_BINANCE_OB',
  'SHADOW_ONLY',
  'Initial R1 installation; no publication or decision authority.'
)
on conflict (singleton_key) do nothing;

alter table if exists public.b4x4_es1_predictions
  add column if not exists binance_ob_version text,
  add column if not exists binance_ob_mode public.binance_ob_mode,
  add column if not exists binance_ob_spot_feature_id uuid,
  add column if not exists binance_ob_perp_feature_id uuid,
  add column if not exists binance_ob_spot_ready boolean,
  add column if not exists binance_ob_perp_ready boolean,
  add column if not exists binance_ob_selected_shadow_policy public.binance_ob_policy_name,
  add column if not exists binance_ob_shadow_direction text,
  add column if not exists binance_ob_shadow_would_trade boolean,
  add column if not exists binance_ob_shadow_reason text,
  add column if not exists binance_ob_config_hash text,
  add column if not exists binance_ob_feature_schema_hash text;

do $$ begin
  alter table public.b4x4_es1_predictions
    add constraint b4x4_es1_predictions_binance_ob_shadow_direction_check
    check (binance_ob_shadow_direction is null or binance_ob_shadow_direction in ('GREEN', 'RED'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.b4x4_es1_predictions
    add constraint b4x4_es1_predictions_binance_ob_spot_fk
    foreign key (binance_ob_spot_feature_id)
    references public.b4x4_es1_binance_ob_boundary_features(id);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.b4x4_es1_predictions
    add constraint b4x4_es1_predictions_binance_ob_perp_fk
    foreign key (binance_ob_perp_feature_id)
    references public.b4x4_es1_binance_ob_boundary_features(id);
exception when duplicate_object then null;
end $$;

alter table public.b4x4_es1_binance_ob_observations enable row level security;
alter table public.b4x4_es1_binance_ob_boundary_features enable row level security;
alter table public.b4x4_es1_binance_ob_policy_shadows enable row level security;
alter table public.b4x4_es1_binance_ob_collector_health enable row level security;
alter table public.b4x4_es1_binance_ob_activation enable row level security;

do $$ begin
  create policy binance_ob_observations_authenticated_read
    on public.b4x4_es1_binance_ob_observations
    for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy binance_ob_features_authenticated_read
    on public.b4x4_es1_binance_ob_boundary_features
    for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy binance_ob_policy_authenticated_read
    on public.b4x4_es1_binance_ob_policy_shadows
    for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy binance_ob_health_authenticated_read
    on public.b4x4_es1_binance_ob_collector_health
    for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy binance_ob_activation_authenticated_read
    on public.b4x4_es1_binance_ob_activation
    for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

grant select on public.b4x4_es1_binance_ob_observations to authenticated;
grant select on public.b4x4_es1_binance_ob_boundary_features to authenticated;
grant select on public.b4x4_es1_binance_ob_policy_shadows to authenticated;
grant select on public.b4x4_es1_binance_ob_collector_health to authenticated;
grant select on public.b4x4_es1_binance_ob_activation to authenticated;

grant all on public.b4x4_es1_binance_ob_observations to service_role;
grant all on public.b4x4_es1_binance_ob_boundary_features to service_role;
grant all on public.b4x4_es1_binance_ob_policy_shadows to service_role;
grant all on public.b4x4_es1_binance_ob_collector_health to service_role;
grant all on public.b4x4_es1_binance_ob_activation to service_role;

comment on table public.b4x4_es1_binance_ob_observations is
  'One-second strictly pre-boundary Binance Global BTCUSDT local-book observations; reporting-only in R1.';
comment on table public.b4x4_es1_binance_ob_boundary_features is
  'Immutable target-level Binance order-book features finalized at T-2s.';
comment on table public.b4x4_es1_binance_ob_policy_shadows is
  'Frozen follow/fade policy counterfactuals; never webhook eligible.';
comment on table public.b4x4_es1_binance_ob_activation is
  'Fail-closed persisted activation authority; defaults to SHADOW_ONLY.';