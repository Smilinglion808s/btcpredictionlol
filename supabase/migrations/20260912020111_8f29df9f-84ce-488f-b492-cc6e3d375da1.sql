ALTER TABLE public.v11_state ADD COLUMN IF NOT EXISTS state_version BIGINT NOT NULL DEFAULT 0;

INSERT INTO public.v11_state (state_key) VALUES ('v11-shadow')
ON CONFLICT (state_key) DO NOTHING;

UPDATE public.v11_state s
SET last_processed_ts = GREATEST(COALESCE(s.last_processed_ts, '-infinity'::timestamptz),
                                 COALESCE((SELECT last_processed_ts FROM public.v11_state WHERE state_key = 'default'), '-infinity'::timestamptz)),
    last_fit_date = COALESCE(s.last_fit_date, (SELECT last_fit_date FROM public.v11_state WHERE state_key = 'default'))
WHERE s.state_key = 'v11-shadow'
  AND EXISTS (SELECT 1 FROM public.v11_state WHERE state_key = 'default');

DROP FUNCTION IF EXISTS public.v11_commit_observation(timestamptz, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.v11_commit_observation(
  p_target_ts timestamptz,
  p_score jsonb,
  p_decision jsonb,
  p_expected_prev_ts timestamptz DEFAULT NULL,
  p_expected_state_version bigint DEFAULT NULL,
  p_allow_backfill boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state        public.v11_state%ROWTYPE;
  v_prev         timestamptz;
  v_gap          timestamptz;
  v_gap_count    int := 0;
  v_score_exists boolean;
  v_dec_exists   boolean;
  v_score_w      boolean := false;
  v_dec_w        boolean := false;
  v_side         int;
  v_leg          text;
  v_t            record;
  v_blocked      boolean;
BEGIN
  IF p_target_ts IS NULL THEN
    RAISE EXCEPTION 'v11_commit_observation: target_ts required';
  END IF;

  -- ONE global lock: Version 1.1 observations are committed in strict
  -- chronological order, so a per-target lock is not enough. Concurrent
  -- targets serialize here and the loser re-reads the state it must extend.
  PERFORM pg_advisory_xact_lock(hashtext('v11-shadow-commit'));

  SELECT * INTO v_state FROM public.v11_state WHERE state_key = 'v11-shadow' FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.v11_state (state_key) VALUES ('v11-shadow')
    RETURNING * INTO v_state;
  END IF;
  v_prev := v_state.last_processed_ts;

  SELECT EXISTS (SELECT 1 FROM public.v11_scores    WHERE target_ts = p_target_ts) INTO v_score_exists;
  SELECT EXISTS (SELECT 1 FROM public.v11_decisions WHERE target_ts = p_target_ts) INTO v_dec_exists;

  -- Idempotent replay of a fully committed target: the stored pair is
  -- canonical and nothing is rewritten or re-advanced.
  IF v_score_exists AND v_dec_exists THEN
    RETURN jsonb_build_object(
      'committed', false, 'duplicate', true, 'repaired', false,
      'score_written', false, 'decision_written', false,
      'last_processed_ts', v_state.last_processed_ts,
      'state_version', v_state.state_version);
  END IF;

  -- Optimistic concurrency: the caller computed rank/availability against a
  -- specific prior state. If that moved, its numbers are stale.
  IF p_expected_state_version IS NOT NULL
     AND p_expected_state_version <> v_state.state_version THEN
    RETURN jsonb_build_object(
      'committed', false, 'stale', true, 'reason', 'STATE_VERSION_CHANGED',
      'expected_state_version', p_expected_state_version,
      'actual_state_version', v_state.state_version,
      'last_processed_ts', v_state.last_processed_ts);
  END IF;
  IF p_expected_prev_ts IS DISTINCT FROM NULL
     AND v_prev IS DISTINCT FROM p_expected_prev_ts THEN
    RETURN jsonb_build_object(
      'committed', false, 'stale', true, 'reason', 'PRIOR_STATE_CHANGED',
      'expected_prev_ts', p_expected_prev_ts,
      'actual_prev_ts', v_prev,
      'state_version', v_state.state_version);
  END IF;

  -- Forward-only, and never skip an official opportunity that has no decision.
  IF NOT p_allow_backfill THEN
    IF v_prev IS NOT NULL AND p_target_ts <= v_prev THEN
      RETURN jsonb_build_object(
        'committed', false, 'out_of_order', true, 'reason', 'TARGET_NOT_AFTER_CHECKPOINT',
        'last_processed_ts', v_prev, 'state_version', v_state.state_version);
    END IF;
    SELECT c.target_ts INTO v_gap
    FROM public.v11_context_rows c
    WHERE c.target_ts > COALESCE(v_prev, '-infinity'::timestamptz)
      AND c.target_ts < p_target_ts
      AND NOT EXISTS (SELECT 1 FROM public.v11_decisions d WHERE d.target_ts = c.target_ts)
    ORDER BY c.target_ts
    LIMIT 1;
    IF v_gap IS NOT NULL THEN
      SELECT count(*) INTO v_gap_count
      FROM public.v11_context_rows c
      WHERE c.target_ts > COALESCE(v_prev, '-infinity'::timestamptz)
        AND c.target_ts < p_target_ts
        AND NOT EXISTS (SELECT 1 FROM public.v11_decisions d WHERE d.target_ts = c.target_ts);
      RETURN jsonb_build_object(
        'committed', false, 'gap', true, 'reason', 'PREDECESSOR_MISSING',
        'first_missing_ts', v_gap, 'missing_count', v_gap_count,
        'last_processed_ts', v_prev, 'state_version', v_state.state_version);
    END IF;
  END IF;

  -- Cross-leg exclusion re-verified INSIDE the transaction. A fallback call is
  -- only admissible when the frozen V1 leg stood down and holds no send claim.
  v_side := COALESCE((p_decision->>'side')::int, 0);
  v_leg  := p_decision->>'leg';
  IF v_side <> 0 AND v_leg = 'T45R2' THEN
    SELECT t.id, t.final_side, t.webhook_status,
           (t.features->'lite_a'->>'reason') AS reason,
           (t.features->>'input_valid') AS input_valid
      INTO v_t
    FROM public.c85_targets t
    WHERE t.model_version = 'lite-a-floor4-top10-r1'
      AND t.target_open_utc = p_target_ts
    FOR SHARE;
    v_blocked := (v_t IS NULL)
      OR COALESCE(v_t.final_side, 1) <> 0
      OR v_t.reason IS DISTINCT FROM 'CONFIDENCE_ABSTAIN'
      OR v_t.input_valid IS DISTINCT FROM 'true'
      OR (v_t.webhook_status IS NOT NULL
          AND upper(v_t.webhook_status) NOT IN ('SKIPPED', 'SUPPRESSED', 'NONE'))
      OR EXISTS (SELECT 1 FROM public.c85_outbox o
                 WHERE o.target_id = v_t.id
                   AND upper(COALESCE(o.state, '')) NOT IN ('CANCELLED', 'CANCELED'));
    IF v_blocked THEN
      RETURN jsonb_build_object(
        'committed', false, 'excluded', true, 'reason', 'V1_LEG_NOT_EXCLUSIVE',
        'last_processed_ts', v_prev, 'state_version', v_state.state_version);
    END IF;
  END IF;

  INSERT INTO public.v11_scores (target_ts, ticker, head_date, probability, confidence,
    rank, rank_history, availability, admission_gate, valid, reason, run_mode,
    event_cutoff_offset_ms, inputs_persisted_offset_ms, decision_offset_ms)
  SELECT p_target_ts,
    p_score->>'ticker', (p_score->>'head_date')::date,
    (p_score->>'probability')::double precision,
    (p_score->>'confidence')::double precision,
    (p_score->>'rank')::double precision,
    COALESCE((p_score->>'rank_history')::int, 0),
    (p_score->>'availability')::double precision,
    (p_score->>'admission_gate')::double precision,
    COALESCE((p_score->>'valid')::boolean, false),
    p_score->>'reason', p_score->>'run_mode',
    (p_score->>'event_cutoff_offset_ms')::int,
    (p_score->>'inputs_persisted_offset_ms')::int,
    (p_score->>'decision_offset_ms')::int
  ON CONFLICT (target_ts) DO NOTHING;
  GET DIAGNOSTICS v_score_w = ROW_COUNT;

  INSERT INTO public.v11_decisions (target_ts, ticker, event_key, leg, side, reason,
    probability, rank, admission_gate, head_date, v1_status, v1_reason, v1_final_side,
    v1_floor_open, v1_send_claim, strategy, dispatch_enabled, run_mode, evidence,
    event_cutoff_offset_ms, inputs_persisted_offset_ms, decision_offset_ms,
    publication_ceiling_ms, within_publication_ceiling)
  SELECT p_target_ts,
    p_decision->>'ticker', p_decision->>'event_key', p_decision->>'leg',
    COALESCE((p_decision->>'side')::smallint, 0), p_decision->>'reason',
    (p_decision->>'probability')::double precision,
    (p_decision->>'rank')::double precision,
    (p_decision->>'admission_gate')::double precision,
    (p_decision->>'head_date')::date,
    p_decision->>'v1_status', p_decision->>'v1_reason',
    (p_decision->>'v1_final_side')::smallint,
    (p_decision->>'v1_floor_open')::boolean,
    p_decision->>'v1_send_claim',
    COALESCE(p_decision->'strategy', '{}'::jsonb),
    false,
    p_decision->>'run_mode',
    COALESCE(p_decision->'evidence', '{}'::jsonb),
    (p_decision->>'event_cutoff_offset_ms')::int,
    (p_decision->>'inputs_persisted_offset_ms')::int,
    (p_decision->>'decision_offset_ms')::int,
    (p_decision->>'publication_ceiling_ms')::int,
    (p_decision->>'within_publication_ceiling')::boolean
  ON CONFLICT (target_ts) DO NOTHING;
  GET DIAGNOSTICS v_dec_w = ROW_COUNT;

  UPDATE public.v11_state
  SET last_processed_ts = GREATEST(COALESCE(last_processed_ts, '-infinity'::timestamptz), p_target_ts),
      state_version = state_version + 1,
      updated_at = now()
  WHERE state_key = 'v11-shadow'
  RETURNING * INTO v_state;

  RETURN jsonb_build_object(
    'committed', true, 'duplicate', false,
    'repaired', (v_score_exists OR v_dec_exists),
    'score_written', v_score_w, 'decision_written', v_dec_w,
    'last_processed_ts', v_state.last_processed_ts,
    'state_version', v_state.state_version);
END;
$$;

REVOKE ALL ON FUNCTION public.v11_commit_observation(timestamptz, jsonb, jsonb, timestamptz, bigint, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v11_commit_observation(timestamptz, jsonb, jsonb, timestamptz, bigint, boolean) TO service_role;