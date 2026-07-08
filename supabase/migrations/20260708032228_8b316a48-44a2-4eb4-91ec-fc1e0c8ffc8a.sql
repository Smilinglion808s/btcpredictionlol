ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS base_bullish_score numeric,
  ADD COLUMN IF NOT EXISTS base_bearish_score numeric,
  ADD COLUMN IF NOT EXISTS bullish_score numeric,
  ADD COLUMN IF NOT EXISTS bearish_score numeric,
  ADD COLUMN IF NOT EXISTS score_margin numeric,
  ADD COLUMN IF NOT EXISTS original_prediction_before_partial text,
  ADD COLUMN IF NOT EXISTS changed_by_partial boolean,
  ADD COLUMN IF NOT EXISTS change_reason text,
  ADD COLUMN IF NOT EXISTS module_points jsonb;

ALTER TABLE public.predictions_archive
  ADD COLUMN IF NOT EXISTS base_bullish_score numeric,
  ADD COLUMN IF NOT EXISTS base_bearish_score numeric,
  ADD COLUMN IF NOT EXISTS bullish_score numeric,
  ADD COLUMN IF NOT EXISTS bearish_score numeric,
  ADD COLUMN IF NOT EXISTS score_margin numeric,
  ADD COLUMN IF NOT EXISTS original_prediction_before_partial text,
  ADD COLUMN IF NOT EXISTS changed_by_partial boolean,
  ADD COLUMN IF NOT EXISTS change_reason text,
  ADD COLUMN IF NOT EXISTS module_points jsonb;