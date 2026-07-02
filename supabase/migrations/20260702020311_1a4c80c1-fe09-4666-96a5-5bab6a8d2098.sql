
-- 1) predictions: keep row-level anon SELECT policy (needed for realtime),
--    but restrict columns via column-level GRANTs so full_ai_response and
--    indicators are never readable via PostgREST or realtime payloads.
REVOKE SELECT ON public.predictions FROM anon;
GRANT SELECT (
  id, symbol, timeframe, model_version, api_model_id,
  candle_ts, prediction, confidence, btc_price_at_prediction,
  setup_type, market_condition, reasoning_summary, notes,
  status, actual_next_candle_open, actual_next_candle_high,
  actual_next_candle_low, actual_next_candle_close,
  resolved_at, created_at
) ON public.predictions TO anon;

-- 2) webhook_endpoints: RLS is enabled with no policies. Also revoke base
--    privileges from anon and authenticated so accidental future policies
--    still cannot expose the signing secret. service_role retains access.
REVOKE ALL ON public.webhook_endpoints FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.webhook_endpoints TO service_role;

-- 3) candles: publicly-visible market data. Add a permissive SELECT policy
--    so realtime subscribers (anon) receive change events.
DROP POLICY IF EXISTS "Public can read candles" ON public.candles;
CREATE POLICY "Public can read candles" ON public.candles
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.candles TO anon, authenticated;
