ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS config_hash text,
  ADD COLUMN IF NOT EXISTS agreement_gate_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreement_gate_reason text,
  ADD COLUMN IF NOT EXISTS final_trade_status text;

ALTER TABLE public.predictions_archive
  ADD COLUMN IF NOT EXISTS config_hash text,
  ADD COLUMN IF NOT EXISTS agreement_gate_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreement_gate_reason text,
  ADD COLUMN IF NOT EXISTS final_trade_status text;

CREATE INDEX IF NOT EXISTS predictions_config_hash_idx ON public.predictions (config_hash);
CREATE INDEX IF NOT EXISTS predictions_model_version_idx ON public.predictions (model_version);