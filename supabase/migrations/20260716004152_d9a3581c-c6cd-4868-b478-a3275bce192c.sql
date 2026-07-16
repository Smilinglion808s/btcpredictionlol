
ALTER TABLE public.model_c_shadow
  ADD COLUMN IF NOT EXISTS raw_direction              text,
  ADD COLUMN IF NOT EXISTS raw_counterfactual_result  text,
  ADD COLUMN IF NOT EXISTS rolling_window_size        integer,
  ADD COLUMN IF NOT EXISTS rolling_raw_wins           integer,
  ADD COLUMN IF NOT EXISTS rolling_raw_losses         integer,
  ADD COLUMN IF NOT EXISTS rolling_raw_edge           integer,
  ADD COLUMN IF NOT EXISTS polarity_state             text,
  ADD COLUMN IF NOT EXISTS controller_decision        text,
  ADD COLUMN IF NOT EXISTS controller_skip_reason     text,
  ADD COLUMN IF NOT EXISTS history_cutoff_ts          timestamptz,
  ADD COLUMN IF NOT EXISTS latest_resolution_ts_used  timestamptz,
  ADD COLUMN IF NOT EXISTS timing_guard_passed        boolean,
  ADD COLUMN IF NOT EXISTS controller_error           text,
  ADD COLUMN IF NOT EXISTS controller_model_version   text;

-- Backfill raw_direction from ensemble_probability_green (>= 0.52 => YES) for
-- all rows that have a probability. This mirrors the PRC contract exactly and
-- matches the existing base_decision on non-blocked rows.
UPDATE public.model_c_shadow
   SET raw_direction = CASE WHEN ensemble_probability_green >= 0.52 THEN 'YES' ELSE 'NO' END
 WHERE raw_direction IS NULL
   AND ensemble_probability_green IS NOT NULL;

-- Backfill counterfactual raw result for resolved rows.
UPDATE public.model_c_shadow
   SET raw_counterfactual_result = CASE
         WHEN actual_direction NOT IN ('GREEN','RED') THEN NULL
         WHEN raw_direction = 'YES' AND actual_direction = 'GREEN' THEN 'WIN'
         WHEN raw_direction = 'NO'  AND actual_direction = 'RED'   THEN 'WIN'
         WHEN raw_direction IN ('YES','NO')                        THEN 'LOSS'
         ELSE NULL
       END
 WHERE raw_counterfactual_result IS NULL
   AND raw_direction IS NOT NULL
   AND actual_direction IN ('GREEN','RED');

CREATE INDEX IF NOT EXISTS model_c_shadow_prc_history_idx
  ON public.model_c_shadow (variant, resolved_at DESC)
  WHERE raw_counterfactual_result IN ('WIN','LOSS');
