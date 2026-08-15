CREATE TABLE IF NOT EXISTS public.b4x4_es1_activation (
  id text PRIMARY KEY,
  model_version text NOT NULL,
  activation_target_ts timestamptz NOT NULL,
  activation_set_at timestamptz NOT NULL DEFAULT now(),
  forward_test_sequence_number integer NOT NULL DEFAULT 0,
  activation_readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT ON public.b4x4_es1_activation TO authenticated;
GRANT ALL ON public.b4x4_es1_activation TO service_role;

ALTER TABLE public.b4x4_es1_activation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "es1 activation readable by authenticated"
ON public.b4x4_es1_activation FOR SELECT TO authenticated USING (true);