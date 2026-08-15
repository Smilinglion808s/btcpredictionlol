ALTER TABLE public.b4x4_es1_fits
  ADD COLUMN IF NOT EXISTS fit_source text,
  ADD COLUMN IF NOT EXISTS model_version text,
  ADD COLUMN IF NOT EXISTS window_fingerprint text,
  ADD COLUMN IF NOT EXISTS price_fit_certified boolean,
  ADD COLUMN IF NOT EXISTS certified_fitter_code_hash text;

ALTER TABLE public.b4x4_es1_predictions
  ADD COLUMN IF NOT EXISTS price_fit_source text,
  ADD COLUMN IF NOT EXISTS price_fit_certified boolean,
  ADD COLUMN IF NOT EXISTS price_fit_window_fingerprint text,
  ADD COLUMN IF NOT EXISTS certified_fitter_code_hash text,
  ADD COLUMN IF NOT EXISTS price_shadow_probability_green double precision,
  ADD COLUMN IF NOT EXISTS price_shadow_fit_id text,
  ADD COLUMN IF NOT EXISTS decision_state_checksum text,
  ADD COLUMN IF NOT EXISTS decision_state_certified boolean,
  ADD COLUMN IF NOT EXISTS parity_certified boolean;

CREATE INDEX IF NOT EXISTS b4x4_es1_fits_certified_idx
  ON public.b4x4_es1_fits (block_index, feature_schema_hash, price_fit_certified);