-- Read-only checks after operator installation. Outside noon–18:00 Boise,
-- the candidate multiplier is expected to remain 1.
select id,mode,capture_started_at,enabled_at from public.v12_p2_config;
select count(*) as captured_calls,count(known_at) as known_outcomes,max(known_at) as latest_known
  from public.v12_p2_calls;
select model_version,market,prediction,market_result,won,received_at,known_at
  from public.v12_p2_calls where known_at is not null
  order by known_at desc,received_at desc,signal_id desc limit 5;
select route,received_at,budget_cents,p2_sizing
  from public.v12_shadow_signals where p2_sizing is not null
  order by received_at desc limit 20;
select j.jobname,r.status,r.start_time,r.end_time
  from cron.job_run_details r join cron.job j on j.jobid=r.jobid
  where j.jobname='v12-p2-outcome-observer' order by r.start_time desc limit 10;
