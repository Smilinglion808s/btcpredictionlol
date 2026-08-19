-- Reporting-only attribution repair for B4x4-ES1 precision legs.
-- No decisions, sleeves, directions, OHLC, eligibility, activation or webhooks touched.

-- 1) Pre-policy rows (no would_trade recorded) must stay unscored.
UPDATE public.b4x4_es1_predictions
SET precision_result = NULL,
    precision_result_score = NULL,
    precision_balanced_result = NULL,
    precision_balanced_result_score = NULL
WHERE precision_would_trade IS NULL
  AND (precision_result IS NOT NULL OR precision_result_score IS NOT NULL
       OR precision_balanced_result IS NOT NULL OR precision_balanced_result_score IS NOT NULL);

-- 2) No-trade rows are ABSTAIN/0, never PUSH.
UPDATE public.b4x4_es1_predictions
SET precision_result = 'ABSTAIN',
    precision_result_score = 0
WHERE precision_would_trade = false
  AND precision_result IS DISTINCT FROM 'ABSTAIN'
  AND precision_result IS NOT NULL;

UPDATE public.b4x4_es1_predictions
SET precision_balanced_result = 'ABSTAIN',
    precision_balanced_result_score = 0
WHERE precision_balanced_would_trade = false
  AND precision_balanced_result IS DISTINCT FROM 'ABSTAIN'
  AND precision_balanced_result IS NOT NULL;

-- 3) Traded rows with no usable direction are ABSTAIN, not PUSH.
UPDATE public.b4x4_es1_predictions
SET precision_result = 'ABSTAIN',
    precision_result_score = 0
WHERE precision_would_trade = true
  AND precision_candidate_direction NOT IN ('GREEN','RED')
  AND precision_result = 'PUSH';

UPDATE public.b4x4_es1_predictions
SET precision_balanced_result = 'ABSTAIN',
    precision_balanced_result_score = 0
WHERE precision_balanced_would_trade = true
  AND precision_balanced_direction NOT IN ('GREEN','RED')
  AND precision_balanced_result = 'PUSH';