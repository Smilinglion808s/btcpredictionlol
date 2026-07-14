
-- Fix B4.2 Daily Edge Guard cooldown state machine.
-- 1. Add explicit state flags.
ALTER TABLE public.model7_b4_2_state
  ADD COLUMN IF NOT EXISTS circuit_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS awaiting_probe_resolution boolean NOT NULL DEFAULT false;

-- Invariant: cooldown_remaining in [0, 8]
ALTER TABLE public.model7_b4_2_state
  DROP CONSTRAINT IF EXISTS model7_b4_2_state_cooldown_range_chk;
ALTER TABLE public.model7_b4_2_state
  ADD CONSTRAINT model7_b4_2_state_cooldown_range_chk
  CHECK (cooldown_remaining >= 0 AND cooldown_remaining <= 8);

-- Backfill circuit_active from existing rows.
UPDATE public.model7_b4_2_state
  SET circuit_active = (edge_score <= -15 OR cooldown_remaining > 0);

-- Release the currently stuck 2026-07-14 day so the probe path can progress.
-- (edge_score=-22 stays; cooldown reset to 0; circuit still active pending probe.)
UPDATE public.model7_b4_2_state
   SET cooldown_remaining = 0,
       awaiting_probe_resolution = false,
       circuit_active = true,
       updated_at = now()
 WHERE date_mt = '2026-07-14' AND policy_version = 'b4_2_v1';

-- 2. RPC to atomically arm a probe from scoring path.
CREATE OR REPLACE FUNCTION public.arm_b4_2_probe(
  p_date_mt text,
  p_prediction_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_symbol text := 'BTC-USDT';
  v_tf     text := '15m';
  v_pol    text := 'b4_2_v1';
  v_state  model7_b4_2_state%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(v_pol || '|' || p_date_mt, 0));
  SELECT * INTO v_state FROM model7_b4_2_state
   WHERE symbol=v_symbol AND timeframe=v_tf AND policy_version=v_pol AND date_mt=p_date_mt
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('armed', false, 'reason', 'no_state_row');
  END IF;
  -- Only arm if circuit is active, cooldown drained, and no probe outstanding.
  IF NOT v_state.circuit_active OR v_state.cooldown_remaining <> 0 OR v_state.awaiting_probe_resolution THEN
    RETURN jsonb_build_object(
      'armed', false,
      'circuit_active', v_state.circuit_active,
      'cooldown_remaining', v_state.cooldown_remaining,
      'awaiting_probe_resolution', v_state.awaiting_probe_resolution
    );
  END IF;
  UPDATE model7_b4_2_state
     SET awaiting_probe_resolution = true,
         updated_at = now()
   WHERE id = v_state.id;
  RETURN jsonb_build_object('armed', true, 'prediction_id', p_prediction_id);
END;
$$;

-- 3. Rewrite apply_b4_2_resolution with corrected transition rules.
CREATE OR REPLACE FUNCTION public.apply_b4_2_resolution(
  p_resolution_id text,
  p_candle_ts timestamp with time zone,
  p_date_mt text,
  p_b2_final_decision text,
  p_b2_result text,
  p_resolved_at timestamp with time zone
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_symbol text := 'BTC-USDT';
  v_tf     text := '15m';
  v_pol    text := 'b4_2_v1';
  v_state  model7_b4_2_state%ROWTYPE;
  v_edge_before numeric;
  v_cooldown_before integer;
  v_circuit_before boolean;
  v_awaiting_before boolean;
  v_edge_after numeric;
  v_cooldown_after integer;
  v_circuit_after boolean;
  v_awaiting_after boolean;
  v_delta numeric;
  v_is_probe boolean;
BEGIN
  -- Idempotency: never mutate state twice for the same resolution.
  IF EXISTS (SELECT 1 FROM model7_b4_2_resolutions WHERE resolution_id = p_resolution_id) THEN
    RETURN jsonb_build_object('idempotent', true);
  END IF;

  -- Serialize per (policy, day)
  PERFORM pg_advisory_xact_lock(hashtextextended(v_pol || '|' || p_date_mt, 0));

  SELECT * INTO v_state FROM model7_b4_2_state
   WHERE symbol=v_symbol AND timeframe=v_tf AND policy_version=v_pol AND date_mt=p_date_mt
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO model7_b4_2_state (symbol, timeframe, policy_version, date_mt, edge_score, cooldown_remaining, circuit_active, awaiting_probe_resolution)
    VALUES (v_symbol, v_tf, v_pol, p_date_mt, 0, 0, false, false)
    RETURNING * INTO v_state;
  END IF;

  v_edge_before     := v_state.edge_score;
  v_cooldown_before := v_state.cooldown_remaining;
  v_circuit_before  := v_state.circuit_active;
  v_awaiting_before := v_state.awaiting_probe_resolution;

  -- Update edge score first (capped at 0).
  v_delta      := CASE WHEN p_b2_result = 'WIN' THEN 2 ELSE -3 END;
  v_edge_after := LEAST(0, v_edge_before + v_delta);

  v_is_probe        := v_awaiting_before;
  v_cooldown_after  := v_cooldown_before;
  v_circuit_after   := v_circuit_before;
  v_awaiting_after  := v_awaiting_before;

  IF v_is_probe THEN
    -- Probe result decides re-arm vs release.
    v_awaiting_after := false;
    IF v_edge_after <= -15 THEN
      v_cooldown_after := 8;
      v_circuit_after  := true;
    ELSE
      v_cooldown_after := 0;
      v_circuit_after  := false;
    END IF;
  ELSIF v_circuit_before THEN
    -- Mid-cooldown resolution: consume one signal, DO NOT re-arm.
    IF v_cooldown_before > 0 THEN
      v_cooldown_after := v_cooldown_before - 1;
    END IF;
    -- circuit_active stays true until probe releases it.
  ELSE
    -- Circuit inactive: arm on threshold crossing.
    IF v_edge_after <= -15 THEN
      v_cooldown_after := 8;
      v_circuit_after  := true;
    END IF;
  END IF;

  -- Invariants
  v_cooldown_after := GREATEST(0, LEAST(8, v_cooldown_after));

  -- NO-history append (base skips are excluded because caller only invokes on YES/NO).
  IF p_b2_final_decision = 'NO' THEN
    INSERT INTO model7_b4_2_no_history (symbol, timeframe, policy_version, date_mt, candle_ts, b2_final_decision, result, resolution_id, resolved_at)
    VALUES (v_symbol, v_tf, v_pol, p_date_mt, p_candle_ts, 'NO', p_b2_result, p_resolution_id, p_resolved_at)
    ON CONFLICT (resolution_id) DO NOTHING;
  END IF;

  INSERT INTO model7_b4_2_resolutions
    (resolution_id, policy_version, candle_ts, date_mt, b2_final_decision, b4_2_final_decision, counterfactual_b2_result, b4_2_skipped, edge_score_before, edge_score_after, cooldown_before, cooldown_after)
  VALUES
    (p_resolution_id, v_pol, p_candle_ts, p_date_mt, p_b2_final_decision, p_b2_final_decision, p_b2_result, false, v_edge_before, v_edge_after, v_cooldown_before, v_cooldown_after);

  UPDATE model7_b4_2_state
     SET edge_score = v_edge_after,
         cooldown_remaining = v_cooldown_after,
         circuit_active = v_circuit_after,
         awaiting_probe_resolution = v_awaiting_after,
         last_processed_resolution_id = p_resolution_id,
         updated_at = now()
   WHERE id = v_state.id;

  RETURN jsonb_build_object(
    'idempotent', false,
    'is_probe', v_is_probe,
    'edge_score_before', v_edge_before,
    'edge_score_after',  v_edge_after,
    'cooldown_before',   v_cooldown_before,
    'cooldown_after',    v_cooldown_after,
    'circuit_active',    v_circuit_after,
    'awaiting_probe_resolution', v_awaiting_after
  );
END;
$$;
