SELECT cron.unschedule('btc-15m-post-close-resolve');

SELECT cron.schedule(
  'btc-15m-post-close-resolve',
  '3,18,33,48 * * * *',
  $$
  select net.http_post(
    url := 'https://project--23a724c5-6c5b-4434-85e6-dc54b111c7e2.lovable.app/api/public/hooks/scheduled-15m-run',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsZXZkenlpc2lieGN2d295cnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NjgzNjcsImV4cCI6MjA5ODM0NDM2N30.k6mUWZXJCwGR0cdv9W6zR2zs5lR9CX2M0jdEXgI-lvI"}'::jsonb,
    body := '{"phase":"resolve"}'::jsonb
  );
  $$
);