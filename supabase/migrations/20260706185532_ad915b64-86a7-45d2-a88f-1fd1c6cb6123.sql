ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS input_candle_ts timestamptz,
  ADD COLUMN IF NOT EXISTS input_candle_age_seconds integer,
  ADD COLUMN IF NOT EXISTS input_features_fresh boolean,
  ADD COLUMN IF NOT EXISTS freshness_action text,
  ADD COLUMN IF NOT EXISTS actual_direction text;

ALTER TABLE public.predictions_archive
  ADD COLUMN IF NOT EXISTS input_candle_ts timestamptz,
  ADD COLUMN IF NOT EXISTS input_candle_age_seconds integer,
  ADD COLUMN IF NOT EXISTS input_features_fresh boolean,
  ADD COLUMN IF NOT EXISTS freshness_action text,
  ADD COLUMN IF NOT EXISTS actual_direction text;