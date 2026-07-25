CREATE TABLE IF NOT EXISTS public.a96_visual_stats_reset (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason TEXT
);

GRANT SELECT ON public.a96_visual_stats_reset TO authenticated;
GRANT ALL ON public.a96_visual_stats_reset TO service_role;

ALTER TABLE public.a96_visual_stats_reset ENABLE ROW LEVEL SECURITY;

CREATE POLICY "a96_visual_stats_reset read"
    ON public.a96_visual_stats_reset
    FOR SELECT
    TO authenticated
    USING (true);

-- Initialize / refresh the reset timestamp now so the Stats page counters start from zero.
INSERT INTO public.a96_visual_stats_reset (id, reset_at, reason)
VALUES (1, NOW(), 'user-requested-visual-reset')
ON CONFLICT (id) DO UPDATE SET
    reset_at = NOW(),
    reason = EXCLUDED.reason;
