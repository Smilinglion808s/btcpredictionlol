ALTER TABLE public.t10_collector_health
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_bar_close_ts timestamptz,
  ADD COLUMN IF NOT EXISTS last_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS build_identifier text;