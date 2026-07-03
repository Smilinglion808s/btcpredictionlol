ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS orderbook jsonb;
ALTER TABLE public.predictions_archive ADD COLUMN IF NOT EXISTS orderbook jsonb;