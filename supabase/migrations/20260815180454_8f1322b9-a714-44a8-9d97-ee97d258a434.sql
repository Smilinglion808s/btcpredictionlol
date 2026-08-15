SELECT cron.unschedule('es1-boundary-run');

SELECT cron.schedule(
  'es1-boundary-run',
  '14,29,44,59 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--23a724c5-6c5b-4434-85e6-dc54b111c7e2.lovable.app/api/public/hooks/es1-boundary-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsZXZkenlpc2lieGN2d295cnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NjgzNjcsImV4cCI6MjA5ODM0NDM2N30.k6mUWZXJCwGR0cdv9W6zR2zs5lR9CX2M0jdEXgI-lvI'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);