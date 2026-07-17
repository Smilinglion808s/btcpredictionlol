-- Seed AAS96 warmup counter from already-resolved directional predictions
-- so the model exits WARMUP on the next candle resolution and trains
-- against the existing predictions + predictions_archive history.
INSERT INTO public.model7_aas96_state (id, resolved_directional_count, next_retrain_at_count, updated_at)
VALUES (
  1,
  (
    (SELECT COUNT(*) FROM public.predictions        WHERE status IN ('win','loss'))
    +
    (SELECT COUNT(*) FROM public.predictions_archive WHERE status IN ('win','loss'))
  ),
  192,
  now()
)
ON CONFLICT (id) DO UPDATE
SET resolved_directional_count = EXCLUDED.resolved_directional_count,
    next_retrain_at_count = 192,
    updated_at = now();