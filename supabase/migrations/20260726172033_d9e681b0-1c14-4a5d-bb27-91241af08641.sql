
-- ============ Fits: review workflow fields ============
ALTER TABLE public.model8_v3_fits
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS review_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS review_decision text,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS prior_active_fit_id text,
  ADD COLUMN IF NOT EXISTS activation_target_candle_ts timestamptz,
  ADD COLUMN IF NOT EXISTS review_report jsonb;

-- Ensure only one active fit at a time.
CREATE UNIQUE INDEX IF NOT EXISTS model8_v3_fits_one_active
  ON public.model8_v3_fits ((1)) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS model8_v3_fits_status_idx
  ON public.model8_v3_fits (status, review_requested_at DESC);

-- ============ Reviews audit table ============
CREATE TABLE IF NOT EXISTS public.model8_v3_fit_reviews (
  review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_fit_id text NOT NULL,
  active_fit_id text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve','reject','continue')),
  notes text,
  report jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.model8_v3_fit_reviews TO authenticated;
GRANT ALL ON public.model8_v3_fit_reviews TO service_role;
ALTER TABLE public.model8_v3_fit_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews_read_auth" ON public.model8_v3_fit_reviews FOR SELECT TO authenticated USING (true);

-- ============ Predictions: regime monitoring fields (monitoring only) ============
ALTER TABLE public.model8_v3_predictions
  ADD COLUMN IF NOT EXISTS atr_14_to_price double precision,
  ADD COLUMN IF NOT EXISTS realized_volatility_8 double precision,
  ADD COLUMN IF NOT EXISTS realized_volatility_32 double precision,
  ADD COLUMN IF NOT EXISTS volatility_ratio_8_32 double precision,
  ADD COLUMN IF NOT EXISTS trend_efficiency_8 double precision,
  ADD COLUMN IF NOT EXISTS trend_efficiency_32 double precision,
  ADD COLUMN IF NOT EXISTS ema9_minus_ema21_to_atr double precision,
  ADD COLUMN IF NOT EXISTS volume_zscore_32 double precision,
  ADD COLUMN IF NOT EXISTS volatility_percentile_256 double precision,
  ADD COLUMN IF NOT EXISTS trend_percentile_256 double precision,
  ADD COLUMN IF NOT EXISTS volume_percentile_256 double precision,
  ADD COLUMN IF NOT EXISTS regime_label text,
  ADD COLUMN IF NOT EXISTS regime_transition_score double precision;

-- ============ RPC: approve/activate candidate ============
CREATE OR REPLACE FUNCTION public.activate_model8_v3_fit(
  p_fit_id text, p_reviewed_by text, p_notes text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prior text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('m8v3_fit_swap'));

  IF NOT EXISTS (SELECT 1 FROM public.model8_v3_fits WHERE fit_id = p_fit_id AND status = 'pending_review') THEN
    RAISE EXCEPTION 'fit % not pending_review', p_fit_id;
  END IF;

  SELECT fit_id INTO v_prior FROM public.model8_v3_fits WHERE status = 'active' LIMIT 1;

  UPDATE public.model8_v3_fits
     SET status = 'retired', reviewed_at = COALESCE(reviewed_at, now())
   WHERE status = 'active';

  UPDATE public.model8_v3_fits
     SET status = 'active',
         activated_at = now(),
         reviewed_at = now(),
         reviewed_by = p_reviewed_by,
         review_decision = 'approve',
         review_notes = p_notes,
         prior_active_fit_id = v_prior
   WHERE fit_id = p_fit_id;

  INSERT INTO public.model8_v3_fit_reviews (candidate_fit_id, active_fit_id, reviewed_by, decision, notes, report)
  SELECT p_fit_id, v_prior, p_reviewed_by, 'approve', p_notes, review_report
    FROM public.model8_v3_fits WHERE fit_id = p_fit_id;

  RETURN jsonb_build_object('ok', true, 'activated_fit_id', p_fit_id, 'retired_fit_id', v_prior);
END;
$$;

-- ============ RPC: reject / continue ============
CREATE OR REPLACE FUNCTION public.reject_model8_v3_fit(
  p_fit_id text, p_reviewed_by text, p_notes text, p_decision text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_active text;
BEGIN
  IF p_decision NOT IN ('reject','continue') THEN
    RAISE EXCEPTION 'invalid decision %', p_decision;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.model8_v3_fits WHERE fit_id = p_fit_id AND status = 'pending_review') THEN
    RAISE EXCEPTION 'fit % not pending_review', p_fit_id;
  END IF;
  SELECT fit_id INTO v_active FROM public.model8_v3_fits WHERE status = 'active' LIMIT 1;

  UPDATE public.model8_v3_fits
     SET status = CASE WHEN p_decision = 'reject' THEN 'rejected' ELSE 'archived' END,
         reviewed_at = now(),
         reviewed_by = p_reviewed_by,
         review_decision = p_decision,
         review_notes = p_notes
   WHERE fit_id = p_fit_id;

  INSERT INTO public.model8_v3_fit_reviews (candidate_fit_id, active_fit_id, reviewed_by, decision, notes, report)
  SELECT p_fit_id, v_active, p_reviewed_by, p_decision, p_notes, review_report
    FROM public.model8_v3_fits WHERE fit_id = p_fit_id;

  RETURN jsonb_build_object('ok', true, 'fit_id', p_fit_id, 'decision', p_decision);
END;
$$;

REVOKE ALL ON FUNCTION public.activate_model8_v3_fit(text, text, text) FROM public;
REVOKE ALL ON FUNCTION public.reject_model8_v3_fit(text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.activate_model8_v3_fit(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_model8_v3_fit(text, text, text, text) TO authenticated, service_role;
