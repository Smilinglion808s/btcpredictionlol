ALTER TABLE public.b4x4_predictions
  ADD COLUMN IF NOT EXISTS implementation_revision text,
  ADD COLUMN IF NOT EXISTS revision_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_index_absolute integer,
  ADD COLUMN IF NOT EXISTS grid_training_source_count integer,
  ADD COLUMN IF NOT EXISTS grid_training_start_index integer,
  ADD COLUMN IF NOT EXISTS grid_training_end_index integer,
  ADD COLUMN IF NOT EXISTS grid_reference_source_count integer,
  ADD COLUMN IF NOT EXISTS grid_reference_start_index integer,
  ADD COLUMN IF NOT EXISTS grid_reference_end_index integer,
  ADD COLUMN IF NOT EXISTS grid_reference_start_ts timestamptz,
  ADD COLUMN IF NOT EXISTS grid_reference_end_ts timestamptz,
  ADD COLUMN IF NOT EXISTS catchup_resolution_status text,
  ADD COLUMN IF NOT EXISTS catchup_resolution_error text;

ALTER TABLE public.b4x4_ob_snapshots
  ADD COLUMN IF NOT EXISTS local_receipt_ts timestamptz,
  ADD COLUMN IF NOT EXISTS cutoff_ts timestamptz,
  ADD COLUMN IF NOT EXISTS capture_attempt_count integer,
  ADD COLUMN IF NOT EXISTS capture_attempts_json jsonb,
  ADD COLUMN IF NOT EXISTS chosen_attempt_id text,
  ADD COLUMN IF NOT EXISTS capture_error_list jsonb,
  ADD COLUMN IF NOT EXISTS trade_window_complete boolean;

ALTER TABLE public.b4x4_shadow_market_data
  ADD COLUMN IF NOT EXISTS capture_attempt_count integer,
  ADD COLUMN IF NOT EXISTS capture_attempts_json jsonb,
  ADD COLUMN IF NOT EXISTS chosen_attempt_id text,
  ADD COLUMN IF NOT EXISTS snapshot_cutoff_ts timestamptz,
  ADD COLUMN IF NOT EXISTS snapshot_local_receipt_ts timestamptz,
  ADD COLUMN IF NOT EXISTS capture_error_list jsonb,
  ADD COLUMN IF NOT EXISTS trade_window_complete boolean;

CREATE OR REPLACE FUNCTION public.b4x4_begin_resolution_attempt(
  p_target_candle_ts timestamptz,
  p_model_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_resolved timestamptz;
  v_count integer;
BEGIN
  SELECT id, resolved_at INTO v_id, v_resolved
    FROM public.b4x4_predictions
   WHERE model_version = p_model_version
     AND target_candle_ts = p_target_candle_ts
   FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- An idempotent no-op check is not a real attempt: do not increment.
  IF v_resolved IS NOT NULL THEN
    RETURN jsonb_build_object('found', true, 'already_resolved', true, 'id', v_id);
  END IF;

  UPDATE public.b4x4_predictions
     SET resolution_attempt_count = COALESCE(resolution_attempt_count, 0) + 1,
         last_resolution_attempt_at = now()
   WHERE id = v_id
  RETURNING resolution_attempt_count INTO v_count;

  RETURN jsonb_build_object('found', true, 'already_resolved', false, 'id', v_id, 'attempt_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.b4x4_begin_resolution_attempt(timestamptz, text) TO service_role;