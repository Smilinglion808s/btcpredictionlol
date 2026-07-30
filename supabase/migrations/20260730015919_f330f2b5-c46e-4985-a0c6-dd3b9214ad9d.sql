ALTER TABLE public.model3_se_predictions
  ADD COLUMN IF NOT EXISTS direction_strength double precision,
  ADD COLUMN IF NOT EXISTS direction_strength_threshold double precision,
  ADD COLUMN IF NOT EXISTS direction_strength_percentile double precision,
  ADD COLUMN IF NOT EXISTS direction_strength_selected boolean,
  ADD COLUMN IF NOT EXISTS selector_shadow_selected boolean,
  ADD COLUMN IF NOT EXISTS selector_shadow_result text,
  ADD COLUMN IF NOT EXISTS selector_shadow_net integer;

ALTER TABLE public.model3_se_fits
  ADD COLUMN IF NOT EXISTS direction_strength_calibration_min double precision,
  ADD COLUMN IF NOT EXISTS direction_strength_calibration_median double precision,
  ADD COLUMN IF NOT EXISTS direction_strength_calibration_p65 double precision,
  ADD COLUMN IF NOT EXISTS direction_strength_calibration_p70 double precision,
  ADD COLUMN IF NOT EXISTS direction_strength_calibration_max double precision;