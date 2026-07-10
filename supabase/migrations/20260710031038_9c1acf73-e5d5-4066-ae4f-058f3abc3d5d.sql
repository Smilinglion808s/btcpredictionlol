UPDATE public.model7_shadow s
SET status = CASE
      WHEN s.decision = 'SKIP' THEN 'skipped'
      WHEN s.decision = 'YES'  THEN 'win'   -- actual GREEN
      WHEN s.decision = 'NO'   THEN 'loss'
      ELSE 'skipped'
    END,
    actual_direction = 'GREEN',
    resolved_at = now()
WHERE s.status = 'pending'
  AND s.prediction_id = 'ecf2beae-cbff-4f7d-84b9-f28fe738e068';