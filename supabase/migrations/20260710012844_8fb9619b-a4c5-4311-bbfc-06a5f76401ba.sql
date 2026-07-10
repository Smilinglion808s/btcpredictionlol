
CREATE TABLE public.model7_shadow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID NOT NULL REFERENCES public.predictions(id) ON DELETE CASCADE,
  candle_ts TIMESTAMPTZ NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('A','B')),
  production_model_version TEXT,
  probability_green NUMERIC,
  base_decision TEXT CHECK (base_decision IN ('YES','NO','SKIP') OR base_decision IS NULL),
  decision TEXT CHECK (decision IN ('YES','NO','SKIP') OR decision IS NULL),
  hard_no_override_fired TEXT,
  would_trade BOOLEAN,
  model_fit_id TEXT,
  feature_vector_nonzero_count INT,
  unknown_categories JSONB,
  logit NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','win','loss','push','skipped','error')),
  actual_direction TEXT,
  resolved_at TIMESTAMPTZ,
  shadow_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prediction_id, variant)
);

GRANT SELECT ON public.model7_shadow TO authenticated;
GRANT ALL    ON public.model7_shadow TO service_role;

ALTER TABLE public.model7_shadow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read shadow rows"
  ON public.model7_shadow FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_model7_shadow_candle_ts ON public.model7_shadow (candle_ts DESC);
CREATE INDEX idx_model7_shadow_variant_status ON public.model7_shadow (variant, status);

CREATE TRIGGER trg_model7_shadow_updated_at
  BEFORE UPDATE ON public.model7_shadow
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE public.model7_training_fits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant TEXT NOT NULL CHECK (variant IN ('B')),
  model_fit_id TEXT NOT NULL UNIQUE,
  training_model_version TEXT NOT NULL,
  training_row_count INT NOT NULL,
  training_window_start TIMESTAMPTZ,
  training_window_end TIMESTAMPTZ,
  feature_order JSONB NOT NULL,
  feature_means JSONB NOT NULL,
  feature_scales JSONB NOT NULL,
  coefficients JSONB NOT NULL,
  intercept NUMERIC NOT NULL,
  categorical_vocab JSONB NOT NULL,
  fit_meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.model7_training_fits TO authenticated;
GRANT ALL    ON public.model7_training_fits TO service_role;

ALTER TABLE public.model7_training_fits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read training fits"
  ON public.model7_training_fits FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_model7_training_fits_created ON public.model7_training_fits (created_at DESC);

CREATE TRIGGER trg_model7_training_fits_updated_at
  BEFORE UPDATE ON public.model7_training_fits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
