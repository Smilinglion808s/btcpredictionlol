
ALTER TABLE public.model7_shadow
  ADD COLUMN IF NOT EXISTS target_boundary_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS score_not_before_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feature_cutoff_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_candle_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS latest_source_candle_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS latest_source_event_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timing_status TEXT,
  ADD COLUMN IF NOT EXISTS leakage_check_passed BOOLEAN,
  ADD COLUMN IF NOT EXISTS leakage_block_reason TEXT,
  ADD COLUMN IF NOT EXISTS offending_features_json JSONB;
