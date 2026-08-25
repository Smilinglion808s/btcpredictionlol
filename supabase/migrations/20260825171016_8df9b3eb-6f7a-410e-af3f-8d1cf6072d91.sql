CREATE TABLE public.t30_cross89_samples (
  target_ts timestamptz NOT NULL,
  offset_seconds smallint NOT NULL,
  bar_open_ms bigint NOT NULL,
  bar_close_ts timestamptz NOT NULL,
  open double precision NOT NULL,
  high double precision NOT NULL,
  low double precision NOT NULL,
  close double precision NOT NULL,
  volume double precision NOT NULL,
  quote_volume double precision NOT NULL,
  taker_buy_volume double precision,
  taker_buy_quote_volume double precision NOT NULL,
  trade_count double precision NOT NULL,
  is_final boolean NOT NULL DEFAULT true,
  event_time_ms bigint,
  final_event_ms bigint,
  received_at timestamptz NOT NULL DEFAULT now(),
  collector_version text,
  build_identifier text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_ts, offset_seconds)
);
GRANT SELECT ON public.t30_cross89_samples TO authenticated;
GRANT ALL ON public.t30_cross89_samples TO service_role;
ALTER TABLE public.t30_cross89_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30x89 samples readable by authenticated" ON public.t30_cross89_samples FOR SELECT TO authenticated USING (true);

CREATE TABLE public.t30_cross89_features (
  target_ts timestamptz PRIMARY KEY,
  source_index integer,
  feature_version text NOT NULL,
  feature_order_hash text NOT NULL,
  seconds_present smallint NOT NULL DEFAULT 0,
  first_offset_s smallint,
  last_offset_s smallint,
  packet_ready boolean NOT NULL DEFAULT false,
  packet_reason text,
  base_direction smallint,
  spot_tech_ready boolean NOT NULL DEFAULT false,
  fut_tech_ready boolean NOT NULL DEFAULT false,
  feature_complete boolean NOT NULL DEFAULT false,
  invalid_reason text,
  features jsonb,
  vector double precision[],
  okx_open double precision,
  okx_high double precision,
  okx_low double precision,
  okx_close double precision,
  okx_direction smallint,
  label smallint,
  label_source text,
  source text NOT NULL DEFAULT 'LIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX t30_cross89_features_index_idx ON public.t30_cross89_features (source_index);
GRANT SELECT ON public.t30_cross89_features TO authenticated;
GRANT ALL ON public.t30_cross89_features TO service_role;
ALTER TABLE public.t30_cross89_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30x89 features readable by authenticated" ON public.t30_cross89_features FOR SELECT TO authenticated USING (true);

CREATE TABLE public.t30_cross89_fits (
  fit_id text PRIMARY KEY,
  block_index integer NOT NULL,
  block_start_index integer NOT NULL UNIQUE,
  training_start_index integer NOT NULL,
  training_end_index integer NOT NULL,
  training_start_ts timestamptz NOT NULL,
  training_end_ts timestamptz NOT NULL,
  training_row_count integer NOT NULL,
  center double precision[] NOT NULL,
  scale double precision[] NOT NULL,
  coefficients double precision[] NOT NULL,
  intercept double precision NOT NULL,
  converged boolean NOT NULL,
  iterations integer NOT NULL,
  gradient_norm double precision NOT NULL,
  feature_order_hash text NOT NULL,
  window_fingerprint text NOT NULL,
  artifact_hash text NOT NULL,
  solver text NOT NULL,
  model_version text NOT NULL,
  config_hash text,
  certified boolean NOT NULL DEFAULT false,
  certification_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.t30_cross89_fits TO authenticated;
GRANT ALL ON public.t30_cross89_fits TO service_role;
ALTER TABLE public.t30_cross89_fits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30x89 fits readable by authenticated" ON public.t30_cross89_fits FOR SELECT TO authenticated USING (true);

CREATE TABLE public.t30_cross89_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_ts timestamptz NOT NULL UNIQUE,
  source_index integer,
  model_name text NOT NULL,
  model_version text NOT NULL,
  model_variant text NOT NULL,
  feature_schema text NOT NULL,
  config_hash text,
  feature_order_hash text NOT NULL,
  impl_revision text NOT NULL,
  run_mode text NOT NULL DEFAULT 'LIVE',
  execution_path text,
  trigger_kind text,
  seconds_present smallint,
  first_offset_s smallint,
  last_offset_s smallint,
  packet_ready boolean NOT NULL DEFAULT false,
  packet_reason text,
  packet_finalized_at timestamptz,
  features jsonb,
  vector double precision[],
  base_direction smallint,
  spot_tech_ready boolean NOT NULL DEFAULT false,
  fut_tech_ready boolean NOT NULL DEFAULT false,
  feature_complete boolean NOT NULL DEFAULT false,
  probability_correct double precision,
  long_rank double precision,
  fast_rank double precision,
  long_rank_window integer,
  fast_rank_window integer,
  long_rank_count integer,
  fast_rank_count integer,
  long_rank_start_ts timestamptz,
  long_rank_end_ts timestamptz,
  fast_rank_start_ts timestamptz,
  fast_rank_end_ts timestamptz,
  gate_long_pass boolean,
  gate_fast_pass boolean,
  model_would_trade boolean NOT NULL DEFAULT false,
  model_direction smallint,
  decision_reason text NOT NULL,
  decision_valid boolean NOT NULL DEFAULT false,
  fit_id text,
  fit_block_index integer,
  fit_block_start_index integer,
  fit_certified boolean,
  fit_artifact_hash text,
  fit_training_row_count integer,
  activation_mode text NOT NULL DEFAULT 'SHADOW_ONLY',
  activation_target_ts timestamptz,
  webhook_eligible boolean NOT NULL DEFAULT false,
  webhook_claimed_at timestamptz,
  webhook_sent_at timestamptz,
  webhook_latency_ms integer,
  webhook_offset_ms integer,
  webhook_error text,
  webhook_idempotency_key text,
  decided_at timestamptz,
  decision_offset_ms integer,
  okx_open double precision,
  okx_high double precision,
  okx_low double precision,
  okx_close double precision,
  okx_direction smallint,
  correctness_label smallint,
  outcome text,
  raw_score double precision,
  resolution_attempts integer NOT NULL DEFAULT 0,
  resolution_error text,
  resolved_at timestamptz,
  yes_decimal_odds double precision,
  no_decimal_odds double precision,
  selected_decimal_odds double precision,
  odds_source text,
  odds_captured_at timestamptz,
  odds_age_ms integer,
  bet_placed boolean,
  bet_decimal_odds double precision,
  bet_recorded_at timestamptz,
  betting_units double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX t30_cross89_predictions_target_idx ON public.t30_cross89_predictions (target_ts DESC);
CREATE INDEX t30_cross89_predictions_open_idx ON public.t30_cross89_predictions (resolved_at) WHERE resolved_at IS NULL;
GRANT SELECT ON public.t30_cross89_predictions TO authenticated;
GRANT ALL ON public.t30_cross89_predictions TO service_role;
ALTER TABLE public.t30_cross89_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30x89 predictions readable by authenticated" ON public.t30_cross89_predictions FOR SELECT TO authenticated USING (true);

CREATE TABLE public.t30_cross89_activation (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL DEFAULT 'SHADOW_ONLY' CHECK (mode IN ('SHADOW_ONLY','ACTIVE')),
  model_version text NOT NULL,
  config_hash text,
  webhooks_enabled boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approval_note text,
  activation_target_ts timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.t30_cross89_activation TO authenticated;
GRANT ALL ON public.t30_cross89_activation TO service_role;
ALTER TABLE public.t30_cross89_activation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30x89 activation readable by authenticated" ON public.t30_cross89_activation FOR SELECT TO authenticated USING (true);
INSERT INTO public.t30_cross89_activation (id, mode, model_version, webhooks_enabled, approval_note)
VALUES (true, 'SHADOW_ONLY', 't30-cross89-dual-rank-r1', false, 'Deployed shadow-only; webhooks disabled.');

CREATE TABLE public.t30_cross89_policy_shadows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid REFERENCES public.t30_cross89_predictions(id) ON DELETE CASCADE,
  target_ts timestamptz NOT NULL,
  policy text NOT NULL,
  would_trade boolean NOT NULL DEFAULT false,
  direction smallint,
  probability_correct double precision,
  long_rank double precision,
  fast_rank double precision,
  outcome text,
  raw_score double precision,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_ts, policy)
);
GRANT SELECT ON public.t30_cross89_policy_shadows TO authenticated;
GRANT ALL ON public.t30_cross89_policy_shadows TO service_role;
ALTER TABLE public.t30_cross89_policy_shadows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "t30x89 shadows readable by authenticated" ON public.t30_cross89_policy_shadows FOR SELECT TO authenticated USING (true);

CREATE TRIGGER t30_cross89_features_updated BEFORE UPDATE ON public.t30_cross89_features
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t30_cross89_predictions_updated BEFORE UPDATE ON public.t30_cross89_predictions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t30_cross89_activation_updated BEFORE UPDATE ON public.t30_cross89_activation
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();