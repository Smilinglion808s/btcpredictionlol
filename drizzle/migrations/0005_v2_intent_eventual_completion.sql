-- Eventual dependency completion for the single candle intent.
-- Transport is at-least-once and rows can arrive out of order: a T+45 row may reach the
-- site before its T+8 abstention. Every insert AND every retry now re-resolves the candle's
-- one intent from all stored rows, so a late-arriving valid T+8 abstention completes a
-- previously stored eligible T+45 exactly one time. A failed / missing / late T+8 audit
-- still never qualifies. SECURITY INVOKER (service_role only) with empty search_path.
CREATE OR REPLACE FUNCTION public.v2_record_checkpoint(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_open timestamptz := (p->>'candle_open')::timestamptz;
  v_cp text := p->>'checkpoint';
  v_sleeve text := p->>'sleeve';
  v_side smallint := (p->>'side')::smallint;
  v_prob double precision := (p->>'probability')::double precision;
  v_elig boolean := (p->>'eligible')::boolean;
  v_ready boolean := (p->>'features_ready')::boolean;
  v_reason text := p->>'reason';
  v_dec timestamptz := (p->>'decision_at')::timestamptz;
  v_payload jsonb := coalesce(p->'payload','{}'::pg_catalog.jsonb);
  v_order text[] := ARRAY['v2-direction8-r1','v2-fade8-r1','v2-direction45-r1'];
  v_sec int;
  r public.v2_checkpoints;
  v_dup boolean := false;
  v_t8_ok boolean;
  v_best public.v2_checkpoints;
  v_intent public.v2_candle_intents;
  v_note text := null;
BEGIN
  IF v_sleeve NOT IN ('v2-direction8-r1','v2-fade8-r1','v2-direction45-r1') THEN RAISE EXCEPTION 'UNKNOWN_SLEEVE'; END IF;
  v_sec := CASE WHEN v_cp = 'T8' THEN 8 WHEN v_cp = 'T45' THEN 45 ELSE NULL END;
  IF v_sec IS NULL OR (v_sleeve = 'v2-direction45-r1') <> (v_cp = 'T45') THEN RAISE EXCEPTION 'CHECKPOINT_SLEEVE_MISMATCH'; END IF;
  IF v_elig AND NOT (v_dec >= v_open + pg_catalog.make_interval(secs => v_sec) AND v_dec < v_open + pg_catalog.make_interval(secs => v_sec + 1)
                     AND v_ready AND v_side IN (-1,1)) THEN
    RAISE EXCEPTION 'ELIGIBLE_OUTSIDE_WINDOW';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('v2:' || v_open::text, 0));

  SELECT * INTO r FROM public.v2_checkpoints WHERE candle_open = v_open AND checkpoint = v_cp AND sleeve = v_sleeve;
  IF FOUND THEN
    IF r.side IS DISTINCT FROM v_side OR r.probability IS DISTINCT FROM v_prob OR r.eligible <> v_elig
       OR r.features_ready <> v_ready OR r.reason IS DISTINCT FROM v_reason OR r.decision_at <> v_dec
       OR r.payload <> v_payload THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'CONFLICTING_DUPLICATE', 'id', r.id);
    END IF;
    v_dup := true;
  ELSE
    INSERT INTO public.v2_checkpoints(model_version, candle_open, checkpoint, sleeve, side, probability, eligible,
      features_ready, reason, input_source, label_source, decision_at, receipt_latency_ms, worker_id, payload)
    VALUES ('v2-final-r1', v_open, v_cp, v_sleeve, v_side, v_prob, v_elig, v_ready, v_reason,
      p->>'input_source', p->>'label_source', v_dec, (p->>'receipt_latency_ms')::int, p->>'worker_id', v_payload)
    RETURNING * INTO r;
  END IF;

  -- Does the candle hold an actually scored frozen T+8 ABSTAIN? (mirrors DecisionStore: T45 needs
  -- checkpoint==8, called=0). Failed / missing / late / unready T+8 audits never qualify.
  v_t8_ok := EXISTS (SELECT 1 FROM public.v2_checkpoints c WHERE c.candle_open = v_open AND c.checkpoint = 'T8'
                       AND NOT c.eligible AND c.features_ready AND c.reason IS NULL AND c.side = 0
                       AND c.payload->>'sleeve_name' = 'ABSTAIN'
                       AND c.decision_at >= v_open + pg_catalog.make_interval(secs => 8)
                       AND c.decision_at <  v_open + pg_catalog.make_interval(secs => 9));

  -- Re-resolve the single intent from every stored row of this candle, on inserts and retries alike.
  SELECT * INTO v_best FROM public.v2_checkpoints c
    WHERE c.candle_open = v_open AND c.eligible
      AND (c.checkpoint <> 'T45' OR (v_t8_ok AND NOT EXISTS (
            SELECT 1 FROM public.v2_checkpoints e WHERE e.candle_open = v_open AND e.checkpoint = 'T8' AND e.eligible)))
    ORDER BY pg_catalog.array_position(v_order, c.sleeve), c.decision_at, c.id
    LIMIT 1;
  IF v_best.id IS NOT NULL THEN
    INSERT INTO public.v2_candle_intents(candle_open, model_version, sleeve, checkpoint_id, side, execution, stake_policy)
    VALUES (v_open, 'v2-final-r1', v_best.sleeve, v_best.id, v_best.side, 'OFF', coalesce(p->'stake_policy','{}'::pg_catalog.jsonb))
    ON CONFLICT (candle_open) DO NOTHING;
  END IF;

  IF r.eligible AND (v_best.id IS NULL OR v_best.id <> r.id) THEN
    v_note := CASE WHEN r.checkpoint = 'T45' AND v_best.id IS NULL THEN 'T8_ABSTENTION_NOT_PERSISTED'
                   ELSE 'HIGHER_PRIORITY_ELIGIBLE' END;
  END IF;

  SELECT * INTO v_intent FROM public.v2_candle_intents WHERE candle_open = v_open;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'id', r.id, 'duplicate', v_dup, 'intent_note', v_note,
    'receipt_latency_ms', r.receipt_latency_ms,
    'intent', CASE WHEN v_intent.candle_open IS NULL THEN NULL ELSE
      pg_catalog.jsonb_build_object('sleeve', v_intent.sleeve, 'checkpoint_id', v_intent.checkpoint_id, 'side', v_intent.side, 'execution', v_intent.execution) END);
END $$;
REVOKE ALL ON FUNCTION public.v2_record_checkpoint(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2_record_checkpoint(jsonb) TO service_role;
