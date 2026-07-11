CREATE UNIQUE INDEX IF NOT EXISTS model7_shadow_variant_candle_uidx
  ON public.model7_shadow (variant, candle_ts);