ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS settlement_source text,
  ADD COLUMN IF NOT EXISTS settlement_ticker text,
  ADD COLUMN IF NOT EXISTS settlement_value numeric;

ALTER TABLE public.predictions_archive
  ADD COLUMN IF NOT EXISTS settlement_source text,
  ADD COLUMN IF NOT EXISTS settlement_ticker text,
  ADD COLUMN IF NOT EXISTS settlement_value numeric;