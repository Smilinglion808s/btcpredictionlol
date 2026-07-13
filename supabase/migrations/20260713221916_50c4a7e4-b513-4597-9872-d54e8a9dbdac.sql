ALTER TABLE public.model_c_shadow
  ADD COLUMN IF NOT EXISTS variant text NOT NULL DEFAULT 'dual_horizon';

UPDATE public.model_c_shadow
SET variant = 'dual_horizon'
WHERE variant IS NULL OR variant = '';

DROP INDEX IF EXISTS public.model_c_shadow_candle_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS model_c_shadow_candle_variant_uidx
  ON public.model_c_shadow (candle_ts, variant);