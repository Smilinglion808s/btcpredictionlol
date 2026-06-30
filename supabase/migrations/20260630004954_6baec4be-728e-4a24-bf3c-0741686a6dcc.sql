
-- Lock down all tables: app uses service_role server-side only.
DROP POLICY IF EXISTS candles_auth_read ON public.candles;
DROP POLICY IF EXISTS candles_auth_write ON public.candles;
DROP POLICY IF EXISTS candles_auth_update ON public.candles;
DROP POLICY IF EXISTS candles_auth_delete ON public.candles;

DROP POLICY IF EXISTS predictions_auth_read ON public.predictions;
DROP POLICY IF EXISTS predictions_auth_insert ON public.predictions;
DROP POLICY IF EXISTS predictions_auth_update ON public.predictions;
DROP POLICY IF EXISTS predictions_auth_delete ON public.predictions;

DROP POLICY IF EXISTS ms_auth_read ON public.model_settings;
DROP POLICY IF EXISTS ms_auth_insert ON public.model_settings;
DROP POLICY IF EXISTS ms_auth_update ON public.model_settings;
DROP POLICY IF EXISTS ms_auth_delete ON public.model_settings;

DROP POLICY IF EXISTS api_runs_auth_read ON public.api_runs;
DROP POLICY IF EXISTS api_runs_auth_insert ON public.api_runs;

REVOKE ALL ON public.candles FROM anon, authenticated;
REVOKE ALL ON public.predictions FROM anon, authenticated;
REVOKE ALL ON public.model_settings FROM anon, authenticated;
REVOKE ALL ON public.api_runs FROM anon, authenticated;

GRANT ALL ON public.candles TO service_role;
GRANT ALL ON public.predictions TO service_role;
GRANT ALL ON public.model_settings TO service_role;
GRANT ALL ON public.api_runs TO service_role;

-- Lock down SECURITY DEFINER function; service_role bypasses these grants.
REVOKE EXECUTE ON FUNCTION public.prediction_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prediction_stats() TO service_role;
