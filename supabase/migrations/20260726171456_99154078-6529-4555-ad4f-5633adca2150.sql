
-- 1. Fit review fields
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

-- Backfill: any existing fit rows are considered already-active.
UPDATE public.model8_v3_fits SET status = 'active' WHERE status IS NULL OR status = '';

CREATE INDEX IF NOT EXISTS idx_m8v3_fits_status_version
  ON public.model8_v3_fits (model_version, status, activated_at DESC);

-- 2. Regime monitoring on predictions (monitoring-only for v3.0.1)
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
  ADD COLUMN IF NOT EXISTS regime_transition_score double precision,
  ADD COLUMN IF NOT EXISTS regime_alerts jsonb;

-- 3. Reviews table — full audit of every 96-candle review event
CREATE TABLE IF NOT EXISTS public.model8_v3_fit_reviews (
  review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text NOT NULL,
  candidate_fit_id text NOT NULL REFERENCES public.model8_v3_fits(fit_id) ON DELETE CASCADE,
  active_fit_id text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text,
  decision text,
  notes text,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.model8_v3_fit_reviews TO authenticated;
GRANT ALL ON public.model8_v3_fit_reviews TO service_role;
ALTER TABLE public.model8_v3_fit_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read reviews" ON public.model8_v3_fit_reviews FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write reviews" ON public.model8_v3_fit_reviews FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update reviews" ON public.model8_v3_fit_reviews FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 4. Atomic activation RPC — swap active fit, mark prior superseded.
CREATE OR REPLACE FUNCTION public.activate_model8_v3_fit(
  p_fit_id text,
  p_reviewed_by text,
  p_notes text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version text;
  v_prior text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('m8v3_activate', 0));

  SELECT model_version INTO v_version FROM public.model8_v3_fits WHERE fit_id = p_fit_id;
  IF v_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'fit_not_found');
  END IF;

  SELECT fit_id INTO v_prior
    FROM public.model8_v3_fits
    WHERE model_version = v_version AND status = 'active'
    ORDER BY activated_at DESC NULLS LAST LIMIT 1;

  UPDATE public.model8_v3_fits
     SET status = 'superseded'
   WHERE model_version = v_version AND status = 'active' AND fit_id <> p_fit_id;

  UPDATE public.model8_v3_fits
     SET status = 'active',
         activated_at = now(),
         reviewed_at = now(),
         reviewed_by = COALESCE(p_reviewed_by, reviewed_by),
         review_decision = 'approve',
         review_notes = COALESCE(p_notes, review_notes),
         prior_active_fit_id = COALESCE(prior_active_fit_id, v_prior)
   WHERE fit_id = p_fit_id;

  UPDATE public.model8_v3_fit_reviews
     SET reviewed_at = now(),
         reviewed_by = COALESCE(p_reviewed_by, reviewed_by),
         decision = 'approve',
         notes = COALESCE(p_notes, notes)
   WHERE candidate_fit_id = p_fit_id AND decision IS NULL;

  RETURN jsonb_build_object('ok', true, 'activated_fit_id', p_fit_id, 'prior_active_fit_id', v_prior);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_model8_v3_fit(
  p_fit_id text,
  p_reviewed_by text,
  p_notes text,
  p_decision text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision text := COALESCE(p_decision, 'reject');
BEGIN
  IF v_decision NOT IN ('reject','continue') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_decision');
  END IF;

  UPDATE public.model8_v3_fits
     SET status = CASE WHEN v_decision='reject' THEN 'rejected' ELSE 'continued' END,
         reviewed_at = now(),
         reviewed_by = COALESCE(p_reviewed_by, reviewed_by),
         review_decision = v_decision,
         review_notes = COALESCE(p_notes, review_notes)
   WHERE fit_id = p_fit_id AND status = 'pending_review';

  UPDATE public.model8_v3_fit_reviews
     SET reviewed_at = now(),
         reviewed_by = COALESCE(p_reviewed_by, reviewed_by),
         decision = v_decision,
         notes = COALESCE(p_notes, notes)
   WHERE candidate_fit_id = p_fit_id AND decision IS NULL;

  RETURN jsonb_build_object('ok', true, 'fit_id', p_fit_id, 'decision', v_decision);
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_model8_v3_fit(text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_model8_v3_fit(text,text,text,text) TO authenticated, service_role;
