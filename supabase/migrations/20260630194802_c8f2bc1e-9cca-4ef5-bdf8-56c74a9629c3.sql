
CREATE TABLE IF NOT EXISTS public.model_stats_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  total int NOT NULL,
  wins int NOT NULL,
  losses int NOT NULL,
  pushes int NOT NULL,
  pending int NOT NULL,
  win_rate numeric,
  avg_confidence numeric,
  stats jsonb
);
GRANT SELECT ON public.model_stats_archive TO anon, authenticated;
GRANT ALL ON public.model_stats_archive TO service_role;
ALTER TABLE public.model_stats_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read archive" ON public.model_stats_archive FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.model_stats_archive (model_version, total, wins, losses, pushes, pending, win_rate, avg_confidence, stats)
SELECT
  model_version,
  COUNT(*),
  COUNT(*) FILTER (WHERE status='win'),
  COUNT(*) FILTER (WHERE status='loss'),
  COUNT(*) FILTER (WHERE status='push'),
  COUNT(*) FILTER (WHERE status IN ('pending','manual_review')),
  CASE WHEN COUNT(*) FILTER (WHERE status IN ('win','loss')) = 0 THEN 0
       ELSE ROUND((COUNT(*) FILTER (WHERE status='win')::numeric /
                   COUNT(*) FILTER (WHERE status IN ('win','loss'))) * 100, 2) END,
  ROUND(AVG(confidence) FILTER (WHERE status IN ('win','loss')), 2),
  jsonb_build_object(
    'yes_total', COUNT(*) FILTER (WHERE prediction='YES'),
    'yes_wins',  COUNT(*) FILTER (WHERE prediction='YES' AND status='win'),
    'no_total',  COUNT(*) FILTER (WHERE prediction='NO'),
    'no_wins',   COUNT(*) FILTER (WHERE prediction='NO' AND status='win'),
    'first_at',  MIN(created_at),
    'last_at',   MAX(created_at)
  )
FROM public.predictions
GROUP BY model_version;

DELETE FROM public.predictions;
