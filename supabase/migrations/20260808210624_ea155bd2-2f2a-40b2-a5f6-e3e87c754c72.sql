SELECT cron.schedule(
  'b4x4-ob-shadow-capture',
  '14,29,44,59 * * * *',
  $$SELECT public.b4x4_ob_capture_call();$$
);