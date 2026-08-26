create table if not exists public.t10_prior_klines (
  venue text not null check (venue in ('SPOT','FUT')),
  candle_ts timestamptz not null,
  open double precision not null,
  high double precision not null,
  low double precision not null,
  close double precision not null,
  volume double precision not null default 0,
  quote_volume double precision not null default 0,
  taker_buy_quote_volume double precision not null default 0,
  trade_count double precision not null default 0,
  updated_at timestamptz not null default now(),
  primary key (venue, candle_ts)
);
grant select on public.t10_prior_klines to authenticated;
grant all on public.t10_prior_klines to service_role;
alter table public.t10_prior_klines enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='t10_prior_klines' and policyname='t10 prior klines readable') then
    create policy "t10 prior klines readable" on public.t10_prior_klines for select to authenticated using (true);
  end if;
end $$;