-- Add auditability columns to predictions and predictions_archive.
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS fetch_source text,
  ADD COLUMN IF NOT EXISTS advance_check_passed boolean,
  ADD COLUMN IF NOT EXISTS current_partial_minutes_elapsed integer,
  ADD COLUMN IF NOT EXISTS current_partial_snapshot jsonb;

ALTER TABLE public.predictions_archive
  ADD COLUMN IF NOT EXISTS fetch_source text,
  ADD COLUMN IF NOT EXISTS advance_check_passed boolean,
  ADD COLUMN IF NOT EXISTS current_partial_minutes_elapsed integer,
  ADD COLUMN IF NOT EXISTS current_partial_snapshot jsonb;

-- Backfill actual_direction wherever OHLC is populated but direction wasn't derived.
UPDATE public.predictions
SET actual_direction = CASE
  WHEN actual_next_candle_close > actual_next_candle_open THEN 'GREEN'
  WHEN actual_next_candle_close < actual_next_candle_open THEN 'RED'
  ELSE 'DOJI'
END
WHERE actual_direction IS NULL
  AND actual_next_candle_open IS NOT NULL
  AND actual_next_candle_close IS NOT NULL;

UPDATE public.predictions_archive
SET actual_direction = CASE
  WHEN actual_next_candle_close > actual_next_candle_open THEN 'GREEN'
  WHEN actual_next_candle_close < actual_next_candle_open THEN 'RED'
  ELSE 'DOJI'
END
WHERE actual_direction IS NULL
  AND actual_next_candle_open IS NOT NULL
  AND actual_next_candle_close IS NOT NULL;

-- Add a fetch_source column to candles so we know which feed produced each row.
ALTER TABLE public.candles
  ADD COLUMN IF NOT EXISTS fetch_source text;