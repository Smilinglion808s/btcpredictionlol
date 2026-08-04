CREATE TABLE public.v6_warmup_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text NOT NULL UNIQUE,
  fit_id text,
  model_artifact_sha256 text,
  feature_schema_version text,
  v6_warmup_status text NOT NULL DEFAULT 'NOT_STARTED',
  warmup_started_at timestamptz,
  warmup_completed_at timestamptz,
  warmup_candle_count integer NOT NULL DEFAULT 0,
  warmup_first_candle_ts timestamptz,
  warmup_last_candle_ts timestamptz,
  warmup_next_target_ts timestamptz,
  warmup_continuity_valid boolean NOT NULL DEFAULT false,
  warmup_feature_valid boolean NOT NULL DEFAULT false,
  warmup_base_predictions_count integer NOT NULL DEFAULT 0,
  warmup_base_predictions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  warmup_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.v6_warmup_state TO authenticated;
GRANT ALL ON public.v6_warmup_state TO service_role;

ALTER TABLE public.v6_warmup_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read v6 warmup state"
  ON public.v6_warmup_state FOR SELECT TO authenticated USING (true);

CREATE TRIGGER v6_warmup_state_set_updated_at
  BEFORE UPDATE ON public.v6_warmup_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();