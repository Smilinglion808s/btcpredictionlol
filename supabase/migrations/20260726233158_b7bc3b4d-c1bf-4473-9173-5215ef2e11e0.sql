
-- =====================================================================
-- model3_se_fits: immutable trained fits for m3-se-r1
-- =====================================================================
CREATE TABLE public.model3_se_fits (
  fit_id                        text PRIMARY KEY,
  model_version                 text NOT NULL,
  feature_schema_version        text NOT NULL,
  feature_schema_hash           text NOT NULL,
  artifact_hash                 text NOT NULL,
  status                        text NOT NULL DEFAULT 'active',
  failure_reason                text,
  fitted_at                     timestamptz NOT NULL DEFAULT now(),
  activated_at                  timestamptz,
  retired_at                    timestamptz,

  -- Windows
  slow_training_start           timestamptz,
  slow_training_end             timestamptz,
  slow_training_rows            integer,
  fast_training_start           timestamptz,
  fast_training_end             timestamptz,
  fast_training_rows            integer,
  oof_start                     timestamptz,
  oof_end                       timestamptz,
  oof_rows                      integer,
  oof_block_size                integer,
  calibration_start             timestamptz,
  calibration_end               timestamptz,
  calibration_rows              integer,

  -- Hyperparameters
  slow_lambda                   double precision,
  fast_lambda                   double precision,
  stacker_lambda                double precision,
  selector_lambda               double precision,

  -- Selection
  selection_threshold           double precision,
  target_coverage               double precision,
  estimated_coverage            double precision,

  -- Diagnostics
  oof_direction_accuracy        double precision,
  oof_direction_brier           double precision,
  oof_direction_log_loss        double precision,
  calibration_direction_accuracy double precision,
  calibration_direction_brier   double precision,
  calibration_direction_log_loss double precision,
  selector_roc_auc              double precision,
  selector_pr_auc               double precision,
  selector_brier                double precision,
  selector_log_loss             double precision,

  -- Full artifact (preprocess + all weights + platt)
  artifact                      jsonb NOT NULL,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX model3_se_fits_status_idx ON public.model3_se_fits (status, activated_at DESC);
CREATE INDEX model3_se_fits_version_idx ON public.model3_se_fits (model_version, fitted_at DESC);

GRANT SELECT ON public.model3_se_fits TO authenticated;
GRANT ALL    ON public.model3_se_fits TO service_role;
ALTER TABLE public.model3_se_fits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "model3_se_fits_read_auth"
  ON public.model3_se_fits FOR SELECT TO authenticated USING (true);

CREATE TRIGGER model3_se_fits_set_updated_at
  BEFORE UPDATE ON public.model3_se_fits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- model3_se_predictions: one row per predicted 15m candle
-- =====================================================================
CREATE TABLE public.model3_se_predictions (
  prediction_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fit_id                        text NOT NULL REFERENCES public.model3_se_fits(fit_id),
  model_version                 text NOT NULL,
  feature_schema_version        text NOT NULL,

  symbol                        text NOT NULL,
  timeframe                     text NOT NULL,
  provider                      text NOT NULL,
  target_candle_ts              timestamptz NOT NULL,
  target_open                   double precision,
  prediction_created_at         timestamptz NOT NULL DEFAULT now(),

  -- Data quality
  data_quality_valid            boolean NOT NULL DEFAULT true,
  data_quality_reasons          text[],

  -- Feature snapshot (21 direction features, flat columns)
  ret_log_1                     double precision,
  ret_log_2                     double precision,
  ret_log_4                     double precision,
  ret_log_8                     double precision,
  ret_log_16                    double precision,
  body_to_atr                   double precision,
  range_to_atr                  double precision,
  wick_imbalance                double precision,
  close_location_in_range       double precision,
  ema9_minus_ema21_to_atr       double precision,
  ema21_minus_ema50_to_atr      double precision,
  price_minus_ema21_to_atr      double precision,
  rolling_position_16           double precision,
  rolling_position_32           double precision,
  rsi14_centered                double precision,
  realized_volatility_8_to_32   double precision,
  atr_percentile_256            double precision,
  range_percentile_256          double precision,
  trend_efficiency_8            double precision,
  trend_efficiency_32           double precision,
  volume_zscore_32              double precision,

  -- Direction pipeline outputs
  p_green_slow                  double precision,
  p_green_fast                  double precision,
  slow_logit                    double precision,
  fast_logit                    double precision,
  p_green_stacked_raw           double precision,
  p_green_stacked_calibrated    double precision,
  raw_prediction                text,   -- 'GREEN' | 'RED'
  raw_confidence                double precision,

  -- Correctness selector inputs / outputs
  aligned_ret_log_1             double precision,
  aligned_ret_log_2             double precision,
  aligned_ret_log_4             double precision,
  aligned_ret_log_8             double precision,
  aligned_body_to_atr           double precision,
  aligned_ema9_minus_ema21_to_atr double precision,
  aligned_ema21_minus_ema50_to_atr double precision,
  aligned_rsi14_centered        double precision,
  aligned_trend_efficiency_32   double precision,
  aligned_realized_volatility_8_to_32 double precision,
  p_correct_raw                 double precision,
  p_correct_calibrated          double precision,

  -- Publication decision
  selection_threshold           double precision,
  published_prediction          text NOT NULL, -- 'GREEN' | 'RED' | 'ABSTAIN'
  abstain_reason                text,

  -- Resolution
  actual_open                   double precision,
  actual_high                   double precision,
  actual_low                    double precision,
  actual_close                  double precision,
  actual_volume                 double precision,
  actual_direction              text,   -- 'GREEN' | 'RED' | 'PUSH'
  raw_result                    text,   -- 'WIN' | 'LOSS' | 'PUSH'
  published_result              text,   -- 'WIN' | 'LOSS' | 'PUSH' | 'ABSTAIN'
  raw_net                       integer,
  published_net                 integer,
  resolved_at                   timestamptz,

  -- Selector counterfactuals
  raw_would_win                 boolean,
  abstained_winner              boolean,
  abstained_loser               boolean,
  selector_net_effect           integer,

  last_resolution_error         text,
  last_resolution_attempt_at    timestamptz,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (model_version, symbol, timeframe, target_candle_ts)
);

CREATE INDEX model3_se_predictions_target_idx    ON public.model3_se_predictions (target_candle_ts DESC);
CREATE INDEX model3_se_predictions_fit_idx       ON public.model3_se_predictions (fit_id, target_candle_ts DESC);
CREATE INDEX model3_se_predictions_resolved_idx  ON public.model3_se_predictions (resolved_at DESC NULLS LAST);

GRANT SELECT ON public.model3_se_predictions TO authenticated;
GRANT ALL    ON public.model3_se_predictions TO service_role;
ALTER TABLE public.model3_se_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "model3_se_predictions_read_auth"
  ON public.model3_se_predictions FOR SELECT TO authenticated USING (true);

CREATE TRIGGER model3_se_predictions_set_updated_at
  BEFORE UPDATE ON public.model3_se_predictions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- model3_se_blocks: rolling 96-row summary blocks
-- =====================================================================
CREATE TABLE public.model3_se_blocks (
  block_id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fit_id                        text NOT NULL REFERENCES public.model3_se_fits(fit_id),
  model_version                 text NOT NULL,
  block_start_ts                timestamptz NOT NULL,
  block_end_ts                  timestamptz NOT NULL,
  eligible_candles              integer NOT NULL,
  published_count               integer NOT NULL,
  abstain_count                 integer NOT NULL,
  coverage                      double precision NOT NULL,
  raw_wins                      integer NOT NULL,
  raw_losses                    integer NOT NULL,
  raw_pushes                    integer NOT NULL,
  raw_win_rate                  double precision,
  published_wins                integer NOT NULL,
  published_losses              integer NOT NULL,
  published_pushes              integer NOT NULL,
  published_win_rate            double precision,
  abstained_winners             integer NOT NULL,
  abstained_losers              integer NOT NULL,
  selector_net_effect_sum       integer NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX model3_se_blocks_range_idx ON public.model3_se_blocks (block_end_ts DESC);
CREATE INDEX model3_se_blocks_fit_idx   ON public.model3_se_blocks (fit_id, block_end_ts DESC);

GRANT SELECT ON public.model3_se_blocks TO authenticated;
GRANT ALL    ON public.model3_se_blocks TO service_role;
ALTER TABLE public.model3_se_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "model3_se_blocks_read_auth"
  ON public.model3_se_blocks FOR SELECT TO authenticated USING (true);
