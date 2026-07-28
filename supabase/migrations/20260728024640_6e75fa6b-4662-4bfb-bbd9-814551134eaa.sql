
ALTER TABLE public.a96_predictions
  ADD COLUMN IF NOT EXISTS layer_a_prob_mean double precision,
  ADD COLUMN IF NOT EXISTS layer_a_prob_margin double precision,
  ADD COLUMN IF NOT EXISTS layer_a_probability_valid boolean,
  ADD COLUMN IF NOT EXISTS margin_band_min double precision,
  ADD COLUMN IF NOT EXISTS margin_band_max double precision,
  ADD COLUMN IF NOT EXISTS margin_band_eligible boolean,
  ADD COLUMN IF NOT EXISTS margin_veto_fired boolean;
