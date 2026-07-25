CREATE TABLE IF NOT EXISTS public.td1_rc_visual_stats_reset (
  id INTEGER PRIMARY KEY DEFAULT 1,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT td1_rc_visual_stats_reset_singleton CHECK (id = 1)
);
GRANT ALL ON public.td1_rc_visual_stats_reset TO service_role;
ALTER TABLE public.td1_rc_visual_stats_reset ENABLE ROW LEVEL SECURITY;
INSERT INTO public.td1_rc_visual_stats_reset (id, reset_at, reason)
VALUES (1, now(), 'initial-seed')
ON CONFLICT (id) DO NOTHING;