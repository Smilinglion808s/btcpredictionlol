ALTER TABLE public.b4x4_es1_balanced_shadows
  ADD COLUMN IF NOT EXISTS webhook_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS spot_final_imbalance_10bps double precision,
  ADD COLUMN IF NOT EXISTS spot_mean_imbalance_10bps_60s double precision,
  ADD COLUMN IF NOT EXISTS perp_final_imbalance_10bps double precision,
  ADD COLUMN IF NOT EXISTS perp_mean_imbalance_10bps_60s double precision,
  ADD COLUMN IF NOT EXISTS primary_result_score double precision,
  ADD COLUMN IF NOT EXISTS incremental_value double precision;

ALTER TABLE public.b4x4_es1_balanced_shadows
  ADD CONSTRAINT b4x4_es1_balanced_shadows_never_webhook
  CHECK (webhook_eligible = false AND webhook_sent = false) NOT VALID;