-- Retire legacy T45 background jobs; only V1.2 and V3 are tracked now.
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('t45-boundary-watchdog','t45-resolve-backlog');
