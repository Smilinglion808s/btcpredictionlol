ALTER TABLE public.model7_training_fits
  ADD COLUMN IF NOT EXISTS first_scored_candle_ts timestamptz;

CREATE INDEX IF NOT EXISTS idx_model7_training_fits_variant_created
  ON public.model7_training_fits (variant, created_at DESC);