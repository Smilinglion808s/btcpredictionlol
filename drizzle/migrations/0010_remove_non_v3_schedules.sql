DO $$ DECLARE j text; BEGIN
FOREACH j IN ARRAY ARRAY['btc15m-resolve','modelc-nightly-audit','btc15m-predict','t45-boundary-watchdog','t45-resolve-backlog'] LOOP
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname=j) THEN PERFORM cron.unschedule(j); END IF;
END LOOP; END $$;