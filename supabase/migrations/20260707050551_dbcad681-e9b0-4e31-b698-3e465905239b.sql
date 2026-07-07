CREATE OR REPLACE FUNCTION public.prediction_stats_filtered(model_version_filter text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
  total int; wins int; losses int; pushes int; pending int;
  yes_total int; yes_wins int; no_total int;  no_wins int;
  avg_conf numeric; avg_conf_wins numeric; avg_conf_losses numeric;
  wr_overall numeric; wr_10 numeric; wr_25 numeric; wr_50 numeric;
  by_setup jsonb; by_bucket jsonb; by_condition jsonb;
  vf text := nullif(trim(coalesce(model_version_filter, '')), '');
begin
  select count(*) into total from predictions where (vf is null or model_version = vf);
  select count(*) into wins from predictions where status='win' and (vf is null or model_version = vf);
  select count(*) into losses from predictions where status='loss' and (vf is null or model_version = vf);
  select count(*) into pushes from predictions where status='push' and (vf is null or model_version = vf);
  select count(*) into pending from predictions where status in ('pending','manual_review') and (vf is null or model_version = vf);

  select count(*), count(*) filter (where status='win')
    into yes_total, yes_wins
    from predictions where prediction='YES' and status in ('win','loss') and (vf is null or model_version = vf);
  select count(*), count(*) filter (where status='win')
    into no_total, no_wins
    from predictions where prediction='NO' and status in ('win','loss') and (vf is null or model_version = vf);

  select avg(confidence) into avg_conf from predictions where status in ('win','loss') and (vf is null or model_version = vf);
  select avg(confidence) into avg_conf_wins from predictions where status='win' and (vf is null or model_version = vf);
  select avg(confidence) into avg_conf_losses from predictions where status='loss' and (vf is null or model_version = vf);

  wr_overall := case when (wins+losses)=0 then 0 else round((wins::numeric/(wins+losses))*100, 2) end;

  with last_n as (
    select status from predictions
    where status in ('win','loss') and (vf is null or model_version = vf)
    order by coalesce(resolved_at, created_at) desc limit 10
  )
  select case when count(*)=0 then 0 else round((count(*) filter (where status='win')::numeric/count(*))*100, 2) end
  into wr_10 from last_n;

  with last_n as (
    select status from predictions
    where status in ('win','loss') and (vf is null or model_version = vf)
    order by coalesce(resolved_at, created_at) desc limit 25
  )
  select case when count(*)=0 then 0 else round((count(*) filter (where status='win')::numeric/count(*))*100, 2) end
  into wr_25 from last_n;

  with last_n as (
    select status from predictions
    where status in ('win','loss') and (vf is null or model_version = vf)
    order by coalesce(resolved_at, created_at) desc limit 50
  )
  select case when count(*)=0 then 0 else round((count(*) filter (where status='win')::numeric/count(*))*100, 2) end
  into wr_50 from last_n;

  select coalesce(jsonb_object_agg(setup_type, stat), '{}'::jsonb) into by_setup
  from (
    select coalesce(setup_type,'unknown') as setup_type,
           jsonb_build_object(
             'total', count(*),
             'wins', count(*) filter (where status='win'),
             'losses', count(*) filter (where status='loss'),
             'win_rate', case when count(*) filter (where status in ('win','loss'))=0 then 0
                              else round((count(*) filter (where status='win')::numeric /
                                          count(*) filter (where status in ('win','loss')))*100,2) end
           ) as stat
    from predictions
    where (vf is null or model_version = vf)
    group by coalesce(setup_type,'unknown')
  ) s;

  select coalesce(jsonb_object_agg(bucket, stat), '{}'::jsonb) into by_bucket
  from (
    select case
             when confidence < 60 then '50-59'
             when confidence < 70 then '60-69'
             when confidence < 80 then '70-79'
             else '80+'
           end as bucket,
           jsonb_build_object(
             'total', count(*),
             'wins', count(*) filter (where status='win'),
             'losses', count(*) filter (where status='loss'),
             'win_rate', case when count(*) filter (where status in ('win','loss'))=0 then 0
                              else round((count(*) filter (where status='win')::numeric /
                                          count(*) filter (where status in ('win','loss')))*100,2) end
           ) as stat
    from predictions
    where (vf is null or model_version = vf)
    group by 1
  ) b;

  select coalesce(jsonb_object_agg(market_condition, stat), '{}'::jsonb) into by_condition
  from (
    select coalesce(market_condition,'unknown') as market_condition,
           jsonb_build_object(
             'total', count(*),
             'wins', count(*) filter (where status='win'),
             'losses', count(*) filter (where status='loss'),
             'win_rate', case when count(*) filter (where status in ('win','loss'))=0 then 0
                              else round((count(*) filter (where status='win')::numeric /
                                          count(*) filter (where status in ('win','loss')))*100,2) end
           ) as stat
    from predictions
    where (vf is null or model_version = vf)
    group by coalesce(market_condition,'unknown')
  ) c;

  result := jsonb_build_object(
    'model_version_filter', vf,
    'total', total, 'wins', wins, 'losses', losses, 'pushes', pushes, 'pending', pending,
    'overall_win_rate', wr_overall,
    'last_10_win_rate', wr_10, 'last_25_win_rate', wr_25, 'last_50_win_rate', wr_50,
    'yes_total', yes_total, 'yes_wins', yes_wins,
    'yes_win_rate', case when yes_total=0 then 0 else round((yes_wins::numeric/yes_total)*100,2) end,
    'no_total', no_total, 'no_wins', no_wins,
    'no_win_rate', case when no_total=0 then 0 else round((no_wins::numeric/no_total)*100,2) end,
    'avg_confidence', coalesce(round(avg_conf,2),0),
    'avg_confidence_wins', coalesce(round(avg_conf_wins,2),0),
    'avg_confidence_losses', coalesce(round(avg_conf_losses,2),0),
    'by_setup', by_setup, 'by_confidence_bucket', by_bucket, 'by_market_condition', by_condition
  );
  return result;
end; $function$;

GRANT EXECUTE ON FUNCTION public.prediction_stats_filtered(text) TO authenticated, service_role;