
ALTER TABLE public.a96_predictions
  ADD COLUMN IF NOT EXISTS candle_symbol text,
  ADD COLUMN IF NOT EXISTS candle_timeframe text,
  ADD COLUMN IF NOT EXISTS candle_provider text,
  ADD COLUMN IF NOT EXISTS prior_candle_row_ids uuid[],
  ADD COLUMN IF NOT EXISTS target_candle_row_id uuid,
  ADD COLUMN IF NOT EXISTS resolution_candle_row_id uuid,
  ADD COLUMN IF NOT EXISTS candle_data_valid boolean,
  ADD COLUMN IF NOT EXISTS candle_data_invalid_reason text,
  ADD COLUMN IF NOT EXISTS target_open_difference_bps double precision,
  ADD COLUMN IF NOT EXISTS resolution_data_invalid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prospective_valid boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS prospective_invalid_reason text;

ALTER TABLE public.a96_fit_state
  ADD COLUMN IF NOT EXISTS reset_reason text;

-- Enforce one authoritative row per (symbol, timeframe, candle_ts, provider).
CREATE UNIQUE INDEX IF NOT EXISTS candles_stream_ts_uniq
  ON public.candles (symbol, timeframe, candle_ts, fetch_source);

-- Invalidate all existing prospective evidence.
UPDATE public.a96_predictions
   SET prospective_valid = false,
       prospective_invalid_reason = 'CANDLE_STREAM_OR_FINALIZATION_MISMATCH'
 WHERE prospective_valid IS DISTINCT FROM false;

-- End the current fit episode so the next runA96 call mints a fresh one.
UPDATE public.a96_fit_state
   SET is_active = false,
       reset_reason = 'DATA_PIPELINE_ALIGNMENT_FIX',
       updated_at = now()
 WHERE is_active = true;
