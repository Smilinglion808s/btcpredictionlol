ALTER TABLE public.model7_td1_rc_shadow
  ADD COLUMN IF NOT EXISTS td1_compressed_risk_incremental_change boolean,
  ADD COLUMN IF NOT EXISTS td1_compressed_risk_attribution_version text,
  ADD COLUMN IF NOT EXISTS td1_prev_policy_skip_reason text;