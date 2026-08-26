ALTER TABLE public.t10_bridge_samples
  ADD COLUMN IF NOT EXISTS bar_open_ts timestamptz,
  ADD COLUMN IF NOT EXISTS bar_close_ts timestamptz,
  ADD COLUMN IF NOT EXISTS venue text,
  ADD COLUMN IF NOT EXISTS symbol text,
  ADD COLUMN IF NOT EXISTS event_time timestamptz,
  ADD COLUMN IF NOT EXISTS final_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS build_identifier text;
ALTER TABLE public.t10_bridge_samples ALTER COLUMN bar_open_ms DROP NOT NULL;