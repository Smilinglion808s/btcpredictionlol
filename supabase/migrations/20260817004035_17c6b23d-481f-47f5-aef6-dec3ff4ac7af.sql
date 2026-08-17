-- B4x4-ES1 Balanced Binance 3-of-4 R1 — persistence

ALTER TABLE public.b4x4_es1_activation
  ADD COLUMN IF NOT EXISTS balanced_policy_version text,
  ADD COLUMN IF NOT EXISTS balanced_activation_target_ts timestamptz,
  ADD COLUMN IF NOT EXISTS balanced_activation_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS balanced_activation_snapshot jsonb;

ALTER TABLE public.b4x4_es1_predictions
  ADD COLUMN IF NOT EXISTS balanced_model_version text,
  ADD COLUMN IF NOT EXISTS balanced_policy_version text,
  ADD COLUMN IF NOT EXISTS balanced_prospective_test_id text,
  ADD COLUMN IF NOT EXISTS balanced_feature_schema text,
  ADD COLUMN IF NOT EXISTS balanced_implementation_revision text,
  ADD COLUMN IF NOT EXISTS balanced_config_hash text,
  ADD COLUMN IF NOT EXISTS balanced_activation_target_ts timestamptz,
  ADD COLUMN IF NOT EXISTS balanced_active boolean,
  ADD COLUMN IF NOT EXISTS balanced_es1_price_direction text,
  ADD COLUMN IF NOT EXISTS balanced_es1_probability_green double precision,
  ADD COLUMN IF NOT EXISTS balanced_es1_confidence double precision,
  ADD COLUMN IF NOT EXISTS balanced_es1_parity_certified boolean,
  ADD COLUMN IF NOT EXISTS balanced_price_fit_id text,
  ADD COLUMN IF NOT EXISTS balanced_price_fit_source text,
  ADD COLUMN IF NOT EXISTS balanced_spot_feature_id uuid,
  ADD COLUMN IF NOT EXISTS balanced_perp_feature_id uuid,
  ADD COLUMN IF NOT EXISTS balanced_spot_values_hash text,
  ADD COLUMN IF NOT EXISTS balanced_perp_values_hash text,
  ADD COLUMN IF NOT EXISTS balanced_spot_capture_status text,
  ADD COLUMN IF NOT EXISTS balanced_perp_capture_status text,
  ADD COLUMN IF NOT EXISTS balanced_spot_ready boolean,
  ADD COLUMN IF NOT EXISTS balanced_perp_ready boolean,
  ADD COLUMN IF NOT EXISTS balanced_spot_ready_reason text,
  ADD COLUMN IF NOT EXISTS balanced_perp_ready_reason text,
  ADD COLUMN IF NOT EXISTS balanced_spot_gate_reason text,
  ADD COLUMN IF NOT EXISTS balanced_perp_gate_reason text,
  ADD COLUMN IF NOT EXISTS balanced_spot_resync_continuous boolean,
  ADD COLUMN IF NOT EXISTS balanced_perp_resync_continuous boolean,
  ADD COLUMN IF NOT EXISTS balanced_spot_final_imbalance_10bps double precision,
  ADD COLUMN IF NOT EXISTS balanced_spot_normalized_ofi_60s double precision,
  ADD COLUMN IF NOT EXISTS balanced_perp_final_imbalance_10bps double precision,
  ADD COLUMN IF NOT EXISTS balanced_es1_vote smallint,
  ADD COLUMN IF NOT EXISTS balanced_spot_depth_vote smallint,
  ADD COLUMN IF NOT EXISTS balanced_spot_ofi60_vote smallint,
  ADD COLUMN IF NOT EXISTS balanced_perp_fade_vote smallint,
  ADD COLUMN IF NOT EXISTS balanced_green_vote_count smallint,
  ADD COLUMN IF NOT EXISTS balanced_red_vote_count smallint,
  ADD COLUMN IF NOT EXISTS balanced_vote_sum smallint,
  ADD COLUMN IF NOT EXISTS balanced_vote_margin smallint,
  ADD COLUMN IF NOT EXISTS balanced_vote_pattern text,
  ADD COLUMN IF NOT EXISTS balanced_agreement_tier text,
  ADD COLUMN IF NOT EXISTS balanced_final_prediction text,
  ADD COLUMN IF NOT EXISTS balanced_would_trade boolean,
  ADD COLUMN IF NOT EXISTS balanced_decision_reason text,
  ADD COLUMN IF NOT EXISTS balanced_webhook_eligible boolean,
  ADD COLUMN IF NOT EXISTS balanced_webhook_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS balanced_binance_loaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS balanced_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS balanced_legacy_would_trade boolean,
  ADD COLUMN IF NOT EXISTS balanced_legacy_direction text,
  ADD COLUMN IF NOT EXISTS balanced_legacy_decision_reason text,
  ADD COLUMN IF NOT EXISTS balanced_result text,
  ADD COLUMN IF NOT EXISTS balanced_result_score double precision,
  ADD COLUMN IF NOT EXISTS balanced_legacy_result text,
  ADD COLUMN IF NOT EXISTS balanced_legacy_score double precision,
  ADD COLUMN IF NOT EXISTS balanced_incremental_value double precision,
  ADD COLUMN IF NOT EXISTS balanced_resolved_at timestamptz;

CREATE INDEX IF NOT EXISTS b4x4_es1_predictions_balanced_target_idx
  ON public.b4x4_es1_predictions (target_candle_ts DESC)
  WHERE balanced_policy_version IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.b4x4_es1_balanced_shadows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  target_ts timestamptz NOT NULL,
  prediction_id uuid,
  policy_name text NOT NULL,
  policy_version text NOT NULL,
  config_hash text,
  implementation_revision text,
  run_mode text NOT NULL DEFAULT 'LIVE',
  qualified boolean NOT NULL DEFAULT false,
  qualification_reason text,
  candidate_direction text,
  would_trade boolean NOT NULL DEFAULT false,
  agreement_tier text,
  is_active_policy boolean NOT NULL DEFAULT false,
  vote_pattern text,
  es1_vote smallint,
  spot_depth_vote smallint,
  spot_ofi60_vote smallint,
  perp_fade_vote smallint,
  spot_feature_id uuid,
  perp_feature_id uuid,
  input_values_hash text,
  actual_direction text,
  result text,
  result_score double precision,
  resolved_at timestamptz,
  CONSTRAINT b4x4_es1_balanced_shadows_unique UNIQUE (target_ts, policy_name)
);

GRANT SELECT ON public.b4x4_es1_balanced_shadows TO authenticated;
GRANT ALL ON public.b4x4_es1_balanced_shadows TO service_role;

ALTER TABLE public.b4x4_es1_balanced_shadows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "balanced shadows readable by authenticated"
  ON public.b4x4_es1_balanced_shadows
  FOR SELECT TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS b4x4_es1_balanced_shadows_target_idx
  ON public.b4x4_es1_balanced_shadows (target_ts DESC);
CREATE INDEX IF NOT EXISTS b4x4_es1_balanced_shadows_policy_idx
  ON public.b4x4_es1_balanced_shadows (policy_name, target_ts DESC);