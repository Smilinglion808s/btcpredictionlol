ALTER TABLE public.v6_predictions
  ADD COLUMN IF NOT EXISTS webhook_eligible boolean,
  ADD COLUMN IF NOT EXISTS webhook_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS webhook_suppressed_reason text,
  ADD COLUMN IF NOT EXISTS webhook_conflict_with_b4x4 boolean,
  ADD COLUMN IF NOT EXISTS b4x4_direction_at_send text;