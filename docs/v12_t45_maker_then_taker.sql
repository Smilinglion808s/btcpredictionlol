-- btc-trader only. T45 maker-first; preserve mode, activation, sizing and privileges.
begin;
create or replace function public.record_v12_signal(p_payload jsonb,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  row_id uuid; existing_id uuid; opening numeric; budget bigint; stake integer;
  chosen_route text:=p_payload->>'leg'; release_mode text; activated timestamptz;
  result_status text; receipt timestamptz:=clock_timestamp(); day_key date;
  expected_model text; expected_execution text; sent_execution text;
  normalized jsonb; executable boolean:=false;
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
    market,received_at,status,budget_cents,payload,execution_enabled)
  values(p_hash,normalized->>'interval_key',normalized->>'combined_model_version',chosen_route,expected_model,
    (normalized->>'candle_starts_at')::timestamptz,normalized->>'market',receipt,result_status,budget,normalized,executable)
    returning id into row_id;
  if result_status in ('LIVE_ACCEPTED','SHADOW_RECORDED') then
    insert into public.v12_shadow_claims(interval_key,signal_id,route) values(normalized->>'interval_key',row_id,chosen_route);
  end if;
  return jsonb_build_object('id',row_id,'status',result_status,'route',chosen_route,'budget_cents',budget,
    'opening_balance',opening,'boise_day',day_key,'mode',release_mode,'execution_enabled',executable,
    'execution_policy',expected_execution,'received_at',receipt);
end; $$;

update public.v12_release_config
set policy=jsonb_set(policy,'{T45R2,execution}','"maker_then_taker"'::jsonb)
where version='v12-original-u-4-5-10-r1';
commit;
