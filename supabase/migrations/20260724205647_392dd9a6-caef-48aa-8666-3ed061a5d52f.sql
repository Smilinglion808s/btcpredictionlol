
ALTER TABLE public.a96_predictions
  ADD COLUMN IF NOT EXISTS actual_high double precision,
  ADD COLUMN IF NOT EXISTS actual_low double precision,
  ADD COLUMN IF NOT EXISTS actual_volume double precision,
  ADD COLUMN IF NOT EXISTS layer_a_result_score smallint,
  ADD COLUMN IF NOT EXISTS layer_b_result_score smallint,
  ADD COLUMN IF NOT EXISTS base_prediction text,
  ADD COLUMN IF NOT EXISTS base_result_score smallint,
  ADD COLUMN IF NOT EXISTS resolution_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_resolution_error text,
  ADD COLUMN IF NOT EXISTS last_resolution_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS feature_history_valid boolean,
  ADD COLUMN IF NOT EXISTS feature_history_error text,
  ADD COLUMN IF NOT EXISTS prior_candles_snapshot jsonb;

-- Drop old overloads so we install one canonical signature.
DROP FUNCTION IF EXISTS public.resolve_a96_prediction(uuid, double precision, double precision);
DROP FUNCTION IF EXISTS public.resolve_a96_prediction(uuid, double precision, double precision, timestamptz);
DROP FUNCTION IF EXISTS public.resolve_a96_prediction(uuid, double precision, double precision, double precision, double precision, double precision);

CREATE OR REPLACE FUNCTION public.resolve_a96_prediction(
  p_prediction_id uuid,
  p_actual_open double precision,
  p_actual_close double precision,
  p_actual_high double precision DEFAULT NULL,
  p_actual_low double precision DEFAULT NULL,
  p_actual_volume double precision DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.a96_predictions%ROWTYPE;
  v_state public.a96_fit_state%ROWTYPE;
  v_dir text;
  v_final_score smallint;
  v_a_score smallint;
  v_b_score smallint;
  v_base_score smallint;
  v_base_pred text;
  v_directional boolean;
BEGIN
  -- Lock the prediction row itself so concurrent resolvers can't double-apply.
  SELECT * INTO v_row FROM public.a96_predictions
    WHERE prediction_id = p_prediction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Always bump attempt counter + timestamp (helps diagnose retry storms).
  UPDATE public.a96_predictions
    SET resolution_attempt_count = COALESCE(resolution_attempt_count, 0) + 1,
        last_resolution_attempt_at = now()
    WHERE prediction_id = p_prediction_id;

  IF v_row.resolved_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true,
      'actual_direction', v_row.actual_direction, 'result_score', v_row.result_score);
  END IF;

  IF p_actual_open IS NULL OR p_actual_close IS NULL THEN
    UPDATE public.a96_predictions
      SET last_resolution_error = 'missing_ohlc'
      WHERE prediction_id = p_prediction_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_ohlc');
  END IF;

  -- Lock the prediction's ORIGINAL fit-episode row (not whichever is active now).
  SELECT * INTO v_state FROM public.a96_fit_state
    WHERE fit_episode_id = v_row.fit_episode_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.a96_predictions
      SET last_resolution_error = 'fit_episode_missing'
      WHERE prediction_id = p_prediction_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'fit_episode_missing');
  END IF;

  -- Ground truth from OHLC only.
  IF p_actual_close > p_actual_open THEN v_dir := 'GREEN';
  ELSIF p_actual_close < p_actual_open THEN v_dir := 'RED';
  ELSE v_dir := 'PUSH'; END IF;
  v_directional := (v_dir IN ('GREEN','RED'));

  -- Score final prediction.
  IF v_row.final_prediction = 'ABSTAIN' OR NOT v_directional THEN v_final_score := 0;
  ELSIF v_row.final_prediction = v_dir THEN v_final_score := 1;
  ELSE v_final_score := -1; END IF;

  -- Per-layer counterfactual scores (independent of what was published).
  IF NOT v_directional THEN
    v_a_score := 0; v_b_score := 0;
  ELSE
    v_a_score := CASE WHEN v_row.layer_a_direction = v_dir THEN 1 ELSE -1 END;
    v_b_score := CASE WHEN v_row.layer_b_direction = v_dir THEN 1 ELSE -1 END;
  END IF;

  -- Base prediction = whichever layer the internal base selector chose.
  IF v_row.base_selected_layer = 'A' THEN v_base_pred := v_row.layer_a_direction;
  ELSIF v_row.base_selected_layer = 'B' THEN v_base_pred := v_row.layer_b_direction;
  ELSE v_base_pred := NULL; END IF;
  IF v_base_pred IS NULL OR NOT v_directional THEN v_base_score := 0;
  ELSIF v_base_pred = v_dir THEN v_base_score := 1;
  ELSE v_base_score := -1; END IF;

  -- Persist the resolution on the prediction row.
  UPDATE public.a96_predictions
     SET actual_open = p_actual_open,
         actual_close = p_actual_close,
         actual_high = p_actual_high,
         actual_low = p_actual_low,
         actual_volume = p_actual_volume,
         actual_direction = v_dir,
         result_score = v_final_score,
         layer_a_result_score = v_a_score,
         layer_b_result_score = v_b_score,
         base_prediction = v_base_pred,
         base_result_score = v_base_score,
         resolved_at = now(),
         last_resolution_error = NULL
   WHERE prediction_id = p_prediction_id;

  -- Update the prediction's own fit episode counters (exactly once, PUSH excluded).
  IF v_directional THEN
    UPDATE public.a96_fit_state
       SET comparable_resolved_count = comparable_resolved_count + 1,
           layer_a_wins   = layer_a_wins   + CASE WHEN v_a_score = 1 THEN 1 ELSE 0 END,
           layer_a_losses = layer_a_losses + CASE WHEN v_a_score = -1 THEN 1 ELSE 0 END,
           layer_a_net    = layer_a_net    + v_a_score,
           layer_b_wins   = layer_b_wins   + CASE WHEN v_b_score = 1 THEN 1 ELSE 0 END,
           layer_b_losses = layer_b_losses + CASE WHEN v_b_score = -1 THEN 1 ELSE 0 END,
           layer_b_net    = layer_b_net    + v_b_score,
           updated_at = now()
     WHERE fit_episode_id = v_row.fit_episode_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false,
    'actual_direction', v_dir, 'result_score', v_final_score,
    'layer_a_result_score', v_a_score, 'layer_b_result_score', v_b_score,
    'base_result_score', v_base_score,
    'fit_episode_id', v_row.fit_episode_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_a96_prediction(uuid, double precision, double precision, double precision, double precision, double precision) TO authenticated, service_role;
