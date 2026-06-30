
-- Deduplicate existing rows: keep the latest per (symbol, timeframe, model_version, candle_ts)
DELETE FROM public.predictions p
USING public.predictions q
WHERE p.symbol = q.symbol
  AND p.timeframe = q.timeframe
  AND p.model_version = q.model_version
  AND p.candle_ts = q.candle_ts
  AND p.created_at < q.created_at;

-- Enforce uniqueness going forward
CREATE UNIQUE INDEX IF NOT EXISTS predictions_unique_per_candle
  ON public.predictions (symbol, timeframe, model_version, candle_ts);

-- Re-schedule cron jobs with a phase flag so only pre-close predicts
SELECT cron.unschedule('btc-15m-pre-close');
SELECT cron.unschedule('btc-15m-post-close-resolve');

SELECT cron.schedule(
  'btc-15m-pre-close',
  '14,29,44,59 * * * *',
  $$
  select net.http_post(
    url := 'https://project--23a724c5-6c5b-4434-85e6-dc54b111c7e2.lovable.app/api/public/hooks/scheduled-15m-run',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsZXZkenlpc2lieGN2d295cnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NjgzNjcsImV4cCI6MjA5ODM0NDM2N30.k6mUWZXJCwGR0cdv9W6zR2zs5lR9CX2M0jdEXgI-lvI"}'::jsonb,
    body := '{"phase":"predict"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'btc-15m-post-close-resolve',
  '1,16,31,46 * * * *',
  $$
  select net.http_post(
    url := 'https://project--23a724c5-6c5b-4434-85e6-dc54b111c7e2.lovable.app/api/public/hooks/scheduled-15m-run',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsZXZkenlpc2lieGN2d295cnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NjgzNjcsImV4cCI6MjA5ODM0NDM2N30.k6mUWZXJCwGR0cdv9W6zR2zs5lR9CX2M0jdEXgI-lvI"}'::jsonb,
    body := '{"phase":"resolve"}'::jsonb
  );
  $$
);
