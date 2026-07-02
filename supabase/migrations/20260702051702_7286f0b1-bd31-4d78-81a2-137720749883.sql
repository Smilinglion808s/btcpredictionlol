
CREATE TABLE IF NOT EXISTS public.predictions_archive (LIKE public.predictions INCLUDING ALL);
ALTER TABLE public.predictions_archive DROP CONSTRAINT IF EXISTS predictions_archive_pkey;
ALTER TABLE public.predictions_archive ADD CONSTRAINT predictions_archive_pkey PRIMARY KEY (id);
ALTER TABLE public.predictions_archive ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS predictions_archive_model_version_idx ON public.predictions_archive (model_version);
CREATE INDEX IF NOT EXISTS predictions_archive_candle_ts_idx ON public.predictions_archive (candle_ts);

GRANT SELECT (
  id, symbol, timeframe, model_version, api_model_id, candle_ts, prediction, confidence,
  btc_price_at_prediction, setup_type, market_condition, reasoning_summary, status,
  actual_next_candle_open, actual_next_candle_high, actual_next_candle_low, actual_next_candle_close,
  resolved_at, notes, created_at, archived_at
) ON public.predictions_archive TO anon;
GRANT SELECT ON public.predictions_archive TO authenticated;
GRANT ALL ON public.predictions_archive TO service_role;

ALTER TABLE public.predictions_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read archive" ON public.predictions_archive;
CREATE POLICY "read archive" ON public.predictions_archive FOR SELECT USING (true);
