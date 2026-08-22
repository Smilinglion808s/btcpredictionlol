
CREATE TABLE public.t30_samples (
  target_ts timestamptz NOT NULL,
  offset_seconds smallint NOT NULL,
  collector_version text NOT NULL,
  venue text NOT NULL DEFAULT 'BINANCE_GLOBAL',
  symbol text NOT NULL DEFAULT 'BTCUSDT',
  bar_open_ts timestamptz NOT NULL,
  bar_close_ts timestamptz NOT NULL,
  exchange_event_ts timestamptz,
  final_event_ts timestamptz,
  received_at timestamptz,
  open double precision NOT NULL,
  high double precision NOT NULL,
  low double precision NOT NULL,
  close double precision NOT NULL,
  volume double precision NOT NULL,
  quote_volume double precision NOT NULL,
  taker_buy_volume double precision NOT NULL,
  taker_buy_quote_volume double precision NOT NULL,
  trade_count bigint NOT NULL,
  is_final boolean NOT NULL DEFAULT true,
  capture_status text NOT NULL DEFAULT 'FRESH',
  capture_reason text,
  source_stream_id text,
  build_identifier text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_ts, offset_seconds, collector_version)
);
GRANT SELECT ON public.t30_samples TO authenticated;
GRANT ALL ON public.t30_samples TO service_role;
ALTER TABLE public.t30_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30_samples_read" ON public.t30_samples FOR SELECT TO authenticated USING (true);

CREATE TABLE public.t30_features (
  target_ts timestamptz NOT NULL,
  feature_version text NOT NULL,
  feature_order_hash text NOT NULL,
  row_index integer,
  seconds_present smallint NOT NULL DEFAULT 0,
  first_offset_s smallint,
  last_offset_s smallint,
  spot_complete boolean NOT NULL DEFAULT false,
  feature_complete boolean NOT NULL DEFAULT false,
  invalid_reason text,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  vector double precision[],
  label smallint,
  label_source text,
  actual_open double precision,
  actual_close double precision,
  built_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'LIVE',
  PRIMARY KEY (target_ts, feature_version)
);
CREATE INDEX t30_features_order_idx ON public.t30_features (feature_version, target_ts);
CREATE INDEX t30_features_label_idx ON public.t30_features (feature_version, label) WHERE label IS NOT NULL;
GRANT SELECT ON public.t30_features TO authenticated;
GRANT ALL ON public.t30_features TO service_role;
ALTER TABLE public.t30_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30_features_read" ON public.t30_features FOR SELECT TO authenticated USING (true);

CREATE TABLE public.t30_pf_fits (
  fit_id text PRIMARY KEY,
  model_version text NOT NULL,
  block_index integer NOT NULL,
  block_start_index integer NOT NULL,
  coefficients jsonb NOT NULL,
  intercept double precision NOT NULL,
  scaler_center jsonb NOT NULL,
  scaler_scale jsonb NOT NULL,
  feature_order_hash text NOT NULL,
  config_hash text NOT NULL,
  training_row_count integer NOT NULL,
  training_start_ts timestamptz,
  training_end_ts timestamptz,
  training_start_index integer,
  training_end_index integer,
  training_fingerprint text NOT NULL,
  certified boolean NOT NULL DEFAULT false,
  converged boolean NOT NULL DEFAULT false,
  iterations integer,
  gradient_norm double precision,
  artifact_hash text NOT NULL,
  solver text NOT NULL,
  source text NOT NULL DEFAULT 'LIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX t30_pf_fits_block_idx ON public.t30_pf_fits (model_version, block_start_index, source);
GRANT SELECT ON public.t30_pf_fits TO authenticated;
GRANT ALL ON public.t30_pf_fits TO service_role;
ALTER TABLE public.t30_pf_fits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30_pf_fits_read" ON public.t30_pf_fits FOR SELECT TO authenticated USING (true);

CREATE TABLE public.t30_pf_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_ts timestamptz NOT NULL,
  model_version text NOT NULL,
  run_mode text NOT NULL DEFAULT 'LIVE',
  model_name text,
  model_variant text,
  feature_schema text,
  config_hash text,
  feature_order_hash text,
  implementation_revision text,
  publication_mode text NOT NULL DEFAULT 'SHADOW_ONLY',
  trigger_kind text,
  decided_at timestamptz,
  decision_latency_ms integer,
  cutoff_ts timestamptz,
  publish_deadline_ts timestamptz,
  within_publish_deadline boolean,
  packet_ready boolean NOT NULL DEFAULT false,
  packet_reason text,
  seconds_present smallint,
  first_offset_s smallint,
  last_offset_s smallint,
  spot_complete boolean,
  feature_complete boolean,
  fit_id text,
  fit_block_index integer,
  fit_certified boolean,
  probability_green double precision,
  confidence double precision,
  base_direction smallint,
  long_rank double precision,
  long_rank_history integer,
  fast_rank double precision,
  fast_rank_history integer,
  gate_long_ready boolean,
  gate_fast_ready boolean,
  gate_long_passed boolean,
  gate_fast_passed boolean,
  model_direction smallint,
  model_would_trade boolean,
  decision_valid boolean,
  decision_reason text,
  spot_open double precision,
  features jsonb,
  actual_open double precision,
  actual_high double precision,
  actual_low double precision,
  actual_close double precision,
  actual_direction smallint,
  outcome_source text,
  resolved_at timestamptz,
  result text,
  score smallint,
  decimal_odds double precision,
  odds_units double precision,
  odds_source text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX t30_pf_predictions_key ON public.t30_pf_predictions (target_ts, model_version, run_mode);
CREATE INDEX t30_pf_predictions_recent ON public.t30_pf_predictions (model_version, run_mode, target_ts DESC);
CREATE INDEX t30_pf_predictions_conf ON public.t30_pf_predictions (model_version, run_mode, target_ts DESC) WHERE confidence IS NOT NULL;
GRANT SELECT ON public.t30_pf_predictions TO authenticated;
GRANT ALL ON public.t30_pf_predictions TO service_role;
ALTER TABLE public.t30_pf_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30_pf_predictions_read" ON public.t30_pf_predictions FOR SELECT TO authenticated USING (true);
CREATE TRIGGER t30_pf_predictions_set_updated_at BEFORE UPDATE ON public.t30_pf_predictions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.t30_pf_policy_shadows (
  target_ts timestamptz NOT NULL,
  policy text NOT NULL,
  run_mode text NOT NULL DEFAULT 'LIVE',
  would_trade boolean NOT NULL DEFAULT false,
  direction smallint NOT NULL DEFAULT 0,
  reason text,
  result text,
  score smallint,
  actual_direction smallint,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_ts, policy, run_mode)
);
GRANT SELECT ON public.t30_pf_policy_shadows TO authenticated;
GRANT ALL ON public.t30_pf_policy_shadows TO service_role;
ALTER TABLE public.t30_pf_policy_shadows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30_pf_policy_shadows_read" ON public.t30_pf_policy_shadows FOR SELECT TO authenticated USING (true);

CREATE TABLE public.t30_pf_activation (
  singleton_key text PRIMARY KEY,
  mode text NOT NULL DEFAULT 'SHADOW_ONLY',
  webhooks_enabled boolean NOT NULL DEFAULT false,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.t30_pf_activation TO authenticated;
GRANT ALL ON public.t30_pf_activation TO service_role;
ALTER TABLE public.t30_pf_activation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30_pf_activation_read" ON public.t30_pf_activation FOR SELECT TO authenticated USING (true);
INSERT INTO public.t30_pf_activation (singleton_key, mode, webhooks_enabled, notes)
VALUES ('T30_PRICE_FLOW_BALANCED', 'SHADOW_ONLY', false, 'T30 PriceFlow Balanced R1 — shadow only, never emits webhooks.');

CREATE TABLE public.t30_collector_health (
  stream_key text PRIMARY KEY,
  status text NOT NULL DEFAULT 'UNKNOWN',
  last_heartbeat_at timestamptz,
  last_bar_close_ts timestamptz,
  last_received_at timestamptz,
  last_target_ts timestamptz,
  last_target_seconds smallint,
  reconnect_count integer NOT NULL DEFAULT 0,
  consecutive_errors integer NOT NULL DEFAULT 0,
  last_error_code text,
  last_error_message text,
  deployment_id text,
  collector_version text,
  build_identifier text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.t30_collector_health TO authenticated;
GRANT ALL ON public.t30_collector_health TO service_role;
ALTER TABLE public.t30_collector_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30_collector_health_read" ON public.t30_collector_health FOR SELECT TO authenticated USING (true);
