-- 1. Replay protection for signed worker requests -----------------------------
CREATE TABLE IF NOT EXISTS public.c85_request_nonces (
  nonce text PRIMARY KEY,
  op text NOT NULL,
  worker_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.c85_request_nonces TO authenticated;
GRANT ALL ON public.c85_request_nonces TO service_role;
ALTER TABLE public.c85_request_nonces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "c85_request_nonces authenticated read"
  ON public.c85_request_nonces FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS c85_request_nonces_created_idx
  ON public.c85_request_nonces (created_at);

-- 2. Scheduler ownership leases -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.c85_scheduler_leases (
  lease_key text PRIMARY KEY,
  owner_id text NOT NULL,
  fence bigint NOT NULL DEFAULT 1,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.c85_scheduler_leases TO authenticated;
GRANT ALL ON public.c85_scheduler_leases TO service_role;
ALTER TABLE public.c85_scheduler_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "c85_scheduler_leases authenticated read"
  ON public.c85_scheduler_leases FOR SELECT TO authenticated USING (true);
CREATE TRIGGER c85_scheduler_leases_set_updated_at
  BEFORE UPDATE ON public.c85_scheduler_leases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- fitted-model records must be idempotent per (version, kind, cutoff)
CREATE UNIQUE INDEX IF NOT EXISTS c85_model_versions_identity_idx
  ON public.c85_model_versions (model_version, kind, training_cutoff_utc);

-- 3. Lease acquisition / renewal ----------------------------------------------
CREATE OR REPLACE FUNCTION public.c85_acquire_lease(
  p_lease_key text, p_owner_id text, p_ttl_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v public.c85_scheduler_leases%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('c85_lease:' || p_lease_key, 0));
  SELECT * INTO v FROM public.c85_scheduler_leases WHERE lease_key = p_lease_key FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.c85_scheduler_leases (lease_key, owner_id, fence, expires_at)
    VALUES (p_lease_key, p_owner_id, 1, now() + make_interval(secs => p_ttl_seconds))
    RETURNING * INTO v;
    RETURN jsonb_build_object('granted', true, 'owner_id', v.owner_id, 'fence', v.fence,
                              'expires_at', v.expires_at);
  END IF;

  IF v.owner_id = p_owner_id THEN
    UPDATE public.c85_scheduler_leases
       SET expires_at = now() + make_interval(secs => p_ttl_seconds)
     WHERE lease_key = p_lease_key RETURNING * INTO v;
    RETURN jsonb_build_object('granted', true, 'renewed', true, 'owner_id', v.owner_id,
                              'fence', v.fence, 'expires_at', v.expires_at);
  END IF;

  IF v.expires_at <= now() THEN
    UPDATE public.c85_scheduler_leases
       SET owner_id = p_owner_id, fence = v.fence + 1, acquired_at = now(),
           expires_at = now() + make_interval(secs => p_ttl_seconds)
     WHERE lease_key = p_lease_key RETURNING * INTO v;
    RETURN jsonb_build_object('granted', true, 'took_over', true, 'owner_id', v.owner_id,
                              'fence', v.fence, 'expires_at', v.expires_at);
  END IF;

  RETURN jsonb_build_object('granted', false, 'owner_id', v.owner_id, 'fence', v.fence,
                            'expires_at', v.expires_at);
END;
$$;

-- 4. Internal helper: append a checkpoint with a parent/sequence check ---------
CREATE OR REPLACE FUNCTION public.c85_append_checkpoint(p_checkpoint jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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
    p_checkpoint->'expert_state',
    p_checkpoint->'applicable_fits',
    p_checkpoint->'source_watermarks',
    p_checkpoint->>'state_sha256',
    v_last.state_sha256
  );

  RETURN jsonb_build_object('checkpoint_seq', v_seq, 'parent_sha256', v_last.state_sha256);
END;
$$;

-- 5. Atomic decision commit ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.c85_commit_decision(
  p_target jsonb, p_checkpoint jsonb DEFAULT NULL, p_outbox jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_model text := p_target->>'model_version';
  v_ticker text := p_target->>'ticker';
  v_open timestamptz := (p_target->>'target_open_utc')::timestamptz;
  v_existing public.c85_targets%ROWTYPE;
  v_id uuid;
  v_created boolean := false;
  v_checkpoint jsonb := NULL;
  v_outbox_state text := NULL;
BEGIN
  IF v_model IS NULL OR v_ticker IS NULL OR v_open IS NULL THEN
    RAISE EXCEPTION 'target identity required';
  END IF;

  SELECT * INTO v_existing FROM public.c85_targets
   WHERE model_version = v_model AND ticker = v_ticker AND target_open_utc = v_open
   FOR UPDATE;

  IF FOUND THEN
    v_id := v_existing.id;
    IF v_existing.published_at IS NOT NULL AND v_existing.run_mode = 'LIVE'
       AND (p_target->>'final_side')::smallint IS DISTINCT FROM v_existing.final_side THEN
      RETURN jsonb_build_object('ok', false, 'error', 'immutable_published_decision',
                                'target_id', v_id);
    END IF;
    UPDATE public.c85_targets SET
      run_mode = COALESCE(p_target->>'run_mode', run_mode),
      status = COALESCE(p_target->>'status', status),
      status_reason = p_target->>'status_reason',
      final_side = COALESCE((p_target->>'final_side')::smallint, final_side),
      deadline_utc = COALESCE((p_target->>'deadline_utc')::timestamptz, deadline_utc),
      features = COALESCE(p_target->'features', features),
      gate_reasons = COALESCE(p_target->'gate_reasons', gate_reasons),
      published_at = COALESCE((p_target->>'published_at')::timestamptz, published_at)
    WHERE id = v_id;
  ELSE
    INSERT INTO public.c85_targets (
      model_version, ticker, target_open_utc, deadline_utc, run_mode, status, status_reason,
      final_side, features, gate_reasons, published_at
    ) VALUES (
      v_model, v_ticker, v_open,
      COALESCE((p_target->>'deadline_utc')::timestamptz, v_open + interval '5 seconds'),
      COALESCE(p_target->>'run_mode','LIVE'),
      COALESCE(p_target->>'status','UNKNOWN'),
      p_target->>'status_reason',
      COALESCE((p_target->>'final_side')::smallint, 0),
      p_target->'features', p_target->'gate_reasons',
      (p_target->>'published_at')::timestamptz
    ) RETURNING id INTO v_id;
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
$$;

-- 6. Exactly-once settlement consumption ---------------------------------------
CREATE OR REPLACE FUNCTION public.c85_consume_settlements(
  p_model_version text, p_settlement_ids uuid[], p_checkpoint jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_consumed uuid[];
  v_checkpoint jsonb := NULL;
BEGIN
  WITH upd AS (
    UPDATE public.c85_settlements
       SET consumed_by_deterioration_at = now()
     WHERE model_version = p_model_version
       AND id = ANY(p_settlement_ids)
       AND consumed_by_deterioration_at IS NULL
    RETURNING id
  ) SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_consumed FROM upd;

  IF p_checkpoint IS NOT NULL AND p_checkpoint <> 'null'::jsonb THEN
    v_checkpoint := public.c85_append_checkpoint(p_checkpoint);
  END IF;

  RETURN jsonb_build_object('ok', true, 'consumed', to_jsonb(v_consumed),
                            'consumed_count', coalesce(array_length(v_consumed,1),0),
                            'checkpoint', v_checkpoint);
END;
$$;