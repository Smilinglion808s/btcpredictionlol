CREATE TABLE public.t10_bridge_samples (
  target_ts timestamptz NOT NULL,
  offset_seconds integer NOT NULL,
  collector_version text NOT NULL,
  bar_open_ms bigint,
  open double precision,
  high double precision,
  low double precision,
  close double precision,
  volume double precision,
  quote_volume double precision,
  taker_buy_volume double precision,
  taker_buy_quote_volume double precision,
  trade_count integer,
  is_final boolean NOT NULL DEFAULT true,
  event_time_ms bigint,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_ts, offset_seconds, collector_version)
);
GRANT SELECT ON public.t10_bridge_samples TO authenticated;
GRANT ALL ON public.t10_bridge_samples TO service_role;
ALTER TABLE public.t10_bridge_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t10 samples readable by authenticated" ON public.t10_bridge_samples FOR SELECT TO authenticated USING (true);

CREATE TABLE public.t10_bridge_fits (
  fit_id text PRIMARY KEY,
  model_version text NOT NULL,
  model_variant text NOT NULL,
  config_hash text NOT NULL,
  feature_order_hash text NOT NULL,
  fit_source text NOT NULL DEFAULT 'walk-forward',
  block_index integer NOT NULL,
  block_start_index integer NOT NULL,
  training_row_count integer NOT NULL,
  training_start_index integer,
  training_end_index integer,
  training_start_ts timestamptz,
  training_end_ts timestamptz,
  window_fingerprint text,
  center jsonb NOT NULL,
  scale jsonb NOT NULL,
  coefficients jsonb NOT NULL,
  intercept double precision NOT NULL,
  converged boolean NOT NULL DEFAULT false,
  iterations integer,
  gradient_norm double precision,
  artifact_hash text,
  certified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_version, block_start_index)
);
GRANT SELECT ON public.t10_bridge_fits TO authenticated;
GRANT ALL ON public.t10_bridge_fits TO service_role;
ALTER TABLE public.t10_bridge_fits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t10 fits readable by authenticated" ON public.t10_bridge_fits FOR SELECT TO authenticated USING (true);
CREATE TRIGGER t10_bridge_fits_set_updated_at BEFORE UPDATE ON public.t10_bridge_fits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.t10_bridge_predictions (
  prediction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_ts timestamptz NOT NULL,
  model_version text NOT NULL,
  model_variant text NOT NULL,
  feature_schema text NOT NULL,
  config_hash text NOT NULL,
  feature_order_hash text NOT NULL,
  implementation_revision text,
  run_mode text NOT NULL DEFAULT 'LIVE',
  trigger_kind text,
  source_index integer,
  boise_date text,
  utc_date text,
  packet_count integer,
  packet_first_offset integer,
  packet_last_offset integer,
  packet_complete boolean NOT NULL DEFAULT false,
  packet_failure_reason text,
  packet_last_bar_ts timestamptz,
  prior_technicals_ready boolean NOT NULL DEFAULT false,
  prior_technicals_reason text,
  base_direction text,
  ret10_bps double precision,
  packet_features jsonb,
  technical_features jsonb,
  feature_vector jsonb,
  feature_vector_hash text,
  features_valid boolean NOT NULL DEFAULT false,
  fit_id text,
  fit_block_start_index integer,
  fit_certified boolean NOT NULL DEFAULT false,
  fit_source text,
  correctness_probability double precision,
  long_rank double precision,
  fast_rank double precision,
  long_rank_count integer,
  fast_rank_count integer,
  long_window_start_ts timestamptz,
  long_window_end_ts timestamptz,
  fast_window_start_ts timestamptz,
  fast_window_end_ts timestamptz,
  rank_state_checksum text,
  rank_certified boolean NOT NULL DEFAULT false,
  policy_would_trade boolean NOT NULL DEFAULT false,
  policy_direction text,
  policy_decision_reason text,
  activation_mode text,
  activation_boundary_ts timestamptz,
  final_prediction text,
  webhook_eligible boolean NOT NULL DEFAULT false,
  webhook_claimed_at timestamptz,
  webhook_sent boolean NOT NULL DEFAULT false,
  webhook_sent_at timestamptz,
  webhook_status integer,
  webhook_response text,
  webhook_idempotency_key text UNIQUE,
  webhook_latency_ms integer,
  decision_at timestamptz,
  decision_offset_ms integer,
  webhook_offset_ms integer,
  actual_open double precision,
  actual_high double precision,
  actual_low double precision,
  actual_close double precision,
  actual_direction text,
  outcome_source text,
  result text,
  raw_score integer,
  resolved_at timestamptz,
  resolution_attempt_count integer NOT NULL DEFAULT 0,
  last_resolution_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_version, target_ts)
);
CREATE INDEX t10_bridge_predictions_target_idx ON public.t10_bridge_predictions (target_ts DESC);
CREATE INDEX t10_bridge_predictions_source_index_idx ON public.t10_bridge_predictions (source_index);
CREATE INDEX t10_bridge_predictions_unresolved_idx ON public.t10_bridge_predictions (resolved_at) WHERE resolved_at IS NULL;
GRANT SELECT ON public.t10_bridge_predictions TO authenticated;
GRANT ALL ON public.t10_bridge_predictions TO service_role;
ALTER TABLE public.t10_bridge_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t10 predictions readable by authenticated" ON public.t10_bridge_predictions FOR SELECT TO authenticated USING (true);
CREATE TRIGGER t10_bridge_predictions_set_updated_at BEFORE UPDATE ON public.t10_bridge_predictions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.t10_bridge_activation (
  singleton_key text PRIMARY KEY,
  mode text NOT NULL DEFAULT 'SHADOW_ONLY',
  model_version text NOT NULL,
  model_variant text NOT NULL,
  config_hash text NOT NULL,
  webhooks_enabled boolean NOT NULL DEFAULT false,
  approval_note text,
  approved_at timestamptz,
  activation_boundary_ts timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.t10_bridge_activation TO authenticated;
GRANT ALL ON public.t10_bridge_activation TO service_role;
ALTER TABLE public.t10_bridge_activation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t10 activation readable by authenticated" ON public.t10_bridge_activation FOR SELECT TO authenticated USING (true);
CREATE TRIGGER t10_bridge_activation_set_updated_at BEFORE UPDATE ON public.t10_bridge_activation FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.t10_bridge_activation
  (singleton_key, mode, model_version, model_variant, config_hash, webhooks_enabled, approval_note)
VALUES
  ('T10_BRIDGE', 'SHADOW_ONLY', 't10-bridge-r1', 'cross94-c0003-dual-rank',
   '82fda0f1a91d5d7dc17ffeff590e8bcb914305db27cd2b5c6f8116ed6abf045c', false,
   'Installed in shadow-only mode; webhooks remain disabled until forward verification is approved.');

CREATE TABLE public.t10_collector_health (
  stream_key text PRIMARY KEY,
  status text,
  deployment_id text,
  collector_version text,
  reconnect_count integer DEFAULT 0,
  consecutive_errors integer DEFAULT 0,
  last_error_code text,
  last_error_message text,
  last_target_ts timestamptz,
  last_target_seconds integer,
  last_boundary_target_ts timestamptz,
  last_boundary_status text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.t10_collector_health TO authenticated;
GRANT ALL ON public.t10_collector_health TO service_role;
ALTER TABLE public.t10_collector_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t10 collector health readable by authenticated" ON public.t10_collector_health FOR SELECT TO authenticated USING (true);