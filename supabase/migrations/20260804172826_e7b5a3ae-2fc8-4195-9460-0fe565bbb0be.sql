CREATE TABLE IF NOT EXISTS public.v6_visual_stats_reset (
  id integer PRIMARY KEY,
  reset_at timestamptz NOT NULL DEFAULT now(),
  reason text
);
GRANT SELECT ON public.v6_visual_stats_reset TO authenticated;
GRANT ALL ON public.v6_visual_stats_reset TO service_role;
ALTER TABLE public.v6_visual_stats_reset ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v6_visual_stats_reset_read" ON public.v6_visual_stats_reset FOR SELECT TO authenticated USING (true);