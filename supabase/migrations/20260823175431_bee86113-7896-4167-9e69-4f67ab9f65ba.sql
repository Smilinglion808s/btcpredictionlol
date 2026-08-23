alter table public.t30_pf_predictions
  add column if not exists webhook_sent boolean not null default false,
  add column if not exists webhook_sent_at timestamptz,
  add column if not exists webhook_latency_ms integer,
  add column if not exists webhook_offset_ms integer,
  add column if not exists decision_offset_ms integer;

alter table public.t45_pf_predictions
  add column if not exists webhook_sent_at timestamptz,
  add column if not exists webhook_latency_ms integer,
  add column if not exists webhook_offset_ms integer,
  add column if not exists decision_offset_ms integer;