-- Hot-path indexes for the stats/history reads that currently sequential-scan
-- very wide tables and burn disk IO.

CREATE INDEX IF NOT EXISTS b4x4_predictions_version_variant_target_idx
  ON public.b4x4_predictions (model_version, variant, target_candle_ts);

CREATE INDEX IF NOT EXISTS b4x4_predictions_unresolved_target_idx
  ON public.b4x4_predictions (target_candle_ts)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS model7_td1_rc_shadow_variant_candle_idx
  ON public.model7_td1_rc_shadow (variant, candle_ts DESC);

CREATE INDEX IF NOT EXISTS model7_td1_rc_shadow_unresolved_candle_idx
  ON public.model7_td1_rc_shadow (candle_ts)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS v6_predictions_created_idx
  ON public.v6_predictions (prediction_created_at);

CREATE INDEX IF NOT EXISTS predictions_version_direction_idx
  ON public.predictions (model_version, actual_direction);

CREATE INDEX IF NOT EXISTS predictions_version_candle_idx
  ON public.predictions (model_version, candle_ts);

CREATE INDEX IF NOT EXISTS predictions_archive_created_idx
  ON public.predictions_archive (created_at DESC);
