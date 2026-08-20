create table if not exists public.t45_training_labels (
  target_ts timestamptz primary key,
  training_label_feedback double precision,
  evaluation_label_strict double precision,
  label_source text,
  updated_at timestamptz not null default now()
);
grant select on public.t45_training_labels to authenticated;
grant all on public.t45_training_labels to service_role;
alter table public.t45_training_labels enable row level security;
create policy "t45 labels readable by authenticated" on public.t45_training_labels for select to authenticated using (true);