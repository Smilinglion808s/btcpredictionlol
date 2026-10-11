ALTER TABLE public.v3_kalshi_settlements ADD CONSTRAINT v3_kalshi_final_complete
  CHECK (NOT final OR (result IS NOT NULL AND close_time IS NOT NULL AND close_time = candle_open + interval '15 minutes')) NOT VALID;
ALTER TABLE public.v3_kalshi_settlements VALIDATE CONSTRAINT v3_kalshi_final_complete;

-- Atomic, monotonic cache write: a finalized row is never overwritten or downgraded.
CREATE OR REPLACE FUNCTION public.v3_kalshi_record(p jsonb)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  WITH w AS (
    INSERT INTO public.v3_kalshi_settlements AS s
      (candle_open, ticker, final, result, close_time, settlement_ts, expiration_value, source_endpoint, raw,
       attempts, last_attempt_at, next_retry_at, last_error, updated_at)
    VALUES ((p->>'candle_open')::timestamptz, p->>'ticker', (p->>'final')::boolean, p->>'result',
       (p->>'close_time')::timestamptz, (p->>'settlement_ts')::timestamptz, p->>'expiration_value',
       p->>'source_endpoint', p->'raw', 1, (p->>'last_attempt_at')::timestamptz,
       (p->>'next_retry_at')::timestamptz, p->>'last_error', now())
    ON CONFLICT (candle_open) DO UPDATE SET
      ticker = excluded.ticker, final = excluded.final, result = excluded.result, close_time = excluded.close_time,
      settlement_ts = excluded.settlement_ts, expiration_value = excluded.expiration_value,
      source_endpoint = excluded.source_endpoint, raw = excluded.raw, attempts = s.attempts + 1,
      last_attempt_at = excluded.last_attempt_at,
      next_retry_at = CASE WHEN excluded.final THEN NULL
        ELSE excluded.last_attempt_at + make_interval(secs => least(3600, 60 * power(2, least(s.attempts, 6)))) END,
      last_error = excluded.last_error, updated_at = now()
    WHERE NOT s.final
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM w);
$$;
REVOKE ALL ON FUNCTION public.v3_kalshi_record(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v3_kalshi_record(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.v3_kalshi_no_downgrade() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.final THEN RAISE EXCEPTION 'v3_kalshi_settlements: finalized row is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER v3_kalshi_no_downgrade BEFORE UPDATE ON public.v3_kalshi_settlements
  FOR EACH ROW EXECUTE FUNCTION public.v3_kalshi_no_downgrade();