ALTER TABLE public.a96_predictions
  ADD COLUMN IF NOT EXISTS four_candle_net_displacement double precision,
  ADD COLUMN IF NOT EXISTS four_candle_total_body_path double precision,
  ADD COLUMN IF NOT EXISTS four_candle_path_efficiency double precision,
  ADD COLUMN IF NOT EXISTS efficiency_veto_min double precision,
  ADD COLUMN IF NOT EXISTS efficiency_veto_max double precision,
  ADD COLUMN IF NOT EXISTS efficiency_veto_condition boolean,
  ADD COLUMN IF NOT EXISTS efficiency_veto_fired boolean;