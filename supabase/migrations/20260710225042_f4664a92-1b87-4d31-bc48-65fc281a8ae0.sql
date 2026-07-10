
ALTER TABLE public.model7_shadow
  ADD COLUMN IF NOT EXISTS prediction_row_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prediction_row_lead_ms BIGINT;
