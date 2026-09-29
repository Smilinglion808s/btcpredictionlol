CREATE TABLE public.v2_forward_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.v2_forward_settings TO service_role;
ALTER TABLE public.v2_forward_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.v2_forward_settings(id, enabled) VALUES (true, false);

CREATE TABLE public.v2_forward_outbox (
  candle_open timestamptz PRIMARY KEY REFERENCES public.v2_candle_intents(candle_open),
  dedupe_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','sending','sent','rejected','expired','disabled')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  response_status int,
  response_ms int,
  decision_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.v2_forward_outbox TO service_role;
ALTER TABLE public.v2_forward_outbox ENABLE ROW LEVEL SECURITY;

-- Enqueue in the same transaction that creates the single candle intent.
CREATE OR REPLACE FUNCTION public.v2_enqueue_forward()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c public.v2_checkpoints;
  v_on boolean;
  v_status text;
BEGIN
  SELECT * INTO c FROM public.v2_checkpoints WHERE id = NEW.checkpoint_id;
  SELECT enabled INTO v_on FROM public.v2_forward_settings WHERE id;
  v_status := CASE
    WHEN NOT coalesce(v_on, false) THEN 'disabled'
    WHEN pg_catalog.now() > c.decision_at + interval '120 seconds' THEN 'expired'
    ELSE 'pending' END;
  INSERT INTO public.v2_forward_outbox(candle_open, dedupe_key, payload, status, decision_at)
  VALUES (NEW.candle_open, 'v2-final-r1:' || pg_catalog.to_char(NEW.candle_open AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    pg_catalog.jsonb_build_object(
      'schema', 'v2-bet-signal/1',
      'model_version', NEW.model_version,
      'dedupe_key', 'v2-final-r1:' || pg_catalog.to_char(NEW.candle_open AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'candle_open', pg_catalog.to_char(NEW.candle_open AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'candle_close', pg_catalog.to_char((NEW.candle_open + interval '15 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'side', CASE WHEN NEW.side = 1 THEN 'UP' ELSE 'DOWN' END,
      'sleeve', NEW.sleeve,
      'checkpoint', c.checkpoint,
      'probability', c.probability,
      'decision_at', pg_catalog.to_char(c.decision_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'stake_policy', NEW.stake_policy),
    v_status, c.decision_at)
  ON CONFLICT (candle_open) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.v2_enqueue_forward() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER v2_candle_intents_enqueue_forward AFTER INSERT ON public.v2_candle_intents
  FOR EACH ROW EXECUTE FUNCTION public.v2_enqueue_forward();