CREATE TABLE public.v3_kalshi_settlements (
  candle_open timestamptz PRIMARY KEY,
  ticker text NOT NULL,
  final boolean NOT NULL DEFAULT false,
  result text CHECK (result IN ('yes','no')),
  close_time timestamptz,
  settlement_ts timestamptz,
  expiration_value text,
  source_endpoint text,
  raw jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v3_kalshi_final_valid CHECK (NOT final OR (result IS NOT NULL AND close_time = candle_open + interval '15 minutes'))
);
REVOKE ALL ON public.v3_kalshi_settlements FROM anon, authenticated;
GRANT ALL ON public.v3_kalshi_settlements TO service_role;
ALTER TABLE public.v3_kalshi_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.v3_kalshi_settlements FOR ALL TO service_role USING (true) WITH CHECK (true);