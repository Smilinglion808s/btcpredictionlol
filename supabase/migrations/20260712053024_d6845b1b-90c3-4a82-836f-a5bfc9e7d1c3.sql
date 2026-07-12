
CREATE TABLE public.model_c_shadow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid REFERENCES public.predictions(id) ON DELETE SET NULL,
  candle_ts timestamptz NOT NULL,
  target_boundary_ts timestamptz,
  scored_at timestamptz,
  boundary_delta_ms integer,
  prediction_row_created_at timestamptz,
  prediction_row_lead_ms integer,
  feature_cutoff_ts timestamptz,
  latest_source_candle_ts timestamptz,
  leakage_check_passed boolean,
  timing_status text,
  global_probability_green numeric(6,4),
  recent_probability_green numeric(6,4),
  ensemble_probability_green numeric(6,4),
  base_decision text,
  override_reasons_json jsonb,
  final_decision text,
  trade boolean,
  global_artifact_sha256 text,
  recent_artifact_sha256 text,
  global_feature_vector_sha256 text,
  recent_feature_vector_sha256 text,
  actual_direction text,
  won boolean,
  resolved_at timestamptz,
  in_sample_global_prob_mean numeric(6,4),
  in_sample_global_prob_std numeric(6,4),
  in_sample_recent_prob_mean numeric(6,4),
  in_sample_recent_prob_std numeric(6,4),
  status text NOT NULL DEFAULT 'warming_up',
  shadow_error text,
  fit_id text,
  production_model_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_c_shadow_candle_ts_idx ON public.model_c_shadow(candle_ts DESC);
CREATE INDEX model_c_shadow_prediction_id_idx ON public.model_c_shadow(prediction_id);
CREATE UNIQUE INDEX model_c_shadow_candle_uidx ON public.model_c_shadow(candle_ts);

GRANT SELECT ON public.model_c_shadow TO authenticated;
GRANT ALL ON public.model_c_shadow TO service_role;
ALTER TABLE public.model_c_shadow ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read model_c_shadow" ON public.model_c_shadow FOR SELECT TO authenticated USING (true);

CREATE TABLE public.model_c_training_fits (
  fit_id text PRIMARY KEY,
  training_cutoff_ts timestamptz NOT NULL,
  global_training_row_count integer,
  recent_training_row_count integer,
  global_artifact_sha256 text,
  recent_artifact_sha256 text,
  combined_fit_sha256 text,
  first_scored_candle_ts timestamptz,
  in_sample_global_prob_mean numeric(6,4),
  in_sample_global_prob_std numeric(6,4),
  in_sample_recent_prob_mean numeric(6,4),
  in_sample_recent_prob_std numeric(6,4),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.model_c_training_fits TO authenticated;
GRANT ALL ON public.model_c_training_fits TO service_role;
ALTER TABLE public.model_c_training_fits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read model_c_training_fits" ON public.model_c_training_fits FOR SELECT TO authenticated USING (true);
