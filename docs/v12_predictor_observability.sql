-- Predictor-owned delivery journal. No betting or balance dependencies.
create table if not exists public.v12_prediction_events (
  event_key text primary key,
  request_hash text not null,
  route text not null check(route in ('V1','T45R2','U')),
  model_version text not null,
  market text not null,
  candle_starts_at timestamptz not null,
  decision_at timestamptz not null,
  prediction text not null check(prediction in ('YES','NO')),
  checkpoint_seconds integer,
  u_source text,
  created_at timestamptz not null default now(),
  delivery_status text not null default 'PENDING' check(delivery_status in ('PENDING','ACKNOWLEDGED','UNKNOWN')),
  acknowledged_at timestamptz,
  receiver_status text,
  receiver_receipt_id uuid,
  error_code text
);
create index if not exists v12_prediction_events_created_idx on public.v12_prediction_events(created_at desc);
create table if not exists public.v12_predictor_runtime (
  worker_id text primary key check(worker_id='v12-shadow-worker'),
  received_at timestamptz not null default now(),
  status jsonb not null
);
alter table public.v12_prediction_events enable row level security;
alter table public.v12_predictor_runtime enable row level security;
revoke all on public.v12_prediction_events,public.v12_predictor_runtime from public,anon,authenticated;
grant select,insert,update on public.v12_prediction_events,public.v12_predictor_runtime to service_role;
