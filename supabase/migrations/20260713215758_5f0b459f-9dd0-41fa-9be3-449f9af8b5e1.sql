
-- Model 7 Variant B4.2 (Daily Edge Guard) shadow tables + tracking columns.

-- Per-day state row
CREATE TABLE IF NOT EXISTS public.model7_b4_2_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL DEFAULT 'BTC-USDT',
  timeframe text NOT NULL DEFAULT '15m',
  policy_version text NOT NULL DEFAULT 'b4_2_v1',
  date_mt text NOT NULL,
  edge_score numeric NOT NULL DEFAULT 0,
  cooldown_remaining integer NOT NULL DEFAULT 0,
  last_processed_resolution_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(symbol, timeframe, policy_version, date_mt)
);
GRANT SELECT ON public.model7_b4_2_state TO authenticated;
GRANT ALL ON public.model7_b4_2_state TO service_role;
ALTER TABLE public.model7_b4_2_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b4_2_state_read_auth" ON public.model7_b4_2_state FOR SELECT TO authenticated USING (true);

-- Rolling per-day NO history
CREATE TABLE IF NOT EXISTS public.model7_b4_2_no_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL DEFAULT 'BTC-USDT',
  timeframe text NOT NULL DEFAULT '15m',
  policy_version text NOT NULL DEFAULT 'b4_2_v1',
  date_mt text NOT NULL,
  candle_ts timestamptz NOT NULL,
  b2_final_decision text NOT NULL,
  result text NOT NULL CHECK (result IN ('WIN','LOSS')),
  resolution_id text NOT NULL UNIQUE,
  resolved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.model7_b4_2_no_history TO authenticated;
GRANT ALL ON public.model7_b4_2_no_history TO service_role;
ALTER TABLE public.model7_b4_2_no_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b4_2_no_hist_read_auth" ON public.model7_b4_2_no_history FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS b4_2_no_hist_lookup_idx
  ON public.model7_b4_2_no_history (symbol, timeframe, policy_version, date_mt, resolved_at DESC);

-- Idempotency + audit log
CREATE TABLE IF NOT EXISTS public.model7_b4_2_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resolution_id text NOT NULL UNIQUE,
  policy_version text NOT NULL DEFAULT 'b4_2_v1',
  candle_ts timestamptz NOT NULL,
  date_mt text NOT NULL,
  b2_final_decision text NOT NULL,
  b4_2_final_decision text NOT NULL,
  counterfactual_b2_result text CHECK (counterfactual_b2_result IN ('WIN','LOSS')),
  b4_2_skipped boolean NOT NULL,
  edge_score_before numeric,
  edge_score_after numeric,
  cooldown_before integer,
  cooldown_after integer,
  applied_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.model7_b4_2_resolutions TO authenticated;
GRANT ALL ON public.model7_b4_2_resolutions TO service_role;
ALTER TABLE public.model7_b4_2_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b4_2_res_read_auth" ON public.model7_b4_2_resolutions FOR SELECT TO authenticated USING (true);

-- Extra tracking columns on the existing shadow table (variant='B4_2' rows will populate them)
ALTER TABLE public.model7_shadow
  ADD COLUMN IF NOT EXISTS b4_2_guard_fired boolean,
  ADD COLUMN IF NOT EXISTS b4_2_guard_reason text,
  ADD COLUMN IF NOT EXISTS b4_2_edge_score_before numeric,
  ADD COLUMN IF NOT EXISTS b4_2_cooldown_before integer,
  ADD COLUMN IF NOT EXISTS b4_2_date_mt text,
  ADD COLUMN IF NOT EXISTS b4_2_policy_version text,
  ADD COLUMN IF NOT EXISTS b4_2_last_two_no_results_json jsonb,
  ADD COLUMN IF NOT EXISTS b4_2_counterfactual_b2_result text,
  ADD COLUMN IF NOT EXISTS b4_2_b2_would_have_won boolean;

-- Atomic resolution application: single SQL function locks the state row,
-- applies cooldown decrement then edge_score update, appends no_history for
-- NO resolutions, and logs to resolutions (idempotent by resolution_id).
CREATE OR REPLACE FUNCTION public.apply_b4_2_resolution(
  p_resolution_id text,
  p_candle_ts timestamptz,
  p_date_mt text,
  p_b2_final_decision text,
  p_b2_result text,          -- 'WIN' | 'LOSS'
  p_resolved_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_symbol text := 'BTC-USDT';
  v_tf text := '15m';
  v_pol text := 'b4_2_v1';
  v_state model7_b4_2_state%ROWTYPE;
  v_edge_before numeric;
  v_cooldown_before integer;
  v_edge_after numeric;
  v_cooldown_after integer;
  v_delta numeric;
BEGIN
  -- Idempotency
  IF EXISTS (SELECT 1 FROM model7_b4_2_resolutions WHERE resolution_id = p_resolution_id) THEN
    RETURN jsonb_build_object('idempotent', true);
  END IF;

  -- Advisory lock keyed on (policy_version, date_mt) to serialize concurrent updates.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_pol || '|' || p_date_mt, 0));

  -- Load or create day state
  SELECT * INTO v_state FROM model7_b4_2_state
   WHERE symbol=v_symbol AND timeframe=v_tf AND policy_version=v_pol AND date_mt=p_date_mt
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO model7_b4_2_state (symbol, timeframe, policy_version, date_mt, edge_score, cooldown_remaining)
    VALUES (v_symbol, v_tf, v_pol, p_date_mt, 0, 0)
    RETURNING * INTO v_state;
  END IF;

  v_edge_before := v_state.edge_score;
  v_cooldown_before := v_state.cooldown_remaining;
  v_cooldown_after := v_cooldown_before;

  -- Probe decrement (step 5)
  IF v_cooldown_after > 0 THEN
    v_cooldown_after := GREATEST(v_cooldown_after - 1, 0);
  END IF;

  -- Edge score update (step 6): cap at 0
  v_delta := CASE WHEN p_b2_result = 'WIN' THEN 2 ELSE -3 END;
  v_edge_after := LEAST(0, v_edge_before + v_delta);

  -- Circuit trigger / re-arm (steps 7-8)
  IF v_cooldown_before = 0 AND v_edge_after <= -15 THEN
    v_cooldown_after := 8;
  ELSIF v_cooldown_before > 0 AND v_edge_after <= -15 THEN
    v_cooldown_after := 8;
  END IF;

  -- Append NO history
  IF p_b2_final_decision = 'NO' THEN
    INSERT INTO model7_b4_2_no_history (symbol, timeframe, policy_version, date_mt, candle_ts, b2_final_decision, result, resolution_id, resolved_at)
    VALUES (v_symbol, v_tf, v_pol, p_date_mt, p_candle_ts, 'NO', p_b2_result, p_resolution_id, p_resolved_at)
    ON CONFLICT (resolution_id) DO NOTHING;
  END IF;

  -- Persist audit
  INSERT INTO model7_b4_2_resolutions
    (resolution_id, policy_version, candle_ts, date_mt, b2_final_decision, b4_2_final_decision, counterfactual_b2_result, b4_2_skipped, edge_score_before, edge_score_after, cooldown_before, cooldown_after)
  VALUES
    (p_resolution_id, v_pol, p_candle_ts, p_date_mt, p_b2_final_decision, p_b2_final_decision, p_b2_result, false, v_edge_before, v_edge_after, v_cooldown_before, v_cooldown_after);

  UPDATE model7_b4_2_state
     SET edge_score = v_edge_after,
         cooldown_remaining = v_cooldown_after,
         last_processed_resolution_id = p_resolution_id,
         updated_at = now()
   WHERE id = v_state.id;

  RETURN jsonb_build_object(
    'idempotent', false,
    'edge_score_before', v_edge_before,
    'edge_score_after', v_edge_after,
    'cooldown_before', v_cooldown_before,
    'cooldown_after', v_cooldown_after
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_b4_2_resolution(text, timestamptz, text, text, text, timestamptz) TO service_role;
