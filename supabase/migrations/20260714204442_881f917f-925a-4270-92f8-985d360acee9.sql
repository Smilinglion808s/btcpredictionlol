
ALTER TABLE public.model_c_shadow
  ADD COLUMN IF NOT EXISTS predicted_direction text,
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS override_applied boolean,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS blend_weight_global numeric(6,4),
  ADD COLUMN IF NOT EXISTS blend_weight_recent numeric(6,4),
  ADD COLUMN IF NOT EXISTS ensemble_threshold numeric(6,4),
  ADD COLUMN IF NOT EXISTS ensemble_delta numeric(12,10),
  ADD COLUMN IF NOT EXISTS prospective_test_id text;

CREATE INDEX IF NOT EXISTS model_c_shadow_prospective_test_idx
  ON public.model_c_shadow (prospective_test_id, candle_ts DESC);
