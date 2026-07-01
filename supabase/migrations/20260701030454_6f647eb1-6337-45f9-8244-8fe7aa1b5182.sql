
-- Public read access to predictions for the API endpoints
GRANT SELECT ON public.predictions TO anon;
DROP POLICY IF EXISTS "Public can read predictions" ON public.predictions;
CREATE POLICY "Public can read predictions" ON public.predictions FOR SELECT TO anon USING (true);

-- Webhook endpoints
CREATE TABLE public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL DEFAULT ARRAY['prediction.created','prediction.resolved'],
  is_active boolean NOT NULL DEFAULT true,
  last_delivery_at timestamptz,
  last_status int,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.webhook_endpoints TO service_role;
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

-- Delivery log
CREATE TABLE public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status_code int,
  response_body text,
  error text,
  attempt int NOT NULL DEFAULT 1,
  delivered_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.webhook_deliveries TO service_role;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
