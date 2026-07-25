DO $$
DECLARE
  v_old_episode uuid;
  v_artifact text;
  v_new_id uuid := gen_random_uuid();
BEGIN
  SELECT fit_episode_id, artifact_fit_id
    INTO v_old_episode, v_artifact
    FROM public.a96_fit_state
   WHERE is_active = true
   LIMIT 1;

  IF v_old_episode IS NOT NULL THEN
    UPDATE public.a96_predictions
       SET prospective_valid = false,
           prospective_invalid_reason = 'FINALIZED_CANDLE_INGEST_TIMING_FAILURE'
     WHERE fit_episode_id = v_old_episode
       AND (prospective_valid IS DISTINCT FROM false);

    UPDATE public.a96_fit_state
       SET is_active = false,
           reset_reason = COALESCE(reset_reason, 'CANDLE_INGEST_ORDERING_FIX'),
           updated_at = now()
     WHERE fit_episode_id = v_old_episode;

    INSERT INTO public.a96_fit_state
      (fit_episode_id, artifact_fit_id, activated_at, is_active,
       comparable_resolved_count, layer_a_wins, layer_a_losses, layer_a_net,
       layer_b_wins, layer_b_losses, layer_b_net, updated_at, reset_reason)
    VALUES
      (v_new_id, v_artifact, now(), true,
       0, 0, 0, 0, 0, 0, 0, now(), 'CANDLE_INGEST_ORDERING_FIX');
  END IF;
END $$;