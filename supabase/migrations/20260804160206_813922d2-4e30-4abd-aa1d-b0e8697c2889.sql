ALTER TABLE public.v6_predictions
  ADD COLUMN IF NOT EXISTS model_revision text,
  ADD COLUMN IF NOT EXISTS original_v6_base_prediction text,
  ADD COLUMN IF NOT EXISTS original_v6_base_source text,
  ADD COLUMN IF NOT EXISTS pre_inverter_prediction text,
  ADD COLUMN IF NOT EXISTS pre_inverter_prediction_source text,
  ADD COLUMN IF NOT EXISTS regime_inverter_evaluable boolean,
  ADD COLUMN IF NOT EXISTS regime_inverter_ready boolean,
  ADD COLUMN IF NOT EXISTS regime_inverter_active boolean,
  ADD COLUMN IF NOT EXISTS regime_inverter_triggered boolean,
  ADD COLUMN IF NOT EXISTS regime_inverter_history_count integer,
  ADD COLUMN IF NOT EXISTS regime_inverter_history_json jsonb,
  ADD COLUMN IF NOT EXISTS regime_inverter_last20_wins integer,
  ADD COLUMN IF NOT EXISTS regime_inverter_last20_losses integer,
  ADD COLUMN IF NOT EXISTS regime_inverter_last20_adjusted_net double precision,
  ADD COLUMN IF NOT EXISTS regime_inverter_activation_threshold double precision,
  ADD COLUMN IF NOT EXISTS regime_inverter_original_prediction text,
  ADD COLUMN IF NOT EXISTS regime_inverter_replacement_prediction text,
  ADD COLUMN IF NOT EXISTS regime_inverter_reason text,
  ADD COLUMN IF NOT EXISTS original_v6_shadow_raw_score double precision,
  ADD COLUMN IF NOT EXISTS original_v6_shadow_adjusted_score double precision,
  ADD COLUMN IF NOT EXISTS pre_inverter_raw_score double precision,
  ADD COLUMN IF NOT EXISTS pre_inverter_adjusted_score double precision,
  ADD COLUMN IF NOT EXISTS regime_inverter_raw_contribution double precision,
  ADD COLUMN IF NOT EXISTS regime_inverter_adjusted_contribution double precision,
  ADD COLUMN IF NOT EXISTS final_prediction_source text;

CREATE TABLE IF NOT EXISTS public.v6_regime_inverter_state (
  model_version text PRIMARY KEY,
  regime_inverter_model_revision text NOT NULL,
  fit_id text,
  model_artifact_sha256 text,
  feature_schema_version text,
  regime_inverter_history_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  regime_inverter_history_count integer NOT NULL DEFAULT 0,
  regime_inverter_last_resolved_target_ts timestamptz,
  regime_inverter_ready boolean NOT NULL DEFAULT false,
  regime_inverter_active boolean NOT NULL DEFAULT false,
  regime_inverter_last20_wins integer NOT NULL DEFAULT 0,
  regime_inverter_last20_losses integer NOT NULL DEFAULT 0,
  regime_inverter_last20_adjusted_net double precision NOT NULL DEFAULT 0,
  regime_inverter_activation_threshold double precision NOT NULL DEFAULT -2.8,
  regime_inverter_state_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.v6_regime_inverter_state TO service_role;

ALTER TABLE public.v6_regime_inverter_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages v6 regime inverter state"
  ON public.v6_regime_inverter_state
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE TRIGGER v6_regime_inverter_state_set_updated_at
  BEFORE UPDATE ON public.v6_regime_inverter_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();