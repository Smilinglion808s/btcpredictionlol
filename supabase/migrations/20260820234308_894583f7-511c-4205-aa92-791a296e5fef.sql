CREATE TABLE public.t45_pf_fits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fit_id text NOT NULL UNIQUE,
  model_version text NOT NULL,
  config_hash text NOT NULL,
  feature_schema text NOT NULL,
  feature_order_hash text NOT NULL,
  block_index integer NOT NULL,
  block_start_index integer NOT NULL,
  training_start_ts timestamptz,
  training_end_ts timestamptz,
  training_row_count integer NOT NULL,
  training_fingerprint text,
  feature_order text[] NOT NULL,
  scaler text,
  scaler_center double precision[],
  scaler_scale double precision[],
  coefficients double precision[],
  intercept double precision,
  logistic_c double precision,
  solver text,
  converged boolean,
  certified boolean NOT NULL DEFAULT false,
  iterations integer,
  gradient_norm double precision,
  artifact_hash text,
  impl_revision text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.t45_pf_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_ts timestamptz NOT NULL,
  model_name text NOT NULL,
  model_version text NOT NULL,
  model_variant text NOT NULL,
  base_head text,
  config_hash text NOT NULL,
  feature_schema text NOT NULL,
  feature_order_hash text NOT NULL,
  impl_revision text,
  run_mode text NOT NULL,
  utc_date text,
  local_date text,
  decision_cutoff_ts timestamptz,
  decided_at timestamptz,
  source_last_bar_ts timestamptz,
  expected_observations integer,
  actual_observations integer,
  unique_observations integer,
  min_offset_seconds integer,
  max_offset_seconds integer,
  missing_offsets integer[],
  duplicate_offsets integer[],
  timing_valid boolean,
  packet_ready boolean,
  feature_complete boolean,
  feature_values_json jsonb,
  fit_id text,
  fit_block_index integer,
  fit_block_start_index integer,
  fit_training_row_count integer,
  fit_training_fingerprint text,
  fit_artifact_hash text,
  fit_certified boolean,
  scaler text,
  solver text,
  probability_green double precision,
  confidence double precision,
  confidence_rank double precision,
  rank_history_count integer,
  base_direction smallint,
  active_prediction smallint,
  active_sleeve text,
  active_would_trade boolean NOT NULL DEFAULT false,
  decision_valid boolean NOT NULL DEFAULT false,
  decision_reason text,
  activation_mode text NOT NULL DEFAULT 'SHADOW_ONLY',
  webhook_eligible boolean NOT NULL DEFAULT false,
  webhook_sent boolean NOT NULL DEFAULT false,
  webhook_idempotency_key text,
  actual_open double precision,
  actual_high double precision,
  actual_low double precision,
  actual_close double precision,
  actual_direction smallint,
  outcome_source text,
  resolved_at timestamptz,
  active_result text,
  active_score smallint,
  resolution_attempts integer NOT NULL DEFAULT 0,
  last_resolution_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT t45_pf_predictions_unique UNIQUE (target_ts, model_version, run_mode)
);

CREATE INDEX t45_pf_predictions_target_idx ON public.t45_pf_predictions (model_version, run_mode, target_ts DESC);
CREATE INDEX t45_pf_predictions_conf_idx ON public.t45_pf_predictions (model_version, target_ts DESC) WHERE confidence IS NOT NULL;
CREATE INDEX t45_pf_predictions_unresolved_idx ON public.t45_pf_predictions (model_version, run_mode, target_ts) WHERE resolved_at IS NULL;

CREATE TABLE public.t45_pf_activation (
  singleton_key text PRIMARY KEY,
  mode text NOT NULL DEFAULT 'SHADOW_ONLY',
  webhooks_enabled boolean NOT NULL DEFAULT false,
  model_version text NOT NULL,
  config_hash text NOT NULL,
  activation_target_ts timestamptz,
  approval_note text,
  approved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.t45_pf_activation (singleton_key, mode, webhooks_enabled, model_version, config_hash)
VALUES ('T45_PRICE_FLOW', 'SHADOW_ONLY', false, 't45-price-flow-q375-r1', '9b20f6a3c54c11b594aa659574780a6562831268e360c771b7ba1b3c21c238db');

GRANT SELECT ON public.t45_pf_fits TO authenticated;
GRANT ALL ON public.t45_pf_fits TO service_role;
GRANT SELECT ON public.t45_pf_predictions TO authenticated;
GRANT ALL ON public.t45_pf_predictions TO service_role;
GRANT SELECT ON public.t45_pf_activation TO authenticated;
GRANT ALL ON public.t45_pf_activation TO service_role;

ALTER TABLE public.t45_pf_fits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t45_pf_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t45_pf_activation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "t45_pf_fits_read" ON public.t45_pf_fits FOR SELECT TO authenticated USING (true);
CREATE POLICY "t45_pf_predictions_read" ON public.t45_pf_predictions FOR SELECT TO authenticated USING (true);
CREATE POLICY "t45_pf_activation_read" ON public.t45_pf_activation FOR SELECT TO authenticated USING (true);

CREATE TRIGGER t45_pf_predictions_set_updated_at BEFORE UPDATE ON public.t45_pf_predictions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();