
CREATE TABLE public.model7_aas96_shadow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid REFERENCES public.predictions(id) ON DELETE CASCADE,
  candle_ts timestamptz NOT NULL,
  variant text NOT NULL DEFAULT 'AAS96',
  status text NOT NULL DEFAULT 'pending',
  -- Layer A
  layer_a_prob_l003 numeric,
  layer_a_prob_l010 numeric,
  layer_a_prob_mean numeric,
  layer_a_base_direction text,
  armor_override_fired boolean DEFAULT false,
  armor_override_reason text,
  layer_a_final_direction text,
  -- Layer B
  layer_b_h32_direction text,
  layer_b_h64_direction text,
  layer_b_h96_direction text,
  layer_b_h192_direction text,
  layer_b_final_direction text,
  -- Selector
  layer_a_last96_net integer,
  layer_b_last96_net integer,
  selected_layer text,
  final_prediction text,
  -- Eligibility / audit
  eligibility_passed boolean DEFAULT false,
  skip_reason text,
  input_feature_timestamp timestamptz,
  input_candle_age_seconds integer,
  training_row_count integer,
  last_training_at timestamptz,
  next_retrain_at_count integer,
  feature_schema_hash text,
  fit_id uuid,
  -- Resolution
  actual_direction text,
  result text,
  resolved_at timestamptz,
  -- meta
  shadow_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prediction_id)
);
CREATE INDEX aas96_shadow_candle_idx ON public.model7_aas96_shadow (candle_ts DESC);
CREATE INDEX aas96_shadow_status_idx ON public.model7_aas96_shadow (status);
CREATE INDEX aas96_shadow_result_idx ON public.model7_aas96_shadow (result);

GRANT SELECT ON public.model7_aas96_shadow TO anon, authenticated;
GRANT ALL ON public.model7_aas96_shadow TO service_role;
ALTER TABLE public.model7_aas96_shadow ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read aas96 shadow" ON public.model7_aas96_shadow FOR SELECT TO anon USING (true);

CREATE TABLE public.model7_aas96_state (
  id integer PRIMARY KEY DEFAULT 1,
  resolved_directional_count integer NOT NULL DEFAULT 0,
  last_training_at timestamptz,
  next_retrain_at_count integer NOT NULL DEFAULT 192,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model7_aas96_state_singleton CHECK (id = 1)
);
INSERT INTO public.model7_aas96_state (id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT SELECT ON public.model7_aas96_state TO anon, authenticated;
GRANT ALL ON public.model7_aas96_state TO service_role;
ALTER TABLE public.model7_aas96_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read aas96 state" ON public.model7_aas96_state FOR SELECT TO anon USING (true);

CREATE TABLE public.model7_aas96_fits (
  fit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fitted_at timestamptz NOT NULL DEFAULT now(),
  training_row_count integer NOT NULL,
  feature_names jsonb NOT NULL,
  feature_schema_hash text NOT NULL,
  scaler_json jsonb NOT NULL,
  categorical_vocab_json jsonb NOT NULL,
  intercept_l003 numeric NOT NULL,
  intercept_l010 numeric NOT NULL,
  coef_l003 jsonb NOT NULL,
  coef_l010 jsonb NOT NULL,
  layer_b_expert_history_json jsonb,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX aas96_fits_active_idx ON public.model7_aas96_fits (active, fitted_at DESC);
GRANT SELECT ON public.model7_aas96_fits TO anon, authenticated;
GRANT ALL ON public.model7_aas96_fits TO service_role;
ALTER TABLE public.model7_aas96_fits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read aas96 fits" ON public.model7_aas96_fits FOR SELECT TO anon USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.model7_aas96_shadow;
