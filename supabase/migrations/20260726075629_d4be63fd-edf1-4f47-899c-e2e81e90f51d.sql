
CREATE TABLE public.model8_v3_predictions (
  prediction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text NOT NULL DEFAULT 'model8_v3-r1',
  feature_schema_version text NOT NULL DEFAULT 'v1',
  fit_id text,
  target_candle_ts timestamptz NOT NULL UNIQUE,
  feature_cutoff_ts timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  prediction_latency_ms integer,
  prediction_created_before_target boolean NOT NULL,
  feature_history_valid boolean NOT NULL,
  data_quality_valid boolean NOT NULL,
  abstain_reason text,
  feature_values jsonb,
  fit_snapshot jsonb,
  raw_probability_green double precision,
  calibrated_probability_green double precision,
  raw_prediction text CHECK (raw_prediction IS NULL OR raw_prediction IN ('GREEN','RED')),
  qualified_prediction text NOT NULL CHECK (qualified_prediction IN ('GREEN','RED','ABSTAIN')),
  target_open_at_prediction double precision,
  actual_open double precision,
  actual_high double precision,
  actual_low double precision,
  actual_close double precision,
  actual_volume double precision,
  actual_direction text,
  raw_result text CHECK (raw_result IS NULL OR raw_result IN ('WIN','LOSS','PUSH')),
  qualified_result text CHECK (qualified_result IS NULL OR qualified_result IN ('WIN','LOSS','PUSH','ABSTAIN')),
  resolved_at timestamptz,
  last_resolution_error text,
  last_resolution_attempt_at timestamptz,
  official_forward_eligible boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.model8_v3_predictions TO service_role;

ALTER TABLE public.model8_v3_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "model8_v3_predictions deny all"
  ON public.model8_v3_predictions
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS model8_v3_predictions_target_idx
  ON public.model8_v3_predictions(target_candle_ts DESC);

CREATE INDEX IF NOT EXISTS model8_v3_predictions_unresolved_idx
  ON public.model8_v3_predictions(target_candle_ts)
  WHERE resolved_at IS NULL;

CREATE TRIGGER model8_v3_predictions_set_updated
  BEFORE UPDATE ON public.model8_v3_predictions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.resolve_model8_v3_prediction(
  p_prediction_id uuid,
  p_actual_open double precision,
  p_actual_high double precision,
  p_actual_low double precision,
  p_actual_close double precision,
  p_actual_volume double precision DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.model8_v3_predictions%ROWTYPE;
  v_dir text;
  v_raw_res text;
  v_qual_res text;
BEGIN
  SELECT * INTO v_row FROM public.model8_v3_predictions
    WHERE prediction_id = p_prediction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_row.resolved_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  IF p_actual_open IS NULL OR p_actual_close IS NULL THEN
    UPDATE public.model8_v3_predictions
      SET last_resolution_error = 'missing_ohlc',
          last_resolution_attempt_at = now()
      WHERE prediction_id = p_prediction_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_ohlc');
  END IF;

  IF p_actual_close > p_actual_open THEN v_dir := 'GREEN';
  ELSIF p_actual_close < p_actual_open THEN v_dir := 'RED';
  ELSE v_dir := 'PUSH'; END IF;

  IF v_dir = 'PUSH' THEN
    v_raw_res := 'PUSH';
    v_qual_res := 'PUSH';
  ELSE
    IF v_row.raw_prediction IS NULL THEN
      v_raw_res := NULL;
    ELSIF v_row.raw_prediction = v_dir THEN
      v_raw_res := 'WIN';
    ELSE
      v_raw_res := 'LOSS';
    END IF;

    IF v_row.qualified_prediction = 'ABSTAIN' THEN
      v_qual_res := 'ABSTAIN';
    ELSIF v_row.qualified_prediction = v_dir THEN
      v_qual_res := 'WIN';
    ELSE
      v_qual_res := 'LOSS';
    END IF;
  END IF;

  UPDATE public.model8_v3_predictions
    SET actual_open = p_actual_open,
        actual_high = p_actual_high,
        actual_low = p_actual_low,
        actual_close = p_actual_close,
        actual_volume = p_actual_volume,
        actual_direction = v_dir,
        raw_result = v_raw_res,
        qualified_result = v_qual_res,
        resolved_at = now(),
        last_resolution_error = NULL,
        last_resolution_attempt_at = now(),
        official_forward_eligible = (v_row.data_quality_valid AND v_row.feature_history_valid AND v_row.prediction_created_before_target)
    WHERE prediction_id = p_prediction_id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false,
    'actual_direction', v_dir,
    'raw_result', v_raw_res,
    'qualified_result', v_qual_res
  );
END;
$$;
