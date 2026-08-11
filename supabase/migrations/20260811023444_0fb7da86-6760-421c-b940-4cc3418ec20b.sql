CREATE OR REPLACE FUNCTION public.b4x4_ob_capture_call()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_secret text;
  v_ts text;
  v_target timestamptz;
  v_sig text;
  v_headers jsonb;
BEGIN
  v_ts := (extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  v_target := date_trunc('hour', clock_timestamp())
              + (ceil(extract(epoch from (clock_timestamp() - date_trunc('hour', clock_timestamp()))) / 900.0) * interval '15 minutes');

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsZXZkenlpc2lieGN2d295cnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NjgzNjcsImV4cCI6MjA5ODM0NDM2N30.k6mUWZXJCwGR0cdv9W6zR2zs5lR9CX2M0jdEXgI-lvI'
  );

  SELECT secret INTO v_secret FROM public.b4x4_ob_capture_auth WHERE name = 'cron';
  IF v_secret IS NOT NULL THEN
    v_sig := encode(
      extensions.hmac(
        v_ts || '.' || to_char(v_target at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        v_secret,
        'sha256'
      ),
      'hex'
    );
    v_headers := v_headers
      || jsonb_build_object('x-b4x4-timestamp', v_ts, 'x-b4x4-signature', v_sig);
  END IF;

  PERFORM net.http_post(
    url := 'https://project--23a724c5-6c5b-4434-85e6-dc54b111c7e2.lovable.app/api/public/hooks/b4x4-ob-shadow-capture',
    headers := v_headers,
    body := '{}'::jsonb
  );
END;
$function$;