ALTER TABLE public.v11_decisions
  ADD COLUMN IF NOT EXISTS event_cutoff_offset_ms integer,
  ADD COLUMN IF NOT EXISTS inputs_persisted_offset_ms integer,
  ADD COLUMN IF NOT EXISTS decision_offset_ms integer,
  ADD COLUMN IF NOT EXISTS publication_ceiling_ms integer,
  ADD COLUMN IF NOT EXISTS within_publication_ceiling boolean;