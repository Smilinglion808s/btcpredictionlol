ALTER TABLE public.model7_td1_rc_shadow
  ADD COLUMN IF NOT EXISTS td2_policy_version text,
  ADD COLUMN IF NOT EXISTS td2_prospective_test_id text,
  ADD COLUMN IF NOT EXISTS td2_policy_activation_ts timestamptz,
  ADD COLUMN IF NOT EXISTS td2_recovery_feature_name text,
  ADD COLUMN IF NOT EXISTS td2_recovery_feature_value double precision,
  ADD COLUMN IF NOT EXISTS td2_recovery_threshold double precision,
  ADD COLUMN IF NOT EXISTS td2_recovery_evaluable boolean,
  ADD COLUMN IF NOT EXISTS td2_recovery_condition boolean,
  ADD COLUMN IF NOT EXISTS td2_recovery_fired boolean,
  ADD COLUMN IF NOT EXISTS td2_recovery_reason text,
  ADD COLUMN IF NOT EXISTS td2_recovery_direction text,
  ADD COLUMN IF NOT EXISTS td2_recovery_source_feature_cutoff_ts timestamptz,
  ADD COLUMN IF NOT EXISTS td2_r1_counterfactual_decision text,
  ADD COLUMN IF NOT EXISTS td2_r1_counterfactual_would_trade boolean,
  ADD COLUMN IF NOT EXISTS td2_r1_counterfactual_skip_reason text,
  ADD COLUMN IF NOT EXISTS td2_r1_counterfactual_result text,
  ADD COLUMN IF NOT EXISTS td2_r1_counterfactual_score integer,
  ADD COLUMN IF NOT EXISTS td2_recovery_result text,
  ADD COLUMN IF NOT EXISTS td2_recovery_score integer,
  ADD COLUMN IF NOT EXISTS td2_recovery_incremental_value integer,
  ADD COLUMN IF NOT EXISTS td2_recovery_value_class text;

CREATE INDEX IF NOT EXISTS model7_td1_rc_shadow_td2_test_idx
  ON public.model7_td1_rc_shadow (prospective_test_id, candle_ts DESC);