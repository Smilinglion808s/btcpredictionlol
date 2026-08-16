ALTER TABLE public.b4x4_es1_binance_ob_boundary_features DROP COLUMN IF EXISTS history_count_96;

ALTER TABLE public.b4x4_es1_binance_ob_collector_health
  ADD COLUMN IF NOT EXISTS deployment_id text,
  ADD COLUMN IF NOT EXISTS last_event text,
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS sequence_gap_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planned_rollover_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS snapshot_sync_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS region_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS heartbeat_interval_ms integer NOT NULL DEFAULT 5000;

ALTER TABLE public.b4x4_es1_predictions
  ADD COLUMN IF NOT EXISTS binance_ob_run_mode text,
  ADD COLUMN IF NOT EXISTS binance_ob_capture_status text,
  ADD COLUMN IF NOT EXISTS binance_ob_ready boolean,
  ADD COLUMN IF NOT EXISTS binance_ob_ready_reason text,
  ADD COLUMN IF NOT EXISTS binance_ob_history_ready boolean,
  ADD COLUMN IF NOT EXISTS binance_ob_history_valid_count smallint,
  ADD COLUMN IF NOT EXISTS binance_ob_final_imbalance_10bps double precision,
  ADD COLUMN IF NOT EXISTS binance_ob_abs_percentile_96 double precision,
  ADD COLUMN IF NOT EXISTS binance_ob_sign_persistence_15s double precision,
  ADD COLUMN IF NOT EXISTS binance_ob_influenced_decision boolean NOT NULL DEFAULT false;

SELECT cron.schedule(
  'binance-ob-finalize',
  '2,17,32,47 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--23a724c5-6c5b-4434-85e6-dc54b111c7e2.lovable.app/api/public/hooks/binance-ob-finalize',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsZXZkenlpc2lieGN2d295cnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NjgzNjcsImV4cCI6MjA5ODM0NDM2N30.k6mUWZXJCwGR0cdv9W6zR2zs5lR9CX2M0jdEXgI-lvI'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);