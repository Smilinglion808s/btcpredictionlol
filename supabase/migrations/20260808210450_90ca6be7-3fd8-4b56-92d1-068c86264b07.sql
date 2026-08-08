CREATE TABLE IF NOT EXISTS public.b4x4_ob_capture_auth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.b4x4_ob_capture_auth TO service_role;
ALTER TABLE public.b4x4_ob_capture_auth ENABLE ROW LEVEL SECURITY;

INSERT INTO public.b4x4_ob_capture_auth (name, secret)
VALUES ('cron', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.b4x4_ob_capture_call()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret text;
  v_ts text;
  v_target timestamptz;
  v_sig text;
BEGIN
  SELECT secret INTO v_secret FROM public.b4x4_ob_capture_auth WHERE name = 'cron';
  IF v_secret IS NULL THEN RETURN; END IF;

  v_ts := (extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  -- Canonical next 15-minute boundary, matching the server-side derivation.
  v_target := date_trunc('hour', clock_timestamp())
              + (ceil(extract(epoch from (clock_timestamp() - date_trunc('hour', clock_timestamp()))) / 900.0) * interval '15 minutes');

  v_sig := encode(
    extensions.hmac(
      v_ts || '.' || to_char(v_target at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      v_secret,
      'sha256'
    ),
    'hex'
  );

  PERFORM net.http_post(
    url := 'https://project--23a724c5-6c5b-4434-85e6-dc54b111c7e2.lovable.app/api/public/hooks/b4x4-ob-shadow-capture',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-b4x4-timestamp', v_ts,
      'x-b4x4-signature', v_sig
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.b4x4_ob_capture_call() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b4x4_ob_capture_call() TO service_role;