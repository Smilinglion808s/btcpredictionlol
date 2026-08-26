CREATE TABLE IF NOT EXISTS public.webhook_cascade_claims (
  target_ts TIMESTAMPTZ PRIMARY KEY,
  model TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.webhook_cascade_claims TO authenticated;
GRANT ALL ON public.webhook_cascade_claims TO service_role;
ALTER TABLE public.webhook_cascade_claims ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webhook_cascade_claims' AND policyname='cascade claims readable') THEN
    CREATE POLICY "cascade claims readable" ON public.webhook_cascade_claims FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
UPDATE public.t30_pf_activation SET webhooks_enabled = true;
UPDATE public.t45_pf_activation SET webhooks_enabled = true;