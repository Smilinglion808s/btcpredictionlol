
-- Predictions: R2 audit fields
ALTER TABLE public.model3_se_predictions
  ADD COLUMN IF NOT EXISTS selector_score_raw double precision,
  ADD COLUMN IF NOT EXISTS selector_score_percentile double precision,
  ADD COLUMN IF NOT EXISTS signed_consensus double precision,
  ADD COLUMN IF NOT EXISTS consensus_strength double precision,
  ADD COLUMN IF NOT EXISTS expert_agreement integer,
  ADD COLUMN IF NOT EXISTS expert_disagreement double precision,
  ADD COLUMN IF NOT EXISTS minimum_expert_strength double precision,
  ADD COLUMN IF NOT EXISTS stacker_logit_margin double precision,
  ADD COLUMN IF NOT EXISTS green_class_weight double precision,
  ADD COLUMN IF NOT EXISTS red_class_weight double precision,
  ADD COLUMN IF NOT EXISTS fast_recency_half_life integer,
  ADD COLUMN IF NOT EXISTS fit_age_predictions integer;

-- Fits: R2 diagnostic and provenance fields
ALTER TABLE public.model3_se_fits
  ADD COLUMN IF NOT EXISTS training_green_count integer,
  ADD COLUMN IF NOT EXISTS training_red_count integer,
  ADD COLUMN IF NOT EXISTS green_class_weight double precision,
  ADD COLUMN IF NOT EXISTS red_class_weight double precision,
  ADD COLUMN IF NOT EXISTS fast_recency_half_life integer,
  ADD COLUMN IF NOT EXISTS selector_score_calibration_min double precision,
  ADD COLUMN IF NOT EXISTS selector_score_calibration_median double precision,
  ADD COLUMN IF NOT EXISTS selector_score_calibration_p40 double precision,
  ADD COLUMN IF NOT EXISTS selector_score_calibration_p60 double precision,
  ADD COLUMN IF NOT EXISTS selector_score_calibration_max double precision,
  ADD COLUMN IF NOT EXISTS calibration_estimated_coverage double precision,
  ADD COLUMN IF NOT EXISTS oof_balanced_accuracy double precision,
  ADD COLUMN IF NOT EXISTS calibration_balanced_accuracy double precision,
  ADD COLUMN IF NOT EXISTS predicted_green_share double precision,
  ADD COLUMN IF NOT EXISTS predicted_red_share double precision,
  ADD COLUMN IF NOT EXISTS selector_top20_accuracy double precision,
  ADD COLUMN IF NOT EXISTS selector_top40_accuracy double precision,
  ADD COLUMN IF NOT EXISTS selector_top60_accuracy double precision,
  ADD COLUMN IF NOT EXISTS selector_bottom40_accuracy double precision,
  ADD COLUMN IF NOT EXISTS selector_top60_lift_vs_raw double precision,
  ADD COLUMN IF NOT EXISTS selector_top60_lift_vs_bottom40 double precision,
  ADD COLUMN IF NOT EXISTS selector_lambda_search jsonb;
