
ALTER TABLE public.model7_aas96_shadow
  ADD COLUMN IF NOT EXISTS target_candle_ts timestamptz,
  ADD COLUMN IF NOT EXISTS input_candle_ts timestamptz,
  ADD COLUMN IF NOT EXISTS continuity_delta_seconds numeric,
  ADD COLUMN IF NOT EXISTS continuity_gate_passed boolean,
  ADD COLUMN IF NOT EXISTS snapshot_minutes_elapsed numeric,
  ADD COLUMN IF NOT EXISTS snapshot_belongs_to_prior_candle boolean,
  ADD COLUMN IF NOT EXISTS usable_training_row boolean;

ALTER TABLE public.model7_aas96_state
  ADD COLUMN IF NOT EXISTS usable_training_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS market_directional_resolutions integer NOT NULL DEFAULT 0;
