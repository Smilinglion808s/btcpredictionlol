ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS units smallint,
  ADD COLUMN IF NOT EXISTS conviction_active boolean,
  ADD COLUMN IF NOT EXISTS conviction_reasons text[],
  ADD COLUMN IF NOT EXISTS conviction_direction text,
  ADD COLUMN IF NOT EXISTS conviction_aligned boolean,
  ADD COLUMN IF NOT EXISTS engine_version_hash text;

ALTER TABLE public.predictions_archive
  ADD COLUMN IF NOT EXISTS units smallint,
  ADD COLUMN IF NOT EXISTS conviction_active boolean,
  ADD COLUMN IF NOT EXISTS conviction_reasons text[],
  ADD COLUMN IF NOT EXISTS conviction_direction text,
  ADD COLUMN IF NOT EXISTS conviction_aligned boolean,
  ADD COLUMN IF NOT EXISTS engine_version_hash text;

INSERT INTO public.predictions_archive (
  id, symbol, timeframe, model_version, candle_ts, prediction, confidence,
  btc_price_at_prediction, setup_type, market_condition, reasoning_summary,
  full_ai_response, indicators, status,
  actual_next_candle_open, actual_next_candle_high, actual_next_candle_low, actual_next_candle_close,
  resolved_at, notes, created_at, api_model_id, archived_at, orderbook,
  input_candle_ts, input_candle_age_seconds, input_features_fresh, freshness_action,
  actual_direction, fetch_source, advance_check_passed,
  current_partial_minutes_elapsed, current_partial_snapshot,
  settlement_source, settlement_ticker, settlement_value,
  partial_snapshot_present, partial_snapshot_failure_reason, partial_completeness,
  partial_direction, partial_close_position_pct, partial_range_vs_atr, partial_vwap_event,
  partial_agreement, partial_module_bull_pts, partial_module_bear_pts,
  partial_veto_active, partial_veto_tier, partial_veto_direction, partial_hard_override_fired,
  conflict_downgrade_applied, degraded_mode, feed_mismatch, partial_fetch_source,
  config_hash, agreement_gate_applied, agreement_gate_reason, final_trade_status,
  base_bullish_score, base_bearish_score, bullish_score, bearish_score, score_margin,
  original_prediction_before_partial, changed_by_partial, change_reason, module_points, score_sum_mismatch,
  units, conviction_active, conviction_reasons, conviction_direction, conviction_aligned, engine_version_hash
)
SELECT
  id, symbol, timeframe, model_version, candle_ts, prediction, confidence,
  btc_price_at_prediction, setup_type, market_condition, reasoning_summary,
  full_ai_response, indicators, status,
  actual_next_candle_open, actual_next_candle_high, actual_next_candle_low, actual_next_candle_close,
  resolved_at, notes, created_at, api_model_id, now() AS archived_at, orderbook,
  input_candle_ts, input_candle_age_seconds, input_features_fresh, freshness_action,
  actual_direction, fetch_source, advance_check_passed,
  current_partial_minutes_elapsed, current_partial_snapshot,
  settlement_source, settlement_ticker, settlement_value,
  partial_snapshot_present, partial_snapshot_failure_reason, partial_completeness,
  partial_direction, partial_close_position_pct, partial_range_vs_atr, partial_vwap_event,
  partial_agreement, partial_module_bull_pts, partial_module_bear_pts,
  partial_veto_active, partial_veto_tier, partial_veto_direction, partial_hard_override_fired,
  conflict_downgrade_applied, degraded_mode, feed_mismatch, partial_fetch_source,
  config_hash, agreement_gate_applied, agreement_gate_reason, final_trade_status,
  base_bullish_score, base_bearish_score, bullish_score, bearish_score, score_margin,
  original_prediction_before_partial, changed_by_partial, change_reason, module_points, score_sum_mismatch,
  units, conviction_active, conviction_reasons, conviction_direction, conviction_aligned, engine_version_hash
FROM public.predictions
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.predictions;

-- Insert or update Model 6.0, copying required fields from whichever row is currently active.
INSERT INTO public.model_settings (
  model_version, api_model_id, is_active, auto_run_enabled,
  confidence_threshold, indicator_weights, prompt_template, require_manual_approval
)
SELECT
  '6.0', 'btc15m_model_6', false,
  COALESCE(prev.auto_run_enabled, true),
  COALESCE(prev.confidence_threshold, 60),
  COALESCE(prev.indicator_weights, '{}'::jsonb),
  'Model 6 uses the deterministic engine. LLM narrator only writes reasoning_summary.',
  false
FROM (
  SELECT auto_run_enabled, confidence_threshold, indicator_weights
  FROM public.model_settings
  ORDER BY is_active DESC, created_at DESC
  LIMIT 1
) prev
WHERE NOT EXISTS (SELECT 1 FROM public.model_settings WHERE model_version = '6.0');

UPDATE public.model_settings SET is_active = false WHERE model_version <> '6.0';
UPDATE public.model_settings SET is_active = true, api_model_id = 'btc15m_model_6' WHERE model_version = '6.0';