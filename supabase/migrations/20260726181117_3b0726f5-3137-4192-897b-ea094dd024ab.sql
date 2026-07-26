
-- ============================================================
-- 1. Selector B Confirmation V1 → shadow-only mode column
-- ============================================================
ALTER TABLE public.model7_aas96_shadow
  ADD COLUMN IF NOT EXISTS selector_b_confirmation_v1_mode TEXT;

-- ============================================================
-- 2. TD1 incumbent/candidate promotion — fit lifecycle
-- ============================================================
ALTER TABLE public.model7_td1_fits
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS incumbent_fit_id TEXT,
  ADD COLUMN IF NOT EXISTS forward_review_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS forward_review_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS forward_review_resolved_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_decision TEXT,
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS review_report JSONB,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

-- Historical rows: rows previously flagged active keep status='active';
-- rows previously inactive become 'superseded' (retired).
UPDATE public.model7_td1_fits
   SET status = CASE WHEN active THEN 'active' ELSE 'superseded' END
 WHERE status IS NULL OR status = 'active' AND NOT active;

-- Allowed status vocabulary.
ALTER TABLE public.model7_td1_fits
  DROP CONSTRAINT IF EXISTS model7_td1_fits_status_check;
ALTER TABLE public.model7_td1_fits
  ADD CONSTRAINT model7_td1_fits_status_check
  CHECK (status IN ('training','pending_forward_review','active','rejected','superseded'));

-- Only one candidate under review per base_variant.
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_td1_candidate_per_variant
  ON public.model7_td1_fits (base_variant) WHERE status = 'pending_forward_review';

-- Extend TD1 shadow rows with incumbent/candidate audit columns.
ALTER TABLE public.model7_td1_rc_shadow
  ADD COLUMN IF NOT EXISTS td1_incumbent_fit_id TEXT,
  ADD COLUMN IF NOT EXISTS td1_incumbent_loss_probability DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS td1_incumbent_veto_fired BOOLEAN,
  ADD COLUMN IF NOT EXISTS td1_incumbent_final_decision TEXT,
  ADD COLUMN IF NOT EXISTS td1_incumbent_would_win BOOLEAN,
  ADD COLUMN IF NOT EXISTS td1_incumbent_would_lose BOOLEAN,
  ADD COLUMN IF NOT EXISTS td1_incumbent_net_score INTEGER,
  ADD COLUMN IF NOT EXISTS td1_incumbent_tree_leaf_id TEXT,
  ADD COLUMN IF NOT EXISTS td1_incumbent_tree_path TEXT,
  ADD COLUMN IF NOT EXISTS td1_incumbent_leaf_training_sample_count INTEGER,
  ADD COLUMN IF NOT EXISTS td1_incumbent_leaf_training_loss_count INTEGER,
  ADD COLUMN IF NOT EXISTS td1_incumbent_leaf_training_loss_rate DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS td1_candidate_fit_id TEXT,
  ADD COLUMN IF NOT EXISTS td1_candidate_loss_probability DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS td1_candidate_veto_fired BOOLEAN,
  ADD COLUMN IF NOT EXISTS td1_candidate_final_decision TEXT,
  ADD COLUMN IF NOT EXISTS td1_candidate_would_win BOOLEAN,
  ADD COLUMN IF NOT EXISTS td1_candidate_would_lose BOOLEAN,
  ADD COLUMN IF NOT EXISTS td1_candidate_net_score INTEGER,
  ADD COLUMN IF NOT EXISTS td1_candidate_evaluable BOOLEAN,
  ADD COLUMN IF NOT EXISTS td1_candidate_shadow_only BOOLEAN,
  ADD COLUMN IF NOT EXISTS td1_candidate_net_effect_vs_incumbent INTEGER,
  ADD COLUMN IF NOT EXISTS td1_candidate_tree_leaf_id TEXT,
  ADD COLUMN IF NOT EXISTS td1_candidate_tree_path TEXT,
  ADD COLUMN IF NOT EXISTS td1_candidate_leaf_training_sample_count INTEGER,
  ADD COLUMN IF NOT EXISTS td1_candidate_leaf_training_loss_count INTEGER,
  ADD COLUMN IF NOT EXISTS td1_candidate_leaf_training_loss_rate DOUBLE PRECISION;

-- Promote candidate RPC.
CREATE OR REPLACE FUNCTION public.promote_td1_candidate(
  p_candidate_fit_id TEXT,
  p_expected_incumbent_fit_id TEXT,
  p_report JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_variant TEXT;
  v_current_active TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('td1_fit_promote'));

  SELECT base_variant INTO v_variant
    FROM public.model7_td1_fits
   WHERE fit_id = p_candidate_fit_id AND status = 'pending_forward_review'
   FOR UPDATE;
  IF v_variant IS NULL THEN
    RAISE EXCEPTION 'candidate % is not pending_forward_review', p_candidate_fit_id;
  END IF;

  SELECT fit_id INTO v_current_active
    FROM public.model7_td1_fits
   WHERE base_variant = v_variant AND status = 'active'
   FOR UPDATE;
  IF v_current_active IS DISTINCT FROM p_expected_incumbent_fit_id THEN
    RAISE EXCEPTION 'incumbent mismatch: expected %, got %', p_expected_incumbent_fit_id, v_current_active;
  END IF;

  IF v_current_active IS NOT NULL THEN
    UPDATE public.model7_td1_fits
       SET status = 'superseded', active = false
     WHERE fit_id = v_current_active;
  END IF;

  UPDATE public.model7_td1_fits
     SET status = 'active',
         active = true,
         activated_at = now(),
         review_decision = 'promote',
         forward_review_completed_at = now(),
         review_report = p_report,
         promoted_at = COALESCE(promoted_at, now())
   WHERE fit_id = p_candidate_fit_id;

  RETURN jsonb_build_object('ok', true, 'promoted_fit_id', p_candidate_fit_id, 'retired_fit_id', v_current_active);
END;
$$;

-- Reject candidate RPC.
CREATE OR REPLACE FUNCTION public.reject_td1_candidate(
  p_candidate_fit_id TEXT,
  p_reason TEXT,
  p_report JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.model7_td1_fits
     WHERE fit_id = p_candidate_fit_id AND status = 'pending_forward_review'
  ) THEN
    RAISE EXCEPTION 'candidate % is not pending_forward_review', p_candidate_fit_id;
  END IF;

  UPDATE public.model7_td1_fits
     SET status = 'rejected',
         active = false,
         rejected_at = now(),
         review_decision = 'reject',
         review_reason = p_reason,
         review_report = p_report,
         forward_review_completed_at = now()
   WHERE fit_id = p_candidate_fit_id;

  RETURN jsonb_build_object('ok', true, 'rejected_fit_id', p_candidate_fit_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_td1_candidate(TEXT, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_td1_candidate(TEXT, TEXT, JSONB) TO authenticated, service_role;

-- ============================================================
-- 3. AAS96 Layer B history bound to original fit
-- ============================================================
CREATE TABLE IF NOT EXISTS public.model7_aas96_layer_b_history_episodes (
  history_episode_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_fit_id    TEXT NOT NULL UNIQUE,
  is_active          BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_count     INTEGER NOT NULL DEFAULT 0,
  history_payload    JSONB NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT ON public.model7_aas96_layer_b_history_episodes TO authenticated, anon;
GRANT ALL ON public.model7_aas96_layer_b_history_episodes TO service_role;

ALTER TABLE public.model7_aas96_layer_b_history_episodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aas96_layer_b_episodes_read_public" ON public.model7_aas96_layer_b_history_episodes;
CREATE POLICY "aas96_layer_b_episodes_read_public"
  ON public.model7_aas96_layer_b_history_episodes
  FOR SELECT TO anon, authenticated USING (true);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_aas96_layer_b_episode
  ON public.model7_aas96_layer_b_history_episodes (is_active) WHERE is_active;

-- Extend AAS96 shadow rows with episode ownership + application audit.
ALTER TABLE public.model7_aas96_shadow
  ADD COLUMN IF NOT EXISTS artifact_fit_id_at_prediction TEXT,
  ADD COLUMN IF NOT EXISTS layer_b_history_episode_id UUID,
  ADD COLUMN IF NOT EXISTS layer_b_history_applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS layer_b_history_application_status TEXT,
  ADD COLUMN IF NOT EXISTS layer_b_history_application_error TEXT,
  ADD COLUMN IF NOT EXISTS history_episode_ownership_unverified BOOLEAN NOT NULL DEFAULT true;

-- Get-or-mint episode for a given artifact fit id.
CREATE OR REPLACE FUNCTION public.get_or_mint_aas96_layer_b_episode(p_artifact_fit_id TEXT)
RETURNS SETOF public.model7_aas96_layer_b_history_episodes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing public.model7_aas96_layer_b_history_episodes%ROWTYPE;
  v_new_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('aas96_layer_b_episode', 0));

  SELECT * INTO v_existing
    FROM public.model7_aas96_layer_b_history_episodes
   WHERE artifact_fit_id = p_artifact_fit_id
   FOR UPDATE;
  IF FOUND THEN
    IF NOT v_existing.is_active THEN
      UPDATE public.model7_aas96_layer_b_history_episodes
         SET is_active = false
       WHERE is_active = true AND artifact_fit_id <> p_artifact_fit_id;
      UPDATE public.model7_aas96_layer_b_history_episodes
         SET is_active = true, updated_at = now()
       WHERE history_episode_id = v_existing.history_episode_id;
    END IF;
    RETURN QUERY SELECT * FROM public.model7_aas96_layer_b_history_episodes
      WHERE history_episode_id = v_existing.history_episode_id;
    RETURN;
  END IF;

  UPDATE public.model7_aas96_layer_b_history_episodes
     SET is_active = false
   WHERE is_active = true;

  v_new_id := gen_random_uuid();
  INSERT INTO public.model7_aas96_layer_b_history_episodes
    (history_episode_id, artifact_fit_id, is_active, resolved_count, history_payload)
  VALUES (v_new_id, p_artifact_fit_id, true, 0, '{}'::jsonb);
  RETURN QUERY SELECT * FROM public.model7_aas96_layer_b_history_episodes
    WHERE history_episode_id = v_new_id;
END;
$$;

-- Apply history update atomically & idempotently.
CREATE OR REPLACE FUNCTION public.apply_aas96_layer_b_history(
  p_prediction_id UUID,
  p_history_episode_id UUID,
  p_actual_direction TEXT,
  p_new_history_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row_id UUID;
  v_row_episode UUID;
  v_resolved BOOLEAN;
  v_already TIMESTAMPTZ;
BEGIN
  IF p_actual_direction NOT IN ('GREEN','RED') THEN
    RAISE EXCEPTION 'invalid actual_direction %', p_actual_direction;
  END IF;

  SELECT id, layer_b_history_episode_id,
         (status = 'resolved'), layer_b_history_applied_at
    INTO v_row_id, v_row_episode, v_resolved, v_already
    FROM public.model7_aas96_shadow
   WHERE prediction_id = p_prediction_id
   FOR UPDATE;
  IF v_row_id IS NULL THEN
    RAISE EXCEPTION 'aas96 shadow row not found for prediction %', p_prediction_id;
  END IF;
  IF v_row_episode IS DISTINCT FROM p_history_episode_id THEN
    RAISE EXCEPTION 'prediction % does not belong to episode %', p_prediction_id, p_history_episode_id;
  END IF;
  IF NOT v_resolved THEN
    RAISE EXCEPTION 'prediction % not resolved', p_prediction_id;
  END IF;
  IF v_already IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  UPDATE public.model7_aas96_layer_b_history_episodes
     SET history_payload = p_new_history_payload,
         resolved_count = resolved_count + 1,
         updated_at = now()
   WHERE history_episode_id = p_history_episode_id;

  UPDATE public.model7_aas96_shadow
     SET layer_b_history_applied_at = now(),
         layer_b_history_application_status = 'applied',
         layer_b_history_application_error = NULL,
         updated_at = now()
   WHERE id = v_row_id;

  RETURN jsonb_build_object('ok', true, 'idempotent', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_mint_aas96_layer_b_episode(TEXT) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.apply_aas96_layer_b_history(UUID, UUID, TEXT, JSONB) TO authenticated, service_role;
