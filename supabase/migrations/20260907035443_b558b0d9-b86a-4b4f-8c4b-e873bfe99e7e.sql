CREATE OR REPLACE FUNCTION public.c85_append_checkpoint(p_checkpoint jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_model text := p_checkpoint->>'model_version';
  v_last public.c85_state_checkpoints%ROWTYPE;
  v_seq bigint;
  v_expected bigint := NULLIF(p_checkpoint->>'expected_parent_seq','')::bigint;
BEGIN
  IF v_model IS NULL THEN RAISE EXCEPTION 'checkpoint.model_version required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('c85_checkpoint:' || v_model, 0));

  SELECT * INTO v_last FROM public.c85_state_checkpoints
   WHERE model_version = v_model ORDER BY checkpoint_seq DESC LIMIT 1;

  IF v_expected IS NOT NULL AND COALESCE(v_last.checkpoint_seq, 0) <> v_expected THEN
    RAISE EXCEPTION 'c85 checkpoint conflict: expected parent seq %, found %',
      v_expected, COALESCE(v_last.checkpoint_seq, 0);
  END IF;

  v_seq := COALESCE(v_last.checkpoint_seq, 0) + 1;

  INSERT INTO public.c85_state_checkpoints (
    model_version, checkpoint_seq, as_of_utc, last_processed_target_utc, next_target_utc,
    stage, admission_rank_state, filter_rank_state, deterioration_state,
    pending_base_calls, consumed_settlements, expert_state, applicable_fits,
    source_watermarks, state_sha256, parent_sha256
  ) VALUES (
    v_model, v_seq,
    COALESCE((p_checkpoint->>'as_of_utc')::timestamptz, now()),
    NULLIF(p_checkpoint->>'last_processed_target_utc','')::timestamptz,
    NULLIF(p_checkpoint->>'next_target_utc','')::timestamptz,
    p_checkpoint->>'stage',
    COALESCE(p_checkpoint->'admission_rank_state','{}'::jsonb),
    COALESCE(p_checkpoint->'filter_rank_state','{}'::jsonb),
    COALESCE(p_checkpoint->'deterioration_state','{}'::jsonb),
    COALESCE(p_checkpoint->'pending_base_calls','[]'::jsonb),
    COALESCE(p_checkpoint->'consumed_settlements','[]'::jsonb),
    COALESCE(p_checkpoint->'expert_state','{}'::jsonb),
    COALESCE(p_checkpoint->'applicable_fits','{}'::jsonb),
    COALESCE(p_checkpoint->'source_watermarks','{}'::jsonb),
    p_checkpoint->>'state_sha256',
    v_last.state_sha256
  );

  RETURN jsonb_build_object('checkpoint_seq', v_seq, 'parent_sha256', v_last.state_sha256);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.c85_append_checkpoint(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.c85_append_checkpoint(jsonb) TO service_role;