ALTER TABLE public.v11_scores
  ADD COLUMN IF NOT EXISTS run_mode text NOT NULL DEFAULT 'RESEARCH',
  ADD COLUMN IF NOT EXISTS event_cutoff_offset_ms integer,
  ADD COLUMN IF NOT EXISTS inputs_persisted_offset_ms integer,
  ADD COLUMN IF NOT EXISTS decision_offset_ms integer;

ALTER TABLE public.v11_decisions
  ADD COLUMN IF NOT EXISTS run_mode text NOT NULL DEFAULT 'RESEARCH',
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.v11_heads
  ADD COLUMN IF NOT EXISTS feature_order_hash text,
  ADD COLUMN IF NOT EXISTS config_fingerprint text,
  ADD COLUMN IF NOT EXISTS cutoff_ts timestamptz,
  ADD COLUMN IF NOT EXISTS max_training_settlement_ts timestamptz,
  ADD COLUMN IF NOT EXISTS vector_fingerprint text,
  ADD COLUMN IF NOT EXISTS quarantined boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quarantine_reason text;

-- Heads whose UTC cutoff had not yet arrived when they were fitted can never be
-- honest: they were trained without data that will exist by their serving day.
UPDATE public.v11_heads
   SET quarantined = true,
       quarantine_reason = 'FITTED_BEFORE_CUTOFF'
 WHERE fit_date > (now() AT TIME ZONE 'utc')::date
   AND quarantined = false;

-- Never let a refresh blank a known outcome.
CREATE OR REPLACE FUNCTION public.v11_preserve_settlement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.label IS NULL THEN NEW.label := OLD.label; END IF;
  IF NEW.settlement_ts IS NULL THEN NEW.settlement_ts := OLD.settlement_ts; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS v11_context_preserve_settlement ON public.v11_context_rows;
CREATE TRIGGER v11_context_preserve_settlement
  BEFORE UPDATE ON public.v11_context_rows
  FOR EACH ROW EXECUTE FUNCTION public.v11_preserve_settlement();

DROP TRIGGER IF EXISTS v11_vectors_preserve_settlement ON public.v11_vectors;
CREATE TRIGGER v11_vectors_preserve_settlement
  BEFORE UPDATE ON public.v11_vectors
  FOR EACH ROW EXECUTE FUNCTION public.v11_preserve_settlement();

-- Atomic ordered commit: score + decision + checkpoint in ONE transaction.
-- Serialised per interval by an advisory lock; the checkpoint never regresses.
CREATE OR REPLACE FUNCTION public.v11_commit_observation(
  p_target_ts timestamptz,
  p_score jsonb,
  p_decision jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  VALUES ('default', p_target_ts)
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
$$;

REVOKE ALL ON FUNCTION public.v11_commit_observation(timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v11_commit_observation(timestamptz, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.v11_preserve_settlement() FROM PUBLIC, anon, authenticated;