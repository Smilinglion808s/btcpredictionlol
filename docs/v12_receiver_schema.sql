-- Additive shadow-only receiver storage. No existing trading tables/config changed.
create table if not exists public.v12_release_config (
  version text primary key,
  mode text not null check (mode = 'shadow'),
  policy jsonb not null,
  created_at timestamptz not null default now()
);
insert into public.v12_release_config(version,mode,policy) values
 ('v12-original-u-4-5-10-r1','shadow','{"V1":{"percent":4,"execution":"maker_only"},"T45R2":{"percent":5,"execution":"taker_only"},"U":{"percent":10,"execution":"maker_only"},"sizing":"Boise-day opening shared cost-basis equity","fees_inside_budget":true}')
on conflict(version) do nothing;
create table if not exists public.v12_day_openings (
  boise_day date primary key,
  opening_equity_cents bigint not null check(opening_equity_cents>=0),
  effective_at timestamptz not null,
  source text not null,
  created_at timestamptz not null default now(),
  check(effective_at = (boise_day::timestamp at time zone 'America/Boise'))
);
create table if not exists public.v12_shadow_signals (
  id uuid primary key default gen_random_uuid(),
  request_hash text unique not null,
  interval_key text not null,
  version text not null references public.v12_release_config(version),
  route text not null check(route in ('V1','T45R2','U')),
  model_version text not null,
  candle_starts_at timestamptz not null,
  market text not null,
  received_at timestamptz not null default now(),
  status text not null,
  budget_cents bigint,
  payload jsonb not null,
  execution_enabled boolean not null default false check(execution_enabled=false)
);
create table if not exists public.v12_shadow_claims (
  interval_key text primary key,
  signal_id uuid not null unique references public.v12_shadow_signals(id),
  route text not null,
  created_at timestamptz not null default now()
);
alter table public.v12_release_config enable row level security;
alter table public.v12_day_openings enable row level security;
alter table public.v12_shadow_signals enable row level security;
alter table public.v12_shadow_claims enable row level security;
revoke all on public.v12_release_config,public.v12_day_openings,public.v12_shadow_signals,public.v12_shadow_claims from public,anon,authenticated;
grant select on public.v12_release_config,public.v12_day_openings to service_role;
grant select,insert,update on public.v12_shadow_signals,public.v12_shadow_claims to service_role;

create or replace function public.record_v12_shadow_signal(p_payload jsonb,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  row_id uuid;existing_id uuid;opening bigint;budget bigint;stake integer;
  chosen_route text:=p_payload->>'leg';
  result_status text:='SHADOW_RECORDED';
  receipt timestamptz:=clock_timestamp();
  day_key date;
begin
  if p_payload->>'mode' is distinct from 'shadow' or p_payload->>'combined_model_version' is distinct from 'v12-original-u-4-5-10-r1'
    or chosen_route not in ('V1','T45R2','U') then raise exception 'INVALID_SHADOW_POLICY';end if;
  day_key:=(receipt at time zone 'America/Boise')::date;
  stake:=case chosen_route when 'V1' then 4 when 'T45R2' then 5 when 'U' then 10 end;
  perform pg_advisory_xact_lock(hashtextextended(p_payload->>'interval_key',0));
  select id into existing_id from public.v12_shadow_signals where request_hash=p_hash;
  if existing_id is not null then return jsonb_build_object('status','DUPLICATE','id',existing_id,'execution_enabled',false);end if;
  select opening_equity_cents into opening from public.v12_day_openings where boise_day=day_key;
  budget:=floor(opening::numeric*stake/100)::bigint;
  if opening is null then result_status:='DAY_OPENING_UNAVAILABLE';
  elsif budget<=0 then result_status:='NO_BUDGET';
  elsif exists(select 1 from public.bet_history where candle_starts_at=(p_payload->>'candle_starts_at')
      or (market=p_payload->>'market')) then result_status:='EXISTING_LEG_RECORD';
  elsif exists(select 1 from public.v12_shadow_claims where interval_key=p_payload->>'interval_key') then result_status:='INTERVAL_ALREADY_CLAIMED';
  end if;
  insert into public.v12_shadow_signals(request_hash,interval_key,version,route,model_version,candle_starts_at,market,received_at,status,budget_cents,payload)
  values(p_hash,p_payload->>'interval_key',p_payload->>'combined_model_version',chosen_route,p_payload->>'model_version',
    (p_payload->>'candle_starts_at')::timestamptz,p_payload->>'market',receipt,result_status,budget,p_payload) returning id into row_id;
  if result_status='SHADOW_RECORDED' then
    insert into public.v12_shadow_claims(interval_key,signal_id,route) values(p_payload->>'interval_key',row_id,chosen_route);
  end if;
  return jsonb_build_object('id',row_id,'status',result_status,'route',chosen_route,'budget_cents',budget,'execution_enabled',false);
end;
$$;
revoke all on function public.record_v12_shadow_signal(jsonb,text) from public,anon,authenticated;
grant execute on function public.record_v12_shadow_signal(jsonb,text) to service_role;
create or replace view public.v12_shadow_route_summary with(security_invoker=true) as
select route,model_version,status,count(*) as signals,max(received_at) as last_received_at
from public.v12_shadow_signals group by route,model_version,status;
revoke all on public.v12_shadow_route_summary from public,anon,authenticated;
grant select on public.v12_shadow_route_summary to service_role;
