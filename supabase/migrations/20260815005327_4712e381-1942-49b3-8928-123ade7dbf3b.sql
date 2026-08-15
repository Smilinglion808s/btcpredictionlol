CREATE TABLE public.b4x4_es1_fits (
  fit_id text PRIMARY KEY,
  artifact_sha256 text NOT NULL,
  feature_schema_hash text NOT NULL,
  config_hash text,
  specification text NOT NULL,
  scaler_name text NOT NULL,
  scaler_center jsonb NOT NULL,
  scaler_scale jsonb NOT NULL,
  coefficients jsonb NOT NULL,
  intercept double precision NOT NULL,
  logistic_c double precision NOT NULL,
  solver text NOT NULL,
  converged boolean,
  iterations integer,
  gradient_norm double precision,
  training_row_count integer NOT NULL,
  training_start_ts timestamptz,
  training_end_ts timestamptz,
  training_start_index integer,
  training_end_index integer,
  block_index integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_index, feature_schema_hash)
);

GRANT SELECT ON public.b4x4_es1_fits TO authenticated;
GRANT ALL ON public.b4x4_es1_fits TO service_role;
ALTER TABLE public.b4x4_es1_fits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read b4x4 es1 fits"
  ON public.b4x4_es1_fits FOR SELECT TO authenticated USING (true);

CREATE TABLE public.b4x4_es1_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_candle_ts timestamptz NOT NULL,
  model_name text NOT NULL,
  model_version text NOT NULL,
  variant text,
  directional_version text,
  b4_guard_version text,
  prospective_test_id text,
  implementation_revision text,
  config_hash text,
  feature_schema_hash text,
  run_mode text NOT NULL DEFAULT 'LIVE',
  local_date text,
  build_identifier text,
  build_commit_sha text,
  deploy_environment text,
  scheduler_invocation_id text,
  operational_gap_status text DEFAULT 'NONE',
  operational_gap_reason text,
  catchup_target_ts timestamptz,

  canonical_candle_source text,
  latest_source_candle_ts timestamptz,
  feature_cutoff_ts timestamptz,
  timing_valid boolean,
  timing_invalid_reason text,
  feature_valid boolean,
  feature_invalid_reason text,
  data_valid boolean,
  data_invalid_reason text,
  feature_vector_hash text,
  feature_values_json jsonb,

  price_fit_id text,
  price_fit_artifact_sha256 text,
  price_training_start_ts timestamptz,
  price_training_end_ts timestamptz,
  price_training_row_count integer,
  price_probability_green double precision,
  price_direction text,
  price_confidence double precision,

  ob_snapshot_ts timestamptz,
  ob_capture_status text,
  ob_book_complete boolean,
  ob_depth_imbalance_10bps double precision,
  ob_abs_depth double precision,
  ob_history_count integer,
  ob_history_start_ts timestamptz,
  ob_history_end_ts timestamptz,
  ob_history_cap double precision,
  ob_abs_percentile double precision,
  ob_route_qualified boolean,
  ob_route_reject_reason text,

  hybrid_direction text,
  hybrid_evidence double precision,
  hybrid_route text,

  a2_source_variant text,
  a2_row_id uuid,
  a2_prediction_id uuid,
  a2_model_fit_id text,
  a2_production_model_version text,
  a2_probability_green double precision,
  a2_direction text,
  a2_confidence double precision,
  a2_agrees boolean,

  price_confidence_rank double precision,
  price_rank_history_count integer,
  a2_confidence_rank double precision,
  a2_rank_history_count integer,
  combined_confidence_rank double precision,
  combined_rank_qualified boolean,

  source_index_absolute integer,
  b4_global_rank double precision,
  b4_global_history_count integer,
  b4_same_side_rank double precision,
  b4_same_side_input_count integer,
  b4_same_side_history_count integer,
  b4_global_quartile integer,
  b4_same_side_quartile integer,
  b4_cell text,
  b4_training_start_index integer,
  b4_training_end_index integer,
  b4_reference_start_index integer,
  b4_reference_end_index integer,
  b4_cell_wins integer,
  b4_cell_losses integer,
  b4_cell_resolved_count integer,
  b4_p_correct double precision,
  b4_quality_percentile double precision,
  b4_reference_count integer,
  b4_ready boolean,
  b4_not_ready_reason text,
  b4_guard_veto_fired boolean DEFAULT false,

  aligned_candidate_before_b4 boolean,
  aligned_candidate_direction text,
  without_b4_guard_would_trade boolean,
  without_b4_guard_direction text,
  without_b4_guard_decision_reason text,
  final_prediction text,
  would_trade boolean NOT NULL DEFAULT false,
  decision_reason text,
  webhook_eligible boolean NOT NULL DEFAULT false,
  webhook_sent_at timestamptz,

  actual_open double precision,
  actual_high double precision,
  actual_low double precision,
  actual_close double precision,
  actual_volume double precision,
  actual_direction text,
  result text,
  result_score integer,
  resolved_at timestamptz,
  resolution_attempt_count integer NOT NULL DEFAULT 0,
  last_resolution_attempt_at timestamptz,
  last_resolution_error text,
  resolver_version text,
  raw_counterfactual_result text,
  raw_counterfactual_score integer,
  without_b4_guard_score integer,
  b4_guard_attribution_class text,
  b4_guard_incremental_value integer,

  run_started_at timestamptz,
  run_finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_candle_ts, model_version)
);

CREATE INDEX b4x4_es1_predictions_target_idx ON public.b4x4_es1_predictions (target_candle_ts DESC);
CREATE INDEX b4x4_es1_predictions_resolved_idx ON public.b4x4_es1_predictions (resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX b4x4_es1_predictions_local_date_idx ON public.b4x4_es1_predictions (local_date);

GRANT SELECT ON public.b4x4_es1_predictions TO authenticated;
GRANT ALL ON public.b4x4_es1_predictions TO service_role;
ALTER TABLE public.b4x4_es1_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read b4x4 es1 predictions"
  ON public.b4x4_es1_predictions FOR SELECT TO authenticated USING (true);

CREATE TRIGGER b4x4_es1_predictions_set_updated_at
  BEFORE UPDATE ON public.b4x4_es1_predictions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();