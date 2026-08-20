-- T45 Balanced (t45-balanced-q375-r1) — standalone model schema.
-- Isolated from ES1/B4x4/V6/A2/TD1. Shadow-only until explicitly authorized.

create table if not exists public.t45_second_samples (
  id uuid primary key default gen_random_uuid(),
  target_ts timestamptz not null,
  offset_seconds smallint not null,
  venue text not null default 'BINANCE_GLOBAL',
  symbol text not null default 'BTCUSDT',
  bar_open_ts timestamptz,
  bar_close_ts timestamptz,
  received_at timestamptz,
  open double precision,
  high double precision,
  low double precision,
  close double precision,
  volume double precision,
  quote_volume double precision,
  taker_buy_volume double precision,
  taker_buy_quote_volume double precision,
  trade_count integer,
  is_final boolean not null default true,
  capture_status text not null default 'FRESH',
  capture_reason text,
  source_stream_id text not null,
  collector_version text not null,
  build_identifier text,
  created_at timestamptz not null default now(),
  constraint t45_offset_range check (offset_seconds >= 0 and offset_seconds <= 44),
  constraint t45_second_samples_key unique (target_ts, offset_seconds, collector_version)
);
create index if not exists t45_second_samples_target_idx on public.t45_second_samples (target_ts desc);

create table if not exists public.t45_features (
  id uuid primary key default gen_random_uuid(),
  target_ts timestamptz not null,
  feature_version text not null default 't45-features-r1',
  row_source text not null default 'LIVE',
  feature_cutoff_ts timestamptz,
  seconds_present integer,
  spot_complete boolean not null default false,
  feature_complete boolean not null default false,
  feature_invalid_reason text,
  t45_seconds_count integer,
  t45_first_offset_s integer,
  t45_last_offset_s integer,
  t45_spot_open double precision,
  t45_spot_complete integer,
  t45_close_5s double precision,
  t45_ret_5s_bps double precision,
  t45_range_5s_bps double precision,
  t45_quote_volume_5s double precision,
  t45_trade_count_5s double precision,
  t45_quote_flow_5s double precision,
  t45_close_15s double precision,
  t45_ret_15s_bps double precision,
  t45_range_15s_bps double precision,
  t45_quote_volume_15s double precision,
  t45_trade_count_15s double precision,
  t45_quote_flow_15s double precision,
  t45_close_30s double precision,
  t45_ret_30s_bps double precision,
  t45_range_30s_bps double precision,
  t45_quote_volume_30s double precision,
  t45_trade_count_30s double precision,
  t45_quote_flow_30s double precision,
  t45_close_45s double precision,
  t45_ret_45s_bps double precision,
  t45_range_45s_bps double precision,
  t45_quote_volume_45s double precision,
  t45_trade_count_45s double precision,
  t45_quote_flow_45s double precision,
  t45_body_range_45s double precision,
  t45_close_location_45s double precision,
  t45_path_efficiency_45s double precision,
  t45_realized_vol_45s_bps double precision,
  t45_log_price_slope_bps_per_s double precision,
  t45_return_sign_persistence double precision,
  t45_return_sign_changes integer,
  t45_last15_ret_bps double precision,
  t45_last30_ret_bps double precision,
  t45_return_accel_15_45_bps double precision,
  t45_quote_volume_last15_share double precision,
  t45_trade_count_last15_share double precision,
  t45_close_vwap_gap_bps double precision,
  t45_partial_direction integer,
  t45_price_flow_alignment double precision,
  t45_path_direction_consistency double precision,
  t45_book_snapshot_count integer,
  t45_book_first_offset_s double precision,
  t45_book_final_offset_s double precision,
  t45_book_age_at_cutoff_s double precision,
  t45_book_imb_20 double precision,
  t45_book_log_total_depth_20 double precision,
  t45_book_log_total_notional_20 double precision,
  t45_book_imb_100 double precision,
  t45_book_log_total_depth_100 double precision,
  t45_book_log_total_notional_100 double precision,
  t45_book_imb_200 double precision,
  t45_book_log_total_depth_200 double precision,
  t45_book_log_total_notional_200 double precision,
  t45_book_imb_300 double precision,
  t45_book_log_total_depth_300 double precision,
  t45_book_log_total_notional_300 double precision,
  t45_book_imb_400 double precision,
  t45_book_log_total_depth_400 double precision,
  t45_book_log_total_notional_400 double precision,
  t45_book_imb_500 double precision,
  t45_book_log_total_depth_500 double precision,
  t45_book_log_total_notional_500 double precision,
  t45_book_imb_delta_20 double precision,
  t45_book_imb_delta_100 double precision,
  t45_book_imb_delta_200 double precision,
  t45_book_imb_delta_300 double precision,
  t45_book_imb_delta_400 double precision,
  t45_book_imb_delta_500 double precision,
  t45_log_quote_volume_45s double precision,
  t45_log_trade_count_45s double precision,
  t45_r2_prediction double precision,
  t45_r2_would_trade double precision,
  t45_r2_partial_agreement double precision,
  t45_r2_ret45_interaction double precision,
  r2_prior_key text,
  r2_prior_source text,
  feature_values_json jsonb,
  feature_vector_hash text,
  config_hash text,
  created_at timestamptz not null default now(),
  constraint t45_features_key unique (target_ts, feature_version)
);
create index if not exists t45_features_target_idx on public.t45_features (target_ts desc);

create table if not exists public.t45_fits (
  id uuid primary key default gen_random_uuid(),
  fit_id text not null,
  model_version text not null,
  block_index integer not null,
  block_start_index integer not null,
  training_start_ts timestamptz,
  training_end_ts timestamptz,
  training_row_count integer not null,
  feature_order text[] not null,
  scaler_center double precision[] not null,
  scaler_scale double precision[] not null,
  coefficients double precision[] not null,
  intercept double precision not null,
  logistic_c double precision not null,
  solver text not null,
  converged boolean not null,
  iterations integer,
  gradient_norm double precision,
  fitter_code_hash text,
  artifact_sha256 text,
  created_at timestamptz not null default now(),
  constraint t45_fits_key unique (fit_id)
);

create table if not exists public.t45_predictions (
  id uuid primary key default gen_random_uuid(),
  target_ts timestamptz not null,
  model_name text not null default 'T45 Balanced',
  model_version text not null default 't45-balanced-q375-r1',
  model_variant text not null default 'frozen-r2-price-flow-rank625',
  base_head text not null default 'WF_LOGIT::R2_PRICE_FLOW::C0.003::L8640::DAY',
  run_mode text not null default 'LIVE',
  local_date text,
  decision_cutoff_ts timestamptz,
  decided_at timestamptz,
  r2_prior_key text,
  r2_prior_prediction smallint,
  r2_prior_source text,
  r2_prior_available boolean not null default false,
  probability_green double precision,
  confidence double precision,
  confidence_rank double precision,
  rank_history_count integer,
  base_direction smallint,
  active_prediction smallint,
  active_sleeve text,
  active_would_trade boolean,
  precision_core boolean,
  fit_id text,
  fit_block_index integer,
  fit_training_row_count integer,
  feature_complete boolean,
  decision_valid boolean not null default false,
  decision_invalid_reason text,
  actual_open double precision,
  actual_close double precision,
  actual_direction smallint,
  outcome_source text,
  resolved_at timestamptz,
  active_result text,
  active_score smallint,
  webhook_eligible boolean not null default false,
  webhook_sent boolean not null default false,
  config_hash text,
  build_identifier text,
  created_at timestamptz not null default now(),
  constraint t45_predictions_key unique (target_ts, model_version, run_mode)
);
create index if not exists t45_predictions_target_idx on public.t45_predictions (target_ts desc);
create index if not exists t45_predictions_live_idx on public.t45_predictions (run_mode, target_ts desc);

create table if not exists public.t45_collector_health (
  id uuid primary key default gen_random_uuid(),
  stream_key text not null,
  venue text not null default 'BINANCE_GLOBAL',
  symbol text not null default 'BTCUSDT',
  status text not null default 'UNKNOWN',
  last_heartbeat_at timestamptz,
  last_bar_close_ts timestamptz,
  last_received_at timestamptz,
  last_target_ts timestamptz,
  last_target_seconds integer,
  reconnect_count integer not null default 0,
  consecutive_errors integer not null default 0,
  last_error_code text,
  last_error_message text,
  deployment_id text,
  collector_version text,
  build_identifier text,
  updated_at timestamptz not null default now(),
  constraint t45_collector_health_key unique (stream_key)
);

create table if not exists public.t45_activation (
  singleton_key text primary key default 'T45_BALANCED',
  mode text not null default 'SHADOW_ONLY',
  webhooks_enabled boolean not null default false,
  activation_target_ts timestamptz,
  freeze_sha256 text,
  approval_note text,
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

grant select on public.t45_second_samples to authenticated;
grant all on public.t45_second_samples to service_role;
grant select on public.t45_features to authenticated;
grant all on public.t45_features to service_role;
grant select on public.t45_fits to authenticated;
grant all on public.t45_fits to service_role;
grant select on public.t45_predictions to authenticated;
grant all on public.t45_predictions to service_role;
grant select on public.t45_collector_health to authenticated;
grant all on public.t45_collector_health to service_role;
grant select on public.t45_activation to authenticated;
grant all on public.t45_activation to service_role;

alter table public.t45_second_samples enable row level security;
alter table public.t45_features enable row level security;
alter table public.t45_fits enable row level security;
alter table public.t45_predictions enable row level security;
alter table public.t45_collector_health enable row level security;
alter table public.t45_activation enable row level security;

create policy "t45 samples readable by authenticated" on public.t45_second_samples for select to authenticated using (true);
create policy "t45 features readable by authenticated" on public.t45_features for select to authenticated using (true);
create policy "t45 fits readable by authenticated" on public.t45_fits for select to authenticated using (true);
create policy "t45 predictions readable by authenticated" on public.t45_predictions for select to authenticated using (true);
create policy "t45 health readable by authenticated" on public.t45_collector_health for select to authenticated using (true);
create policy "t45 activation readable by authenticated" on public.t45_activation for select to authenticated using (true);

insert into public.t45_activation (singleton_key, mode, webhooks_enabled, freeze_sha256, approval_note)
values ('T45_BALANCED', 'SHADOW_ONLY', false, '6b4cd71a91d06f2b1b232cb4bb54e5c4c067399bf0f008c5f3b541b348c6f68c',
        'Shadow only. Webhooks blocked pending Railway capture, certified live R2 prior, warmup and one observed T+45 cycle.')
on conflict (singleton_key) do nothing;