UPDATE public.b4x4_es1_predictions p
SET dual_adaptive_result = CASE
      WHEN p.actual_direction IS NULL OR p.actual_direction = 'FLAT' THEN 'PUSH'
      WHEN p.actual_direction = p.dual_adaptive_candidate_direction THEN 'WIN'
      ELSE 'LOSS' END,
    dual_adaptive_result_score = CASE
      WHEN p.actual_direction IS NULL OR p.actual_direction = 'FLAT' THEN 0
      WHEN p.actual_direction = p.dual_adaptive_candidate_direction THEN 1
      ELSE -1 END
WHERE p.dual_adaptive_would_trade IS TRUE
  AND p.dual_adaptive_candidate_direction IS NOT NULL
  AND p.dual_adaptive_result = 'ABSTAIN'
  AND p.resolved_at IS NOT NULL;