
DROP FUNCTION IF EXISTS public.get_or_mint_a96_fit_episode(text);
DROP FUNCTION IF EXISTS public.resolve_a96_prediction(uuid, double precision, double precision);

CREATE OR REPLACE FUNCTION public.get_or_mint_a96_fit_episode(p_artifact_fit_id text)
RETURNS SETOF public.a96_fit_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active public.a96_fit_state%ROWTYPE;
  v_new_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('a96_fit_episode', 0));
  SELECT * INTO v_active FROM public.a96_fit_state WHERE is_active = true FOR UPDATE;
  IF FOUND AND v_active.artifact_fit_id = p_artifact_fit_id THEN
    RETURN NEXT v_active; RETURN;
  END IF;
  IF FOUND THEN
    UPDATE public.a96_fit_state SET is_active = false, updated_at = now()
     WHERE fit_episode_id = v_active.fit_episode_id;
  END IF;
  v_new_id := gen_random_uuid();
  INSERT INTO public.a96_fit_state
    (fit_episode_id, artifact_fit_id, activated_at, is_active,
     comparable_resolved_count, layer_a_wins, layer_a_losses, layer_a_net,
     layer_b_wins, layer_b_losses, layer_b_net, updated_at)
  VALUES (v_new_id, p_artifact_fit_id, now(), true, 0, 0, 0, 0, 0, 0, 0, now());
  RETURN QUERY SELECT * FROM public.a96_fit_state WHERE fit_episode_id = v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_mint_a96_fit_episode(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_a96_prediction(
  p_prediction_id uuid,
  p_actual_open double precision,
  p_actual_close double precision
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.a96_predictions%ROWTYPE;
  v_dir text;
  v_score smallint;
  v_a_win boolean;
  v_b_win boolean;
BEGIN
  SELECT * INTO v_row FROM public.a96_predictions
    WHERE prediction_id = p_prediction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_row.resolved_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;
  IF p_actual_close > p_actual_open THEN v_dir := 'GREEN';
  ELSIF p_actual_close < p_actual_open THEN v_dir := 'RED';
  ELSE v_dir := 'PUSH'; END IF;
  IF v_row.final_prediction = 'ABSTAIN' OR v_dir = 'PUSH' THEN v_score := 0;
  ELSIF v_row.final_prediction = v_dir THEN v_score := 1;
  ELSE v_score := -1; END IF;

  UPDATE public.a96_predictions
     SET actual_open = p_actual_open, actual_close = p_actual_close,
         actual_direction = v_dir, result_score = v_score, resolved_at = now()
   WHERE prediction_id = p_prediction_id;

  IF v_dir IN ('GREEN','RED') THEN
    v_a_win := (v_row.layer_a_direction = v_dir);
    v_b_win := (v_row.layer_b_direction = v_dir);
    UPDATE public.a96_fit_state
       SET comparable_resolved_count = comparable_resolved_count + 1,
           layer_a_wins   = layer_a_wins   + CASE WHEN v_a_win THEN 1 ELSE 0 END,
           layer_a_losses = layer_a_losses + CASE WHEN v_a_win THEN 0 ELSE 1 END,
           layer_a_net    = (layer_a_wins   + CASE WHEN v_a_win THEN 1 ELSE 0 END)
                          - (layer_a_losses + CASE WHEN v_a_win THEN 0 ELSE 1 END),
           layer_b_wins   = layer_b_wins   + CASE WHEN v_b_win THEN 1 ELSE 0 END,
           layer_b_losses = layer_b_losses + CASE WHEN v_b_win THEN 0 ELSE 1 END,
           layer_b_net    = (layer_b_wins   + CASE WHEN v_b_win THEN 1 ELSE 0 END)
                          - (layer_b_losses + CASE WHEN v_b_win THEN 0 ELSE 1 END),
           updated_at = now()
     WHERE fit_episode_id = v_row.fit_episode_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'direction', v_dir, 'result_score', v_score);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_a96_prediction(uuid, double precision, double precision) TO authenticated, service_role;
