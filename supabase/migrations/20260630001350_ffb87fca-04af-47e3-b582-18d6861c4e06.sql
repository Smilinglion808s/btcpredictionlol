
-- Extensions
create extension if not exists pgcrypto;

-- ============ candles ============
create table public.candles (
  id uuid primary key default gen_random_uuid(),
  symbol text not null default 'BTC-USDT',
  timeframe text not null default '15m',
  candle_ts timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null,
  volume_quote numeric,
  confirm boolean not null default false,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (symbol, timeframe, candle_ts)
);
create index candles_ts_idx on public.candles (symbol, timeframe, candle_ts desc);

grant select, insert, update, delete on public.candles to authenticated;
grant all on public.candles to service_role;

alter table public.candles enable row level security;
create policy "candles_auth_read"  on public.candles for select to authenticated using (true);
create policy "candles_auth_write" on public.candles for insert to authenticated with check (true);
create policy "candles_auth_update" on public.candles for update to authenticated using (true) with check (true);
create policy "candles_auth_delete" on public.candles for delete to authenticated using (true);

-- ============ predictions ============
create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  symbol text not null default 'BTC-USDT',
  timeframe text not null default '15m',
  model_version text not null,
  candle_ts timestamptz not null,
  prediction text not null check (prediction in ('YES','NO')),
  confidence numeric not null,
  btc_price_at_prediction numeric not null,
  setup_type text,
  market_condition text,
  reasoning_summary text,
  full_ai_response jsonb,
  indicators jsonb,
  status text not null default 'pending' check (status in ('pending','win','loss','push','manual_review')),
  actual_next_candle_open numeric,
  actual_next_candle_high numeric,
  actual_next_candle_low numeric,
  actual_next_candle_close numeric,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index predictions_created_idx on public.predictions (created_at desc);
create index predictions_status_idx on public.predictions (status);
create index predictions_candle_ts_idx on public.predictions (candle_ts);

grant select, insert, update, delete on public.predictions to authenticated;
grant all on public.predictions to service_role;

alter table public.predictions enable row level security;
create policy "predictions_auth_read"   on public.predictions for select to authenticated using (true);
create policy "predictions_auth_insert" on public.predictions for insert to authenticated with check (true);
create policy "predictions_auth_update" on public.predictions for update to authenticated using (true) with check (true);
create policy "predictions_auth_delete" on public.predictions for delete to authenticated using (true);

-- ============ model_settings ============
create table public.model_settings (
  id uuid primary key default gen_random_uuid(),
  model_version text not null unique,
  is_active boolean not null default false,
  confidence_threshold numeric not null default 55,
  auto_run_enabled boolean not null default false,
  require_manual_approval boolean not null default false,
  indicator_weights jsonb not null default '{}'::jsonb,
  prompt_template text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.model_settings to authenticated;
grant all on public.model_settings to service_role;

alter table public.model_settings enable row level security;
create policy "ms_auth_read"   on public.model_settings for select to authenticated using (true);
create policy "ms_auth_insert" on public.model_settings for insert to authenticated with check (true);
create policy "ms_auth_update" on public.model_settings for update to authenticated using (true) with check (true);
create policy "ms_auth_delete" on public.model_settings for delete to authenticated using (true);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create trigger model_settings_updated
before update on public.model_settings
for each row execute function public.set_updated_at();

-- ============ api_runs ============
create table public.api_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  request_payload jsonb,
  response_payload jsonb,
  success boolean not null default true,
  error_message text,
  created_at timestamptz not null default now()
);
create index api_runs_created_idx on public.api_runs (created_at desc);

grant select, insert, update, delete on public.api_runs to authenticated;
grant all on public.api_runs to service_role;

alter table public.api_runs enable row level security;
create policy "api_runs_auth_read"   on public.api_runs for select to authenticated using (true);
create policy "api_runs_auth_insert" on public.api_runs for insert to authenticated with check (true);

-- ============ prediction_stats RPC ============
create or replace function public.prediction_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  total int;
  wins int;
  losses int;
  pushes int;
  pending int;
  yes_total int; yes_wins int;
  no_total int;  no_wins int;
  avg_conf numeric;
  avg_conf_wins numeric;
  avg_conf_losses numeric;
  wr_overall numeric;
  wr_10 numeric; wr_25 numeric; wr_50 numeric;
  by_setup jsonb;
  by_bucket jsonb;
  by_condition jsonb;
begin
  select count(*) into total from predictions;
  select count(*) into wins from predictions where status='win';
  select count(*) into losses from predictions where status='loss';
  select count(*) into pushes from predictions where status='push';
  select count(*) into pending from predictions where status in ('pending','manual_review');

  select count(*), count(*) filter (where status='win')
    into yes_total, yes_wins
    from predictions where prediction='YES' and status in ('win','loss');
  select count(*), count(*) filter (where status='win')
    into no_total, no_wins
    from predictions where prediction='NO' and status in ('win','loss');

  select avg(confidence) into avg_conf from predictions where status in ('win','loss');
  select avg(confidence) into avg_conf_wins from predictions where status='win';
  select avg(confidence) into avg_conf_losses from predictions where status='loss';

  wr_overall := case when (wins+losses)=0 then 0 else round((wins::numeric/(wins+losses))*100, 2) end;

  with last_n as (
    select status from predictions
    where status in ('win','loss')
    order by coalesce(resolved_at, created_at) desc
    limit 10
  )
  select case when count(*)=0 then 0
              else round((count(*) filter (where status='win')::numeric/count(*))*100, 2) end
  into wr_10 from last_n;

  with last_n as (
    select status from predictions
    where status in ('win','loss')
    order by coalesce(resolved_at, created_at) desc
    limit 25
  )
  select case when count(*)=0 then 0
              else round((count(*) filter (where status='win')::numeric/count(*))*100, 2) end
  into wr_25 from last_n;

  with last_n as (
    select status from predictions
    where status in ('win','loss')
    order by coalesce(resolved_at, created_at) desc
    limit 50
  )
  select case when count(*)=0 then 0
              else round((count(*) filter (where status='win')::numeric/count(*))*100, 2) end
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
    group by coalesce(market_condition,'unknown')
  ) c;

  result := jsonb_build_object(
    'total', total,
    'wins', wins,
    'losses', losses,
    'pushes', pushes,
    'pending', pending,
    'overall_win_rate', wr_overall,
    'last_10_win_rate', wr_10,
    'last_25_win_rate', wr_25,
    'last_50_win_rate', wr_50,
    'yes_total', yes_total,
    'yes_wins', yes_wins,
    'yes_win_rate', case when yes_total=0 then 0 else round((yes_wins::numeric/yes_total)*100,2) end,
    'no_total', no_total,
    'no_wins', no_wins,
    'no_win_rate', case when no_total=0 then 0 else round((no_wins::numeric/no_total)*100,2) end,
    'avg_confidence', coalesce(round(avg_conf,2),0),
    'avg_confidence_wins', coalesce(round(avg_conf_wins,2),0),
    'avg_confidence_losses', coalesce(round(avg_conf_losses,2),0),
    'by_setup', by_setup,
    'by_confidence_bucket', by_bucket,
    'by_market_condition', by_condition
  );
  return result;
end; $$;

grant execute on function public.prediction_stats() to authenticated, service_role;

-- ============ Realtime ============
alter table public.candles replica identity full;
alter table public.predictions replica identity full;
alter publication supabase_realtime add table public.candles;
alter publication supabase_realtime add table public.predictions;

-- ============ Seed model_settings ============
insert into public.model_settings (model_version, is_active, confidence_threshold, auto_run_enabled, require_manual_approval, indicator_weights, prompt_template)
values (
  'BTC 15m Model 1.9',
  true,
  55,
  false,
  false,
  '{
    "failed_breakout_rejection": 10,
    "wick_rejection_defense": 10,
    "trend_direction": 8,
    "ema_positioning": 8,
    "candle_body_strength": 7,
    "volume_expansion": 7,
    "support_resistance_proximity": 8,
    "higher_low_lower_high_structure": 7,
    "breakout_breakdown_followthrough": 7,
    "reclaim_failure_behavior": 8,
    "chop_range_risk": 6
  }'::jsonb,
  'Analyze the latest BTC-USDT 15-minute candle data and predict the next candle only. Use Model 1.9 weighting. Recent candles: {{candles_json}}. Current model settings: {{model_settings_json}}. Return strict JSON only.'
)
on conflict (model_version) do nothing;
