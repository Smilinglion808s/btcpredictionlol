ALTER TABLE public.model_c_training_fits
  ADD COLUMN IF NOT EXISTS training_model_version text NOT NULL DEFAULT '6',
  ADD COLUMN IF NOT EXISTS global_component_fit jsonb,
  ADD COLUMN IF NOT EXISTS recent_component_fit jsonb,
  ADD COLUMN IF NOT EXISTS global_training_window_start_ts timestamptz,
  ADD COLUMN IF NOT EXISTS global_training_window_end_ts timestamptz,
  ADD COLUMN IF NOT EXISTS recent_training_window_start_ts timestamptz,
  ADD COLUMN IF NOT EXISTS recent_training_window_end_ts timestamptz,
  ADD COLUMN IF NOT EXISTS fit_meta jsonb;

CREATE INDEX IF NOT EXISTS model_c_training_fits_active_idx
  ON public.model_c_training_fits (training_model_version, created_at DESC);