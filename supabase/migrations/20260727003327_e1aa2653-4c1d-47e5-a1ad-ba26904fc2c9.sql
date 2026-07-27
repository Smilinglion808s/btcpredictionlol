
ALTER TABLE public.model3_se_predictions
  ADD COLUMN IF NOT EXISTS abstain_category text,
  ADD COLUMN IF NOT EXISTS abstain_detail text,
  ADD COLUMN IF NOT EXISTS selector_margin double precision,
  ADD COLUMN IF NOT EXISTS direction_confidence_gap double precision,
  ADD COLUMN IF NOT EXISTS publish_gates jsonb,
  ADD COLUMN IF NOT EXISTS fit_estimated_coverage double precision,
  ADD COLUMN IF NOT EXISTS fit_target_coverage double precision,
  ADD COLUMN IF NOT EXISTS fit_calibration_direction_accuracy double precision,
  ADD COLUMN IF NOT EXISTS fit_oof_direction_accuracy double precision,
  ADD COLUMN IF NOT EXISTS fit_selector_roc_auc double precision,
  ADD COLUMN IF NOT EXISTS fit_selector_pr_auc double precision,
  ADD COLUMN IF NOT EXISTS fit_selector_brier double precision,
  ADD COLUMN IF NOT EXISTS fit_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS prior_candle_ready boolean,
  ADD COLUMN IF NOT EXISTS prior_candle_poll_attempts integer,
  ADD COLUMN IF NOT EXISTS history_rows_used integer,
  ADD COLUMN IF NOT EXISTS min_labeled_rows_required integer,
  ADD COLUMN IF NOT EXISTS retrained_this_run boolean,
  ADD COLUMN IF NOT EXISTS retrain_reason text,
  ADD COLUMN IF NOT EXISTS resolved_rows_since_fit integer,
  ADD COLUMN IF NOT EXISTS feature_row_valid boolean,
  ADD COLUMN IF NOT EXISTS feature_nan_count integer,
  ADD COLUMN IF NOT EXISTS code_version text;

ALTER TABLE public.model3_se_predictions ALTER COLUMN fit_id DROP NOT NULL;
