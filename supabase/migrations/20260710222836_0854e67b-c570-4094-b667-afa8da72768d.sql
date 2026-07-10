
ALTER TABLE public.model7_shadow
  ADD COLUMN IF NOT EXISTS boundary_delta_ms integer,
  ADD COLUMN IF NOT EXISTS scored_at timestamptz,
  ADD COLUMN IF NOT EXISTS snapshot_ts timestamptz,
  ADD COLUMN IF NOT EXISTS model_artifact_sha256 text,
  ADD COLUMN IF NOT EXISTS feature_vector_sha256 text,
  ADD COLUMN IF NOT EXISTS override_reasons_json jsonb,
  ADD COLUMN IF NOT EXISTS history_candles_available integer,
  ADD COLUMN IF NOT EXISTS history_gap_encountered boolean,
  ADD COLUMN IF NOT EXISTS missing_raw_numeric_fields_json jsonb;

ALTER TABLE public.model7_training_fits
  ADD COLUMN IF NOT EXISTS training_cutoff_ts timestamptz,
  ADD COLUMN IF NOT EXISTS training_row_count integer,
  ADD COLUMN IF NOT EXISTS artifact_sha256 text;
