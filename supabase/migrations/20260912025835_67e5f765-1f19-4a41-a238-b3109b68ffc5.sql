ALTER TABLE public.v11_context_rows
  ADD COLUMN IF NOT EXISTS settlement_ts_source text,
  ADD COLUMN IF NOT EXISTS settlement_known_at timestamptz;

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
  v_req_mode     text;
  v_mode         text;
  v_ceiling      int;
  v_commit_ms    bigint;
  v_within       boolean;
  v_downgraded   boolean := false;
  v_mode_ok      boolean;
  v_evidence     jsonb;
BEGIN
  IF p_target_ts IS NULL THEN
    RAISE EXCEPTION 'v11_commit_observation: target_ts required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('v11-shadow-commit'));

  SELECT * INTO v_state FROM public.v11_state WHERE state_key = 'v11-shadow' FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.v11_state (state_key) VALUES ('v11-shadow')
    RETURNING * INTO v_state;
  END IF;
  v_prev := v_state.last_processed_ts;

  SELECT EXISTS (SELECT 1 FROM public.v11_scores    WHERE target_ts = p_target_ts) INTO v_score_exists;
  SELECT EXISTS (SELECT 1 FROM public.v11_decisions WHERE target_ts = p_target_ts) INTO v_dec_exists;

  IF v_score_exists AND v_dec_exists THEN
    RETURN jsonb_build_object(
      'committed', false, 'duplicate', true, 'repaired', false,
      'score_written', false, 'decision_written', false,
      'last_processed_ts', v_state.last_processed_ts,
      'state_version', v_state.state_version);
  END IF;

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

  -- Truthful publication timing: the only honest clock is the one at the final
  -- transaction boundary, so it is taken HERE with clock_timestamp() (not the
  -- transaction-start now()) and the caller's pre-commit stamp cannot smuggle a
  -- late row in as LIVE_SHADOW.
  v_req_mode  := COALESCE(p_decision->>'run_mode', 'RESEARCH');
  v_ceiling   := COALESCE((p_decision->>'publication_ceiling_ms')::int, 60000);
  v_commit_ms := floor(extract(epoch FROM (clock_timestamp() - p_target_ts)) * 1000)::bigint;
  v_within    := v_commit_ms <= v_ceiling;
  v_mode      := v_req_mode;
  IF v_mode = 'LIVE_SHADOW' AND NOT v_within THEN
    v_mode := 'RECOVERY';
    v_downgraded := true;
  END IF;

  v_evidence := COALESCE(p_decision->'evidence', '{}'::jsonb) || jsonb_build_object(
    'run_mode', v_mode,
    'requested_run_mode', v_req_mode,
    'commit_offset_ms', v_commit_ms,
    'commit_clock', clock_timestamp(),
    'within_publication_ceiling', v_within,
    'downgraded_by', CASE WHEN v_downgraded THEN 'V11_ABSTAIN_LATE_PUBLICATION'
                          ELSE p_decision->'evidence'->>'downgraded_by' END);

  -- Cross-leg exclusion re-verified INSIDE the transaction. A fallback call is
  -- only admissible when the frozen V1 leg stood down with the floor open and
  -- holds NO send claim of any kind (any outbox row, whatever its state,
  -- excludes conservatively).
  v_side := COALESCE((p_decision->>'side')::int, 0);
  v_leg  := p_decision->>'leg';
  IF v_side <> 0 AND v_leg = 'T45R2' THEN
    SELECT t.id, t.final_side, t.webhook_status, t.run_mode,
           (t.features->'lite_a'->>'reason') AS reason,
           ((t.features->'input_valid') = 'true'::jsonb) AS input_valid,
           ((t.features->'daily_floor'->'ordinary_floor_allows') = 'true'::jsonb) AS floor_open
      INTO v_t
    FROM public.c85_targets t
    WHERE t.model_version = 'lite-a-floor4-top10-r1'
      AND t.target_open_utc = p_target_ts
    FOR SHARE;

    -- V1 and V11 use DIFFERENT mode vocabularies ('LIVE' vs 'LIVE_SHADOW'):
    -- map them explicitly. A live shadow leg requires a live V1 origin; a
    -- recovery/research observation keeps its own non-live classification but
    -- must still name a known frozen V1 origin. Unknown/absent origin blocks.
    v_mode_ok := CASE
      WHEN v_t IS NULL OR v_t.run_mode IS NULL THEN false
      WHEN v_mode = 'LIVE_SHADOW' THEN v_t.run_mode = 'LIVE'
      WHEN v_mode IN ('RECOVERY', 'RESEARCH') THEN v_t.run_mode IN ('LIVE', 'RESEARCH')
      ELSE false
    END;

    v_blocked := (v_t IS NULL)
      OR COALESCE(v_t.final_side, 1) <> 0
      OR v_t.reason IS DISTINCT FROM 'CONFIDENCE_ABSTAIN'
      OR v_t.input_valid IS NOT TRUE
      OR v_t.floor_open IS NOT TRUE
      OR NOT v_mode_ok
      OR (v_t.webhook_status IS NOT NULL
          AND upper(v_t.webhook_status) NOT IN ('SKIPPED', 'SUPPRESSED', 'NONE'))
      OR EXISTS (SELECT 1 FROM public.c85_outbox o
                 WHERE o.target_id = v_t.id);
    IF v_blocked THEN
      RETURN jsonb_build_object(
        'committed', false, 'excluded', true, 'reason', 'V1_LEG_NOT_EXCLUSIVE',
        'effective_run_mode', v_mode,
        'commit_offset_ms', v_commit_ms,
        'within_publication_ceiling', v_within,
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
    p_score->>'reason', v_mode,
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
    v_mode,
    v_evidence,
    (p_decision->>'event_cutoff_offset_ms')::int,
    (p_decision->>'inputs_persisted_offset_ms')::int,
    (p_decision->>'decision_offset_ms')::int,
    v_ceiling,
    v_within
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
    'effective_run_mode', v_mode,
    'requested_run_mode', v_req_mode,
    'commit_offset_ms', v_commit_ms,
    'within_publication_ceiling', v_within,
    'last_processed_ts', v_state.last_processed_ts,
    'state_version', v_state.state_version);
END;
$$;

REVOKE ALL ON FUNCTION public.v11_commit_observation(timestamptz, jsonb, jsonb, timestamptz, bigint, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v11_commit_observation(timestamptz, jsonb, jsonb, timestamptz, bigint, boolean) TO service_role;