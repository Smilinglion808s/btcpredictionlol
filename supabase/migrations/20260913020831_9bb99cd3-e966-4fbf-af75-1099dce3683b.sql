DROP POLICY IF EXISTS "Public can read predictions" ON public.predictions;

CREATE OR REPLACE VIEW public.public_predictions
WITH (security_invoker = false) AS
SELECT
  model_version,
  api_model_id,
  candle_ts,
  prediction,
  confidence,
  btc_price_at_prediction,
  setup_type,
  market_condition,
  status,
  actual_next_candle_close,
  created_at,
  resolved_at
FROM public.predictions;

GRANT SELECT ON public.public_predictions TO anon;
GRANT SELECT ON public.public_predictions TO authenticated;
GRANT ALL ON public.public_predictions TO service_role;