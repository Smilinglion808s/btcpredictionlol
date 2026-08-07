CREATE TABLE public.b4x4_predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_a2_row_id UUID,
  source_prediction_id UUID,
  target_candle_ts TIMESTAMPTZ NOT NULL,
  model_name TEXT NOT NULL DEFAULT 'B4x4',
  model_version TEXT NOT NULL DEFAULT 'b4x4-v1',
  variant TEXT NOT NULL DEFAULT 'a2-core-grid40-brake80',
  prospective_test_id TEXT NOT NULL DEFAULT 'B4X4_CORE_GRID40_BRAKE80_V1',
  config_hash TEXT,
  run_mode TEXT NOT NULL DEFAULT 'LIVE',
  webhook_eligible BOOLEAN NOT NULL DEFAULT false,
  webhook_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  a2_source_variant TEXT,
  a2_model_fit_id TEXT,
  a2_production_model_version TEXT,
  a2_probability_green DOUBLE PRECISION,
  raw_direction TEXT,
  confidence DOUBLE PRECISION,
  feature_cutoff_ts TIMESTAMPTZ,
  latest_source_candle_ts TIMESTAMPTZ,
  timing_status TEXT,
  leakage_check_passed BOOLEAN,
  data_valid BOOLEAN NOT NULL DEFAULT true,
  data_invalid_reason TEXT,

  global_rank DOUBLE PRECISION,
  global_history_count INTEGER,
  global_history_start_ts TIMESTAMPTZ,
  global_history_end_ts TIMESTAMPTZ,
  same_side_rank DOUBLE PRECISION,
  same_side_history_count INTEGER,
  same_side_history_start_ts TIMESTAMPTZ,
  same_side_history_end_ts TIMESTAMPTZ,
  global_rank_quartile SMALLINT,
  same_side_rank_quartile SMALLINT,
  quality_mean DOUBLE PRECISION,

  grid_training_lookback INTEGER,
  grid_training_resolved_count INTEGER,
  grid_training_start_ts TIMESTAMPTZ,
  grid_training_end_ts TIMESTAMPTZ,
  grid_prior_alpha INTEGER,
  grid_prior_beta INTEGER,
  grid_cell TEXT,
  grid_cell_resolved_count INTEGER,
  grid_cell_wins INTEGER,
  grid_cell_losses INTEGER,
  p_correct DOUBLE PRECISION,
  grid_reference_count INTEGER,
  grid_quality_percentile DOUBLE PRECISION,
  grid_snapshot_json JSONB,

  core_eligible BOOLEAN,
  expansion_eligible BOOLEAN,
  base_candidate BOOLEAN,
  selected_route TEXT,
  local_date TEXT,
  daily_net_before INTEGER,
  daily_resolved_trade_count_before INTEGER,
  intraday_brake_active BOOLEAN,
  intraday_brake_veto_fired BOOLEAN,
  final_prediction TEXT,
  would_trade BOOLEAN NOT NULL DEFAULT false,
  decision_reason TEXT,

  actual_open DOUBLE PRECISION,
  actual_high DOUBLE PRECISION,
  actual_low DOUBLE PRECISION,
  actual_close DOUBLE PRECISION,
  actual_direction TEXT,
  result TEXT,
  result_score SMALLINT,
  resolved_at TIMESTAMPTZ,
  resolution_attempt_count INTEGER NOT NULL DEFAULT 0,
  last_resolution_error TEXT,
  last_resolution_attempt_at TIMESTAMPTZ,

  raw_a2_counterfactual_result TEXT,
  core_only_counterfactual_trade BOOLEAN,
  core_only_counterfactual_score SMALLINT,
  expansion_only_counterfactual_trade BOOLEAN,
  expansion_only_counterfactual_score SMALLINT,
  base_no_brake_counterfactual_trade BOOLEAN,
  base_no_brake_counterfactual_score SMALLINT,
  brake_attribution_class TEXT,
  brake_incremental_value SMALLINT,

  CONSTRAINT b4x4_predictions_target_version_unique UNIQUE (target_candle_ts, model_version)
);

CREATE INDEX b4x4_predictions_target_idx ON public.b4x4_predictions (target_candle_ts DESC);
CREATE INDEX b4x4_predictions_local_date_idx ON public.b4x4_predictions (local_date);

GRANT SELECT ON public.b4x4_predictions TO authenticated;
GRANT ALL ON public.b4x4_predictions TO service_role;
ALTER TABLE public.b4x4_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read b4x4 predictions"
  ON public.b4x4_predictions FOR SELECT TO authenticated USING (true);

CREATE TRIGGER b4x4_predictions_set_updated_at
BEFORE UPDATE ON public.b4x4_predictions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.b4x4_shadow_market_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  b4x4_prediction_id UUID REFERENCES public.b4x4_predictions(id) ON DELETE CASCADE,
  target_candle_ts TIMESTAMPTZ NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  feature_cutoff_ts TIMESTAMPTZ,
  coverage_status TEXT,
  error_reason TEXT,
  orderbook_json JSONB,
  flow_json JSONB,
  regime_json JSONB,
  derivatives_json JSONB,
  flow_direction_3m TEXT,
  flow_direction_15m TEXT,
  flow_3m_15m_coherent BOOLEAN,
  flow_strength_percentile DOUBLE PRECISION,
  flow_strong_coherent BOOLEAN,
  flow_agrees_a2 BOOLEAN,
  flow_conflicts_a2 BOOLEAN,
  path_efficiency_4 DOUBLE PRECISION,
  path_efficiency_4_percentile DOUBLE PRECISION,
  shadow_efficiency_not_mid BOOLEAN,
  attribution_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX b4x4_shadow_target_idx ON public.b4x4_shadow_market_data (target_candle_ts DESC);

GRANT SELECT ON public.b4x4_shadow_market_data TO authenticated;
GRANT ALL ON public.b4x4_shadow_market_data TO service_role;
ALTER TABLE public.b4x4_shadow_market_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read b4x4 shadow data"
  ON public.b4x4_shadow_market_data FOR SELECT TO authenticated USING (true);

CREATE TRIGGER b4x4_shadow_market_data_set_updated_at
BEFORE UPDATE ON public.b4x4_shadow_market_data
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();