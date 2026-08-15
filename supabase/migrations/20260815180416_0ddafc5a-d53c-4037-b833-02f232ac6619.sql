SELECT cron.unschedule('es1-boundary-run');

SELECT cron.schedule(
  'es1-boundary-run',
  '14,29,44,59 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--23a724c5-6c5b-4434-85e6-dc54b111c7e2.lovable.app/api/public/hooks/es1-boundary-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', current_setting('app.settings.supabase_anon_key', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);