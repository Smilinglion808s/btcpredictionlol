
-- === New columns on model8_v3_predictions ============================
ALTER TABLE public.model8_v3_predictions
  ADD COLUMN IF NOT EXISTS symbol text NOT NULL DEFAULT 'BTC-USDT',
  ADD COLUMN IF NOT EXISTS timeframe text NOT NULL DEFAULT '15m',
  ADD COLUMN IF NOT EXISTS code_version text,
  ADD COLUMN IF NOT EXISTS episode_type text NOT NULL DEFAULT 'engineering_shakedown',
  ADD COLUMN IF NOT EXISTS official_forward_test_row boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_quality_invalid_reason text,
  ADD COLUMN IF NOT EXISTS raw_probability_movement double precision,
  ADD COLUMN IF NOT EXISTS calibrated_probability_movement double precision,
  ADD COLUMN IF NOT EXISTS movement_threshold_bps double precision,
  ADD COLUMN IF NOT EXISTS minimum_direction_edge double precision,
  ADD COLUMN IF NOT EXISTS minimum_movement_probability double precision,
  ADD COLUMN IF NOT EXISTS actual_body_bps double precision,
  ADD COLUMN IF NOT EXISTS actual_movement_hit boolean;

-- Backfill legacy rows explicitly as engineering shakedown.
UPDATE public.model8_v3_predictions
   SET episode_type = 'engineering_shakedown',
       official_forward_test_row = false
 WHERE episode_type IS NULL OR episode_type = 'engineering_shakedown';

-- Swap the uniqueness constraint so multiple model versions can coexist.
ALTER TABLE public.model8_v3_predictions
  DROP CONSTRAINT IF EXISTS model8_v3_predictions_target_candle_ts_key;
CREATE UNIQUE INDEX IF NOT EXISTS model8_v3_predictions_uniq_ver
  ON public.model8_v3_predictions (model_version, symbol, timeframe, target_candle_ts);

-- === model8_v3_fits (immutable fit storage) ==========================
CREATE TABLE IF NOT EXISTS public.model8_v3_fits (
  fit_id text PRIMARY KEY,
  model_version text NOT NULL,
  feature_schema_version text NOT NULL,
  code_version text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  training_start_ts timestamptz NOT NULL,
  training_end_ts timestamptz NOT NULL,
  calibration_start_ts timestamptz NOT NULL,
  calibration_end_ts timestamptz NOT NULL,
  feature_order jsonb NOT NULL,
  preprocess jsonb NOT NULL,      -- means/scales
  direction_coefficients jsonb NOT NULL,
  direction_intercept double precision NOT NULL,
  movement_coefficients jsonb NOT NULL,
  movement_intercept double precision NOT NULL,
  l2_penalty double precision NOT NULL,
  platt_direction jsonb NOT NULL, -- {a,b}
  platt_movement jsonb NOT NULL,
  config_snapshot jsonb NOT NULL,
  training_metrics jsonb NOT NULL,
  calibration_metrics jsonb NOT NULL,
  fitted_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.model8_v3_fits TO authenticated;
GRANT ALL ON public.model8_v3_fits TO service_role;
ALTER TABLE public.model8_v3_fits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "model8_v3_fits deny all" ON public.model8_v3_fits
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- === Resolution RPC: dual-track grading, idempotent ==================
CREATE OR REPLACE FUNCTION public.resolve_model8_v3_prediction(
  p_prediction_id uuid,
  p_actual_open double precision,
  p_actual_high double precision,
  p_actual_low double precision,
  p_actual_close double precision,
  p_actual_volume double precision DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.model8_v3_predictions%ROWTYPE;
  v_dir text;
  v_body_bps double precision;
  v_move_hit boolean;
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

  v_body_bps := CASE WHEN p_actual_open > 0
    THEN abs(p_actual_close - p_actual_open) / p_actual_open * 10000.0
    ELSE 0 END;
  v_move_hit := (v_row.movement_threshold_bps IS NOT NULL
                 AND v_body_bps >= v_row.movement_threshold_bps);

  -- Raw track (always graded when a raw prediction exists).
  IF v_row.raw_prediction IS NULL THEN
    v_raw_res := NULL;
  ELSIF v_dir = 'PUSH' THEN
    v_raw_res := 'PUSH';
  ELSIF v_row.raw_prediction = v_dir THEN
    v_raw_res := 'WIN';
  ELSE
    v_raw_res := 'LOSS';
  END IF;

  -- Qualified track.
  IF v_row.qualified_prediction = 'ABSTAIN' THEN
    v_qual_res := 'ABSTAIN';
  ELSIF v_dir = 'PUSH' THEN
    v_qual_res := 'PUSH';
  ELSIF v_row.qualified_prediction = v_dir THEN
    v_qual_res := 'WIN';
  ELSE
    v_qual_res := 'LOSS';
  END IF;

  UPDATE public.model8_v3_predictions
    SET actual_open = p_actual_open,
        actual_high = p_actual_high,
        actual_low = p_actual_low,
        actual_close = p_actual_close,
        actual_volume = p_actual_volume,
        actual_direction = v_dir,
        actual_body_bps = v_body_bps,
        actual_movement_hit = v_move_hit,
        raw_result = v_raw_res,
        qualified_result = v_qual_res,
        resolved_at = now(),
        last_resolution_error = NULL,
        last_resolution_attempt_at = now(),
        official_forward_eligible = (v_row.data_quality_valid
                                     AND v_row.feature_history_valid
                                     AND v_row.prediction_created_before_target)
    WHERE prediction_id = p_prediction_id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false,
    'actual_direction', v_dir,
    'raw_result', v_raw_res,
    'qualified_result', v_qual_res,
    'actual_body_bps', v_body_bps,
    'movement_hit', v_move_hit
  );
END;
$function$;
