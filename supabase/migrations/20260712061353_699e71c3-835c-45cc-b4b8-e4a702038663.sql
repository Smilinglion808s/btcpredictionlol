
ALTER TABLE public.model_c_training_fits
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS first_eligible_target_ts timestamptz,
  ADD COLUMN IF NOT EXISTS fit_source text,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

-- Backfill: any pre-existing fit with both component blobs is considered ready.
UPDATE public.model_c_training_fits
   SET status = 'ready',
       promoted_at = COALESCE(promoted_at, created_at),
       fit_source = COALESCE(fit_source, 'live'),
       first_eligible_target_ts = COALESCE(first_eligible_target_ts, training_cutoff_ts + interval '1 millisecond')
 WHERE status = 'pending'
   AND global_component_fit IS NOT NULL
   AND recent_component_fit IS NOT NULL;

-- One READY fit per (model_version, training_cutoff_ts).
CREATE UNIQUE INDEX IF NOT EXISTS model_c_training_fits_ready_uidx
  ON public.model_c_training_fits (training_model_version, training_cutoff_ts)
  WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS model_c_training_fits_active_idx
  ON public.model_c_training_fits (training_model_version, promoted_at DESC)
  WHERE status = 'ready';

ALTER TABLE public.model_c_training_fits
  DROP CONSTRAINT IF EXISTS model_c_training_fits_status_chk,
  ADD CONSTRAINT model_c_training_fits_status_chk
    CHECK (status IN ('pending','ready','failed'));

ALTER TABLE public.model_c_training_fits
  DROP CONSTRAINT IF EXISTS model_c_training_fits_source_chk,
  ADD CONSTRAINT model_c_training_fits_source_chk
    CHECK (fit_source IS NULL OR fit_source IN ('live','bootstrap_initial','bootstrap_emergency'));
