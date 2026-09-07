CREATE OR REPLACE FUNCTION public.c85_commit_decision(p_target jsonb, p_checkpoint jsonb DEFAULT NULL::jsonb, p_outbox jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_model text := p_target->>'model_version';
  v_ticker text := p_target->>'ticker';
  v_open timestamptz := (p_target->>'target_open_utc')::timestamptz;
  v_existing public.c85_targets%ROWTYPE;
  v_new public.c85_targets%ROWTYPE;
  v_id uuid;
  v_created boolean := false;
  v_checkpoint jsonb := NULL;
  v_outbox_state text := NULL;
BEGIN
  IF v_model IS NULL OR v_ticker IS NULL OR v_open IS NULL THEN
    RAISE EXCEPTION 'target identity required';
  END IF;

  PERFORM 1 FROM jsonb_object_keys(p_target) k
   WHERE k NOT IN (
     SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='c85_targets'
   );
  IF FOUND THEN
    RAISE EXCEPTION 'unknown c85_targets column in payload';
  END IF;

  v_new := jsonb_populate_record(NULL::public.c85_targets, p_target);

  SELECT * INTO v_existing FROM public.c85_targets
   WHERE model_version = v_model AND ticker = v_ticker AND target_open_utc = v_open
   FOR UPDATE;

  IF FOUND THEN
    v_id := v_existing.id;
    IF v_existing.published_at IS NOT NULL AND v_existing.run_mode = 'LIVE'
       AND (v_new.final_side IS DISTINCT FROM v_existing.final_side
            OR v_new.probability_yes IS DISTINCT FROM v_existing.probability_yes) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'immutable_published_decision',
                                'target_id', v_id);
    END IF;
    v_new.id := v_id;
    v_new.created_at := v_existing.created_at;
    v_new.published_at := COALESCE(v_new.published_at, v_existing.published_at);
    UPDATE public.c85_targets SET
      deadline_utc = COALESCE(v_new.deadline_utc, deadline_utc),
      run_mode = COALESCE(v_new.run_mode, run_mode),
      status = COALESCE(v_new.status, status),
      status_reason = v_new.status_reason,
      binance_complete = v_new.binance_complete,
      anchor_valid = v_new.anchor_valid,
      cm_valid = v_new.cm_valid,
      auxiliary_valid = v_new.auxiliary_valid,
      source_ok = v_new.source_ok,
      core_valid = v_new.core_valid,
      structure_valid = v_new.structure_valid,
      market_q1 = v_new.market_q1,
      probability_yes = v_new.probability_yes,
      proposal = v_new.proposal,
      probability_correct = v_new.probability_correct,
      aux_long_logit = v_new.aux_long_logit,
      aux_long_logscale = v_new.aux_long_logscale,
      aux_recent_logit = v_new.aux_recent_logit,
      aux_recent_logscale = v_new.aux_recent_logscale,
      admission_rank = v_new.admission_rank,
      admission_rank_count = v_new.admission_rank_count,
      filter_rank = v_new.filter_rank,
      filter_rank_count = v_new.filter_rank_count,
      core_side = v_new.core_side,
      extension = v_new.extension,
      last_yes_price = v_new.last_yes_price,
      base_side = v_new.base_side,
      weak = v_new.weak,
      deterioration_ewma16 = v_new.deterioration_ewma16,
      deterioration_ewma128 = v_new.deterioration_ewma128,
      deterioration_settled_count = v_new.deterioration_settled_count,
      deterioration_warmup = v_new.deterioration_warmup,
      final_side = COALESCE(v_new.final_side, final_side),
      gate_reasons = COALESCE(v_new.gate_reasons, gate_reasons),
      consumed_state_cutoff_ns = v_new.consumed_state_cutoff_ns,
      direction_fit_id = v_new.direction_fit_id,
      meta_fit_id = v_new.meta_fit_id,
      aux_fit_month = v_new.aux_fit_month,
      feature_order_sha256 = v_new.feature_order_sha256,
      features = COALESCE(v_new.features, features),
      source_ids = v_new.source_ids,
      source_hash = v_new.source_hash,
      target_open_ns = v_new.target_open_ns,
      packet_freeze_ns = v_new.packet_freeze_ns,
      last_event_ns = v_new.last_event_ns,
      last_receipt_ns = v_new.last_receipt_ns,
      feed_watermarks = v_new.feed_watermarks,
      compute_started_ns = v_new.compute_started_ns,
      compute_complete_ns = v_new.compute_complete_ns,
      decision_durable_ns = v_new.decision_durable_ns,
      dispatch_ns = v_new.dispatch_ns,
      publication_offset_ms = v_new.publication_offset_ms,
      deadline_met = v_new.deadline_met,
      published_at = v_new.published_at
    WHERE id = v_id;
  ELSE
    v_new.id := gen_random_uuid();
    v_new.model_version := v_model;
    v_new.ticker := v_ticker;
    v_new.target_open_utc := v_open;
    v_new.deadline_utc := COALESCE(v_new.deadline_utc, v_open + interval '5 seconds');
    v_new.run_mode := COALESCE(v_new.run_mode, 'LIVE');
    v_new.status := COALESCE(v_new.status, 'UNKNOWN');
    v_new.final_side := COALESCE(v_new.final_side, 0);
    v_new.gate_reasons := COALESCE(v_new.gate_reasons, '[]'::jsonb);
    v_new.webhook_attempts := COALESCE(v_new.webhook_attempts, 0);
    v_new.executed := COALESCE(v_new.executed, false);
    v_new.created_at := COALESCE(v_new.created_at, now());
    v_new.updated_at := COALESCE(v_new.updated_at, now());
    INSERT INTO public.c85_targets VALUES (v_new.*);
    v_id := v_new.id;
    v_created := true;
  END IF;

  IF p_checkpoint IS NOT NULL AND p_checkpoint <> 'null'::jsonb THEN
    v_checkpoint := public.c85_append_checkpoint(p_checkpoint);
  END IF;

  IF p_outbox IS NOT NULL AND p_outbox <> 'null'::jsonb THEN
    INSERT INTO public.c85_outbox (dedupe_key, target_id, payload, state, expires_at)
    VALUES (p_outbox->>'dedupe_key', v_id, COALESCE(p_outbox->'payload','{}'::jsonb),
            'PENDING',
            COALESCE((p_outbox->>'expires_at')::timestamptz, now() + interval '5 seconds'))
    ON CONFLICT (dedupe_key) DO NOTHING;
    SELECT state INTO v_outbox_state FROM public.c85_outbox
     WHERE dedupe_key = p_outbox->>'dedupe_key';
  END IF;

  RETURN jsonb_build_object('ok', true, 'target_id', v_id, 'created', v_created,
                            'checkpoint', v_checkpoint, 'outbox_state', v_outbox_state);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.c85_commit_decision(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.c85_commit_decision(jsonb, jsonb, jsonb) TO service_role;