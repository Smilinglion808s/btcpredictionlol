ALTER TABLE public.b4x4_es1_binance_ob_observations
  DROP CONSTRAINT IF EXISTS binance_ob_observation_time_order,
  DROP CONSTRAINT IF EXISTS binance_ob_receive_pre_target;

ALTER TABLE public.b4x4_es1_binance_ob_observations
  ADD CONSTRAINT binance_ob_cutoff_exact
    CHECK (feature_cutoff_ts = target_ts - interval '2 seconds'),
  ADD CONSTRAINT binance_ob_sample_window
    CHECK (sample_ts <= feature_cutoff_ts AND sample_ts >= target_ts - interval '60 seconds'),
  ADD CONSTRAINT binance_ob_receive_cutoff
    CHECK (received_at IS NULL OR received_at <= feature_cutoff_ts);

ALTER TABLE public.b4x4_es1_binance_ob_boundary_features
  ADD COLUMN IF NOT EXISTS history_valid_count integer,
  ADD COLUMN IF NOT EXISTS watchdog_created boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS failure_reason text;

ALTER TABLE public.b4x4_es1_binance_ob_boundary_features
  DROP CONSTRAINT IF EXISTS binance_ob_boundary_receive_cutoff;

ALTER TABLE public.b4x4_es1_binance_ob_boundary_features
  ADD CONSTRAINT binance_ob_boundary_receive_cutoff
    CHECK (final_received_at IS NULL OR final_received_at <= feature_cutoff_ts);