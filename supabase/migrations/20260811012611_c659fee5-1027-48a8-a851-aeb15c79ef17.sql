-- B4x4 runtime-integrity repair: audit columns (non-destructive, idempotent)
ALTER TABLE public.b4x4_predictions
  ADD COLUMN IF NOT EXISTS source_epoch_ts timestamptz,
  ADD COLUMN IF NOT EXISTS source_index_version text,
  ADD COLUMN IF NOT EXISTS source_target_ts timestamptz,
  ADD COLUMN IF NOT EXISTS global_history_start_index integer,
  ADD COLUMN IF NOT EXISTS global_history_end_index integer,
  ADD COLUMN IF NOT EXISTS same_side_input_source_count integer,
  ADD COLUMN IF NOT EXISTS same_side_filtered_count integer,
  ADD COLUMN IF NOT EXISTS same_side_history_start_index integer,
  ADD COLUMN IF NOT EXISTS same_side_history_end_index integer,
  ADD COLUMN IF NOT EXISTS same_side_raw_direction_filter text,
  ADD COLUMN IF NOT EXISTS grid_window_integrity_passed boolean,
  ADD COLUMN IF NOT EXISTS grid_window_integrity_reason text,
  ADD COLUMN IF NOT EXISTS catchup_target_ts timestamptz,
  ADD COLUMN IF NOT EXISTS catchup_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolver_version text,
  ADD COLUMN IF NOT EXISTS canonical_candle_source text,
  ADD COLUMN IF NOT EXISTS legacy_resolution_counter_unreliable boolean,
  ADD COLUMN IF NOT EXISTS scheduler_invocation_id text,
  ADD COLUMN IF NOT EXISTS run_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS run_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS operational_gap_status text,
  ADD COLUMN IF NOT EXISTS operational_gap_reason text,
  ADD COLUMN IF NOT EXISTS watchdog_detected_at timestamptz;

-- One auditable row per canonical target per model version.
CREATE UNIQUE INDEX IF NOT EXISTS b4x4_predictions_target_model_uidx
  ON public.b4x4_predictions (target_candle_ts, model_version);

-- An absolute source position may not be issued twice within a revision.
CREATE UNIQUE INDEX IF NOT EXISTS b4x4_predictions_revision_source_index_uidx
  ON public.b4x4_predictions (implementation_revision, source_index_absolute)
  WHERE implementation_revision IS NOT NULL AND source_index_absolute IS NOT NULL;

CREATE INDEX IF NOT EXISTS b4x4_predictions_revision_idx
  ON public.b4x4_predictions (implementation_revision, target_candle_ts DESC);

-- Reporting-only policy shadows
CREATE TABLE IF NOT EXISTS public.b4x4_policy_shadows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  b4x4_prediction_id uuid NOT NULL REFERENCES public.b4x4_predictions(id) ON DELETE CASCADE,
  target_candle_ts timestamptz NOT NULL,
  shadow_variant text NOT NULL,
  prospective_test_id text NOT NULL,
  config_hash text NOT NULL,
  run_mode text NOT NULL DEFAULT 'LIVE',
  implementation_revision text,
  raw_direction text,
  base_route text,
  gate_inputs_json jsonb,
  gate_fired boolean NOT NULL DEFAULT false,
  local_date text,
  daily_net_before numeric NOT NULL DEFAULT 0,
  brake_active boolean NOT NULL DEFAULT false,
  brake_veto_fired boolean NOT NULL DEFAULT false,
  final_prediction text,
  would_trade boolean NOT NULL DEFAULT false,
  decision_reason text,
  webhook_eligible boolean NOT NULL DEFAULT false,
  actual_direction text,
  result text,
  result_score numeric,
  resolved_at timestamptz,
  resolution_attempt_count integer NOT NULL DEFAULT 0,
  last_resolution_attempt_at timestamptz,
  last_resolution_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.b4x4_policy_shadows TO authenticated;
GRANT ALL ON public.b4x4_policy_shadows TO service_role;

ALTER TABLE public.b4x4_policy_shadows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read b4x4 policy shadows" ON public.b4x4_policy_shadows;
CREATE POLICY "Authenticated users can read b4x4 policy shadows"
  ON public.b4x4_policy_shadows FOR SELECT TO authenticated USING (true);

CREATE UNIQUE INDEX IF NOT EXISTS b4x4_policy_shadows_pred_variant_uidx
  ON public.b4x4_policy_shadows (b4x4_prediction_id, shadow_variant);
CREATE INDEX IF NOT EXISTS b4x4_policy_shadows_variant_ts_idx
  ON public.b4x4_policy_shadows (shadow_variant, target_candle_ts DESC);

DROP TRIGGER IF EXISTS b4x4_policy_shadows_set_updated_at ON public.b4x4_policy_shadows;
CREATE TRIGGER b4x4_policy_shadows_set_updated_at
  BEFORE UPDATE ON public.b4x4_policy_shadows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();