CREATE OR REPLACE FUNCTION public.v11_commit_observation(p_target_ts timestamp with time zone, p_score jsonb, p_decision jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_score_written boolean := false;
  v_decision_written boolean := false;
  v_state_ts timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('v11:' || p_target_ts::text, 0));

  INSERT INTO public.v11_scores (
    target_ts, ticker, head_date, probability, confidence, rank, rank_history,
    availability, admission_gate, valid, reason, run_mode,
    event_cutoff_offset_ms, inputs_persisted_offset_ms, decision_offset_ms
  )
  SELECT p_target_ts,
         p_score->>'ticker',
         NULLIF(p_score->>'head_date','')::date,
         (p_score->>'probability')::double precision,
         (p_score->>'confidence')::double precision,
         (p_score->>'rank')::double precision,
         COALESCE((p_score->>'rank_history')::integer, 0),
         (p_score->>'availability')::double precision,
         (p_score->>'admission_gate')::double precision,
         COALESCE((p_score->>'valid')::boolean, false),
         p_score->>'reason',
         COALESCE(p_score->>'run_mode','RESEARCH'),
         (p_score->>'event_cutoff_offset_ms')::integer,
         (p_score->>'inputs_persisted_offset_ms')::integer,
         (p_score->>'decision_offset_ms')::integer
  ON CONFLICT (target_ts) DO NOTHING;
  GET DIAGNOSTICS v_score_written = ROW_COUNT;

  INSERT INTO public.v11_decisions (
    target_ts, ticker, event_key, leg, side, reason, probability, rank,
    admission_gate, head_date, v1_status, v1_reason, v1_final_side,
    v1_floor_open, v1_send_claim, strategy, dispatch_enabled, run_mode, evidence,
    event_cutoff_offset_ms, inputs_persisted_offset_ms, decision_offset_ms,
    publication_ceiling_ms, within_publication_ceiling
  )
  SELECT p_target_ts,
         p_decision->>'ticker',
         p_decision->>'event_key',
         p_decision->>'leg',
         COALESCE((p_decision->>'side')::smallint, 0),
         p_decision->>'reason',
         (p_decision->>'probability')::double precision,
         (p_decision->>'rank')::double precision,
         (p_decision->>'admission_gate')::double precision,
         NULLIF(p_decision->>'head_date','')::date,
         p_decision->>'v1_status',
         p_decision->>'v1_reason',
         (p_decision->>'v1_final_side')::smallint,
         (p_decision->>'v1_floor_open')::boolean,
         p_decision->>'v1_send_claim',
         COALESCE(p_decision->'strategy','{}'::jsonb),
         false,
         COALESCE(p_decision->>'run_mode','RESEARCH'),
         COALESCE(p_decision->'evidence','{}'::jsonb),
         (p_decision->>'event_cutoff_offset_ms')::integer,
         (p_decision->>'inputs_persisted_offset_ms')::integer,
         (p_decision->>'decision_offset_ms')::integer,
         (p_decision->>'publication_ceiling_ms')::integer,
         (p_decision->>'within_publication_ceiling')::boolean
  ON CONFLICT (target_ts) DO NOTHING;
  GET DIAGNOSTICS v_decision_written = ROW_COUNT;

  INSERT INTO public.v11_state (state_key, last_processed_ts)
  VALUES ('v11-shadow', p_target_ts)
  ON CONFLICT (state_key) DO UPDATE
    SET last_processed_ts = GREATEST(
          COALESCE(public.v11_state.last_processed_ts, p_target_ts), p_target_ts),
        updated_at = now()
  RETURNING last_processed_ts INTO v_state_ts;

  RETURN jsonb_build_object(
    'score_written', v_score_written,
    'decision_written', v_decision_written,
    'last_processed_ts', v_state_ts
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.v11_commit_observation(timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v11_commit_observation(timestamptz, jsonb, jsonb) TO service_role;