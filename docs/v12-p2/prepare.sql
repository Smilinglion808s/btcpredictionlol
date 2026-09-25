-- REVIEWED PREPARATION ONLY. P2 defaults to OFF. This does not enable betting.
-- Apply once to the receiver project ruxndqfjfdbtdbkheuge after operator review.
begin;
do $guard$
begin
  if md5(pg_get_functiondef('public.record_v12_signal(jsonb,text)'::regprocedure)) <> '6ab642c5eb3b5728db30db4152759adb' then
    raise exception 'V12_RECORDER_CHANGED_REVIEW_REQUIRED';
  end if;
end;
$guard$;

-- Preparation reference: not automatically applied by the application.
-- All functions are service-role-only and execute as the invoking role.
-- No order API is called and P2 starts OFF. Do not backdate outcome knowledge.

create table public.v12_p2_config (
  id integer primary key check (id=1),
  mode text not null default 'off' check (mode in ('off','shadow','on')),
  capture_started_at timestamptz not null default clock_timestamp(),
  enabled_at timestamptz
);
insert into public.v12_p2_config(id,mode) values(1,'off');

create table public.v12_p2_calls (
  signal_id uuid primary key references public.v12_shadow_signals(id),
  interval_key text not null unique,
  model_version text not null check(model_version in ('v12-v1-r1','v12-t45r2-r1','v12-original-u-r1')),
  market text not null check(market ~ '^KXBTC15M-[A-Z0-9-]+$'),
  prediction text not null check(prediction in ('YES','NO')),
  candle_starts_at timestamptz not null,
  received_at timestamptz not null,
  known_at timestamptz,
  market_result text check(market_result in ('yes','no')),
  won boolean generated always as (lower(prediction)=market_result) stored,
  constraint complete_outcome check ((known_at is null)=(market_result is null)),
  constraint known_after_entry check (known_at is null or known_at>=received_at),
  constraint known_after_close check (known_at is null or known_at>=candle_starts_at+interval '15 minutes')
);
create index v12_p2_known_order on public.v12_p2_calls(known_at desc,received_at desc,signal_id desc)
  where known_at is not null;
create index v12_p2_pending on public.v12_p2_calls(candle_starts_at,signal_id)
  where known_at is null;
create index v12_p2_market on public.v12_p2_calls(market);

alter table public.v12_p2_config enable row level security;
alter table public.v12_p2_calls enable row level security;
revoke all on public.v12_p2_config,public.v12_p2_calls from public,anon,authenticated;
grant select,insert,update,delete on public.v12_p2_config,public.v12_p2_calls to service_role;

create function public.v12_p2_mode_boundary() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  new.capture_started_at:=old.capture_started_at;
  if new.mode='on' and old.mode is distinct from 'on' then new.enabled_at:=clock_timestamp();
  elsif new.mode<>'on' then new.enabled_at:=null;
  else new.enabled_at:=old.enabled_at;end if;
  return new;
end; $$;
revoke all on function public.v12_p2_mode_boundary() from public,anon,authenticated;
create trigger v12_p2_mode_boundary before update on public.v12_p2_config
  for each row execute function public.v12_p2_mode_boundary();

create function public.capture_v12_p2_call() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  -- Capture the model's selected call even if its order later fails or does not fill.
  -- Rejected/duplicate/stale signals and other model versions do not enter history.
  if new.version='v12-original-u-4-5-10-r1'
    and new.status in ('LIVE_ACCEPTED','SHADOW_RECORDED')
    and new.model_version in ('v12-v1-r1','v12-t45r2-r1','v12-original-u-r1') then
    insert into public.v12_p2_calls(signal_id,interval_key,model_version,market,prediction,candle_starts_at,received_at)
    values(new.id,new.interval_key,new.model_version,new.market,new.payload->>'prediction',new.candle_starts_at,new.received_at)
    on conflict(interval_key) do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.capture_v12_p2_call() from public,anon,authenticated;
create trigger capture_v12_p2_call after insert on public.v12_shadow_signals
  for each row execute function public.capture_v12_p2_call();

create function public.record_v12_p2_outcome(p_market text,p_result text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare observed timestamptz; affected integer;
begin
  if p_market is null or p_market !~ '^KXBTC15M-[A-Z0-9-]+$' or p_result is null or p_result not in ('yes','no')
    then raise exception 'INVALID_OFFICIAL_OUTCOME';end if;
  perform 1 from public.v12_p2_calls where market=p_market for update;
  if exists(select 1 from public.v12_p2_calls where market=p_market and market_result is not null and market_result<>p_result)
    then raise exception 'OUTCOME_CONFLICT';end if;
  observed:=clock_timestamp();
  update public.v12_p2_calls set known_at=observed,market_result=p_result
    where market=p_market and known_at is null and received_at<=observed
      and candle_starts_at+interval '15 minutes'<=observed;
  get diagnostics affected=row_count;
  return jsonb_build_object('recorded',affected,'observed_at',observed);
end; $$;
revoke all on function public.record_v12_p2_outcome(text,text) from public,anon,authenticated;
grant execute on function public.record_v12_p2_outcome(text,text) to service_role;

create function public.evaluate_v12_p2(p_at timestamptz,p_opening_dollars numeric,p_base_percent integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  policy_mode text; enabled timestamptz; n integer; wins integer; ids jsonb;
  in_window boolean; eligible boolean; multiplier integer; candidate integer;
  opening_cents numeric; base_budget bigint; selected_budget bigint; candidate_budget bigint; why text;
begin
  if p_at is null or not isfinite(p_at) or p_opening_dollars is null or p_opening_dollars<0
    or p_opening_dollars::text in ('NaN','Infinity','-Infinity') or p_base_percent is null
    or p_base_percent not in (4,5,10) then raise exception 'INVALID_P2_INPUT';end if;
  select mode,enabled_at into policy_mode,enabled from public.v12_p2_config where id=1;
  policy_mode:=coalesce(policy_mode,'off');
  select count(*)::integer,coalesce(sum(case when q.won then 1 else 0 end),0)::integer,
    coalesce(jsonb_agg(q.signal_id order by q.known_at desc,q.received_at desc,q.signal_id desc),'[]'::jsonb)
    into n,wins,ids from (
      select signal_id,known_at,received_at,won from public.v12_p2_calls
      where known_at<=p_at and known_at is not null
      order by known_at desc,received_at desc,signal_id desc limit 5
    ) q;
  in_window:=(p_at at time zone 'America/Boise')::time>=time '12:00'
    and (p_at at time zone 'America/Boise')::time<time '18:00';
  eligible:=in_window and n=5 and wins<=3;
  candidate:=case when eligible then 2 else 1 end;
  multiplier:=case when eligible and policy_mode='on' and enabled is not null and enabled<=p_at then 2 else 1 end;
  opening_cents:=floor(p_opening_dollars*100);
  base_budget:=floor(opening_cents*p_base_percent/100)::bigint;
  selected_budget:=floor(opening_cents*p_base_percent*multiplier/100)::bigint;
  candidate_budget:=floor(opening_cents*p_base_percent*candidate/100)::bigint;
  why:=case when not in_window then 'OUTSIDE_BOISE_WINDOW' when n<5 then 'HISTORY_WARMUP'
    when wins>3 then 'FOUR_OR_FIVE_WINS' when multiplier=2 then 'P2_BOOST'
    when policy_mode='on' then 'NOT_YET_ENABLED' else 'P2_'||upper(policy_mode) end;
  return jsonb_build_object('version','v12-p2-afternoon-r1','mode',policy_mode,'evaluated_at',p_at,
    'eligible',eligible,'reason',why,'history_count',n,'history_wins',wins,'history_ids',ids,
    'base_percent',p_base_percent,'multiplier',multiplier,'candidate_multiplier',candidate,
    'effective_percent',p_base_percent*multiplier,'base_budget_cents',base_budget,
    'budget_cents',selected_budget,'candidate_budget_cents',candidate_budget);
end; $$;
revoke all on function public.evaluate_v12_p2(timestamptz,numeric,integer) from public,anon,authenticated;
grant execute on function public.evaluate_v12_p2(timestamptz,numeric,integer) to service_role;

alter table public.v12_shadow_signals add column p2_sizing jsonb;

CREATE OR REPLACE FUNCTION public.record_v12_signal(p_payload jsonb, p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  row_id uuid; existing_id uuid; opening numeric; budget bigint; stake integer;
  chosen_route text:=p_payload->>'leg'; release_mode text; activated timestamptz;
  result_status text; receipt timestamptz:=clock_timestamp(); day_key date;
  expected_model text; expected_execution text; sent_execution text;
  normalized jsonb; executable boolean:=false; p2_snapshot jsonb;
begin
  stake:=case chosen_route when 'V1' then 4 when 'T45R2' then 5 when 'U' then 10 else null end;
  expected_model:=case chosen_route when 'V1' then 'v12-v1-r1' when 'T45R2' then 'v12-t45r2-r1' when 'U' then 'v12-original-u-r1' end;
  expected_execution:='maker_then_taker';
  sent_execution:=p_payload->>'execution_policy';
  -- Exact legacy wire aliases normalize to the current receiver policy.
  if chosen_route in ('V1','U') and sent_execution='maker_only' then sent_execution:='maker_then_taker';end if;
  if chosen_route='T45R2' and sent_execution='taker_only' then sent_execution:='maker_then_taker';end if;
  if stake is null or p_payload->>'mode' is distinct from 'shadow'
    or p_payload->>'combined_model_version' is distinct from 'v12-original-u-4-5-10-r1'
    or p_payload->>'model_version' is distinct from expected_model
    or sent_execution is distinct from expected_execution
    or (p_payload->>'stake_fraction_of_boise_day_opening_principal')::numeric is distinct from stake::numeric/100
    or coalesce(p_payload->>'prediction','') not in ('YES','NO')
    or coalesce(p_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_V12_POLICY';end if;
  -- Everything recorded downstream carries the effective policy, never the alias.
  normalized:=jsonb_set(p_payload,'{execution_policy}',to_jsonb(expected_execution));
  select mode,live_enabled_at into release_mode,activated from public.v12_release_config
    where version='v12-original-u-4-5-10-r1';
  if release_mode is null then raise exception 'RELEASE_CONFIG_UNAVAILABLE';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_payload->>'interval_key',0));
  select id into existing_id from public.v12_shadow_signals where request_hash=p_hash;
  if existing_id is not null then return jsonb_build_object('status','DUPLICATE','id',existing_id,
    'mode',release_mode,'execution_enabled',false);end if;
  day_key:=(receipt at time zone 'America/Boise')::date;
  select balance_at_midnight into opening from public.daily_balance where date=day_key;
  budget:=floor(opening*stake)::bigint;
  if opening is not null and opening>=0 then
    p2_snapshot:=public.evaluate_v12_p2(receipt,opening,stake);
    budget:=(p2_snapshot->>'budget_cents')::bigint;
  end if;
  result_status:=case when release_mode='live' then 'LIVE_ACCEPTED' else 'SHADOW_RECORDED' end;
  if receipt-(p_payload->>'decision_at')::timestamptz>interval '10 seconds'
      or receipt-(p_payload->>'sent_at')::timestamptz>interval '5 seconds'
      or receipt>=(p_payload->>'candle_starts_at')::timestamptz+interval '15 minutes' then result_status:='STALE_SIGNAL';
  elsif release_mode='live' and (activated is null or (p_payload->>'decision_at')::timestamptz<activated) then result_status:='BEFORE_ACTIVATION';
  elsif opening is null then result_status:='DAY_OPENING_UNAVAILABLE';
  elsif budget<=0 then result_status:='NO_BUDGET';
  elsif exists(select 1 from public.bet_history where market=p_payload->>'market') then result_status:='EXISTING_LEG_RECORD';
  elsif exists(select 1 from public.v12_shadow_claims where interval_key=p_payload->>'interval_key') then result_status:='INTERVAL_ALREADY_CLAIMED';
  end if;
  executable:=result_status='LIVE_ACCEPTED';
  insert into public.v12_shadow_signals(request_hash,interval_key,version,route,model_version,candle_starts_at,
    market,received_at,status,budget_cents,payload,execution_enabled,p2_sizing)
  values(p_hash,normalized->>'interval_key',normalized->>'combined_model_version',chosen_route,expected_model,
    (normalized->>'candle_starts_at')::timestamptz,normalized->>'market',receipt,result_status,budget,normalized,executable,p2_snapshot)
    returning id into row_id;
  if result_status in ('LIVE_ACCEPTED','SHADOW_RECORDED') then
    insert into public.v12_shadow_claims(interval_key,signal_id,route) values(normalized->>'interval_key',row_id,chosen_route);
  end if;
  return jsonb_build_object('id',row_id,'status',result_status,'route',chosen_route,'budget_cents',budget,
    'opening_balance',opening,'boise_day',day_key,'mode',release_mode,'execution_enabled',executable,
    'execution_policy',expected_execution,'received_at',receipt,'p2_sizing',p2_snapshot);
end; $function$;

revoke all on function public.record_v12_signal(jsonb,text) from public,anon,authenticated;
grant execute on function public.record_v12_signal(jsonb,text) to service_role;
commit;
