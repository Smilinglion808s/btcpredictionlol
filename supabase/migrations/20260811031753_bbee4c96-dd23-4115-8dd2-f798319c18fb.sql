CREATE INDEX IF NOT EXISTS idx_predictions_model_version_status ON public.predictions (model_version, status);
CREATE INDEX IF NOT EXISTS idx_predictions_resolved_created ON public.predictions (coalesce(resolved_at, created_at) DESC);

CREATE OR REPLACE FUNCTION public.prediction_stats_filtered(model_version_filter text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  result jsonb;
  vf text := nullif(trim(coalesce(model_version_filter, '')), '');
begin
  create temp table if not exists _ps_base on commit drop as select 1 where false;

  with base as materialized (
    select status, prediction, confidence, setup_type, market_condition,
           coalesce(resolved_at, created_at) as ord
    from predictions
    where (vf is null or model_version = vf)
  ),
  agg as (
    select
      count(*) as total,
      count(*) filter (where status='win') as wins,
      count(*) filter (where status='loss') as losses,
      count(*) filter (where status='push') as pushes,
      count(*) filter (where status in ('pending','manual_review')) as pending,
      count(*) filter (where prediction='YES' and status in ('win','loss')) as yes_total,
      count(*) filter (where prediction='YES' and status='win') as yes_wins,
      count(*) filter (where prediction='NO' and status in ('win','loss')) as no_total,
      count(*) filter (where prediction='NO' and status='win') as no_wins,
      avg(confidence) filter (where status in ('win','loss')) as avg_conf,
      avg(confidence) filter (where status='win') as avg_conf_wins,
      avg(confidence) filter (where status='loss') as avg_conf_losses
    from base
  ),
  ranked as (
    select status, row_number() over (order by ord desc) as rn
    from base where status in ('win','loss')
  ),
  lastn as (
    select
      count(*) filter (where rn <= 10) as n10,
      count(*) filter (where rn <= 10 and status='win') as w10,
      count(*) filter (where rn <= 25) as n25,
      count(*) filter (where rn <= 25 and status='win') as w25,
      count(*) filter (where rn <= 50) as n50,
      count(*) filter (where rn <= 50 and status='win') as w50
    from ranked
  ),
  setup as (
    select coalesce(jsonb_object_agg(k, stat), '{}'::jsonb) as j from (
      select coalesce(setup_type,'unknown') as k,
        jsonb_build_object(
          'total', count(*),
          'wins', count(*) filter (where status='win'),
          'losses', count(*) filter (where status='loss'),
          'win_rate', case when count(*) filter (where status in ('win','loss'))=0 then 0
                           else round((count(*) filter (where status='win')::numeric /
                                       count(*) filter (where status in ('win','loss')))*100,2) end
        ) as stat
      from base group by 1
    ) s
  ),
  bucket as (
    select coalesce(jsonb_object_agg(k, stat), '{}'::jsonb) as j from (
      select case when confidence < 60 then '50-59'
                  when confidence < 70 then '60-69'
                  when confidence < 80 then '70-79'
                  else '80+' end as k,
        jsonb_build_object(
          'total', count(*),
          'wins', count(*) filter (where status='win'),
          'losses', count(*) filter (where status='loss'),
          'win_rate', case when count(*) filter (where status in ('win','loss'))=0 then 0
                           else round((count(*) filter (where status='win')::numeric /
                                       count(*) filter (where status in ('win','loss')))*100,2) end
        ) as stat
      from base group by 1
    ) b
  ),
  cond as (
    select coalesce(jsonb_object_agg(k, stat), '{}'::jsonb) as j from (
      select coalesce(market_condition,'unknown') as k,
        jsonb_build_object(
          'total', count(*),
          'wins', count(*) filter (where status='win'),
          'losses', count(*) filter (where status='loss'),
          'win_rate', case when count(*) filter (where status in ('win','loss'))=0 then 0
                           else round((count(*) filter (where status='win')::numeric /
                                       count(*) filter (where status in ('win','loss')))*100,2) end
        ) as stat
      from base group by 1
    ) c
  )
  select jsonb_build_object(
    'model_version_filter', vf,
    'total', a.total, 'wins', a.wins, 'losses', a.losses, 'pushes', a.pushes, 'pending', a.pending,
    'overall_win_rate', case when (a.wins+a.losses)=0 then 0 else round((a.wins::numeric/(a.wins+a.losses))*100,2) end,
    'last_10_win_rate', case when l.n10=0 then 0 else round((l.w10::numeric/l.n10)*100,2) end,
    'last_25_win_rate', case when l.n25=0 then 0 else round((l.w25::numeric/l.n25)*100,2) end,
    'last_50_win_rate', case when l.n50=0 then 0 else round((l.w50::numeric/l.n50)*100,2) end,
    'yes_total', a.yes_total, 'yes_wins', a.yes_wins,
    'yes_win_rate', case when a.yes_total=0 then 0 else round((a.yes_wins::numeric/a.yes_total)*100,2) end,
    'no_total', a.no_total, 'no_wins', a.no_wins,
    'no_win_rate', case when a.no_total=0 then 0 else round((a.no_wins::numeric/a.no_total)*100,2) end,
    'avg_confidence', coalesce(round(a.avg_conf,2),0),
    'avg_confidence_wins', coalesce(round(a.avg_conf_wins,2),0),
    'avg_confidence_losses', coalesce(round(a.avg_conf_losses,2),0),
    'by_setup', setup.j, 'by_confidence_bucket', bucket.j, 'by_market_condition', cond.j
  )
  into result
  from agg a, lastn l, setup, bucket, cond;

  return result;
end; $function$;