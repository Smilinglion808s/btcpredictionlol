
-- TD1-RC V1: separate shadow system. Never alter Model 7/A2 tables or rows.

create table if not exists public.model7_td1_fits (
  id uuid primary key default gen_random_uuid(),
  fit_id text not null unique,
  base_variant text not null,
  trained_through_candle_ts timestamptz not null,
  promoted_at timestamptz,
  training_row_count integer not null check (training_row_count >= 100),
  feature_order_json jsonb not null,
  tree_artifact_json jsonb not null,
  artifact_sha256 text not null,
  trainer_version text not null,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists one_active_td1_fit_per_variant
on public.model7_td1_fits(base_variant) where active;

GRANT SELECT ON public.model7_td1_fits TO authenticated;
GRANT ALL ON public.model7_td1_fits TO service_role;
ALTER TABLE public.model7_td1_fits ENABLE ROW LEVEL SECURITY;
CREATE POLICY td1_fits_read_auth ON public.model7_td1_fits FOR SELECT TO authenticated USING (true);

create table if not exists public.model7_td1_rc_state (
  base_variant text primary key,
  yes_consecutive_losses integer not null default 0 check (yes_consecutive_losses >= 0),
  no_consecutive_losses integer not null default 0 check (no_consecutive_losses >= 0),
  yes_slots_remaining integer not null default 0 check (yes_slots_remaining between 0 and 2),
  no_slots_remaining integer not null default 0 check (no_slots_remaining between 0 and 2),
  yes_episode_armed boolean not null default false,
  no_episode_armed boolean not null default false,
  last_resolution_id text,
  updated_at timestamptz not null default now()
);

GRANT SELECT ON public.model7_td1_rc_state TO authenticated;
GRANT ALL ON public.model7_td1_rc_state TO service_role;
ALTER TABLE public.model7_td1_rc_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY td1_rc_state_read_auth ON public.model7_td1_rc_state FOR SELECT TO authenticated USING (true);

create table if not exists public.model7_td1_rc_resolutions (
  resolution_id text primary key,
  prediction_id uuid not null,
  candle_ts timestamptz not null,
  base_variant text not null,
  a2_decision text not null check (a2_decision in ('YES','NO')),
  a2_counterfactual_result text not null check (a2_counterfactual_result in ('WIN','LOSS')),
  state_before jsonb not null,
  state_after jsonb not null,
  created_at timestamptz not null default now()
);

GRANT SELECT ON public.model7_td1_rc_resolutions TO authenticated;
GRANT ALL ON public.model7_td1_rc_resolutions TO service_role;
ALTER TABLE public.model7_td1_rc_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY td1_rc_res_read_auth ON public.model7_td1_rc_resolutions FOR SELECT TO authenticated USING (true);

create table if not exists public.model7_td1_rc_shadow (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null,
  candle_ts timestamptz not null,
  variant text not null default 'A2_Combined_TD1_RC',
  prospective_test_id text not null,
  a2_source_variant text not null,
  a2_source_row_id uuid,
  a2_original_decision text,
  a2_probability_green double precision,
  a2_model_fit_id text,
  a2_counterfactual_result text,
  td1_fit_id text,
  td1_artifact_sha256 text,
  td1_feature_vector_sha256 text,
  td1_feature_cutoff_ts timestamptz,
  td1_latest_source_candle_ts timestamptz,
  td1_predicted_loss_probability double precision
    check (td1_predicted_loss_probability between 0 and 1),
  td1_threshold double precision not null default 0.60,
  td1_veto_fired boolean not null default false,
  containment_veto_fired boolean not null default false,
  containment_side text check (containment_side in ('YES','NO')),
  containment_slots_before integer check (containment_slots_before between 0 and 2),
  containment_slots_after integer check (containment_slots_after between 0 and 2),
  containment_episode_armed_before boolean,
  containment_episode_armed_after boolean,
  all_veto_reasons_json jsonb not null default '[]'::jsonb,
  external_final_decision text check (external_final_decision in ('YES','NO','SKIP')),
  would_trade boolean not null default false,
  skip_reason text,
  actual_direction text check (actual_direction in ('GREEN','RED')),
  result text check (result in ('WIN','LOSS','PUSH')),
  resolved_at timestamptz,
  timing_status text,
  leakage_check_passed boolean,
  shadow_error text,
  feature_values_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(prediction_id, variant)
);

create index if not exists model7_td1_rc_shadow_candle_ts_idx
  on public.model7_td1_rc_shadow(candle_ts desc);
create index if not exists model7_td1_rc_shadow_prediction_id_idx
  on public.model7_td1_rc_shadow(prediction_id);

GRANT SELECT ON public.model7_td1_rc_shadow TO authenticated;
GRANT ALL ON public.model7_td1_rc_shadow TO service_role;
ALTER TABLE public.model7_td1_rc_shadow ENABLE ROW LEVEL SECURITY;
CREATE POLICY td1_rc_shadow_read_auth ON public.model7_td1_rc_shadow FOR SELECT TO authenticated USING (true);

-- Atomic slot consumption. Call only for an eligible A2 YES/NO signal.
create or replace function public.consume_td1_containment_slot(
  p_base_variant text,
  p_side text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.model7_td1_rc_state%rowtype;
  before_slots integer;
  after_slots integer;
  armed boolean;
begin
  if p_side not in ('YES','NO') then
    raise exception 'invalid side';
  end if;

  perform pg_advisory_xact_lock(hashtext('TD1_RC:' || p_base_variant));
  insert into public.model7_td1_rc_state(base_variant)
  values (p_base_variant)
  on conflict (base_variant) do nothing;

  select * into s from public.model7_td1_rc_state
  where base_variant=p_base_variant for update;

  if p_side='YES' then
    before_slots := s.yes_slots_remaining;
    armed := s.yes_episode_armed;
    after_slots := greatest(before_slots-1,0);
    update public.model7_td1_rc_state
      set yes_slots_remaining=after_slots, updated_at=now()
      where base_variant=p_base_variant;
  else
    before_slots := s.no_slots_remaining;
    armed := s.no_episode_armed;
    after_slots := greatest(before_slots-1,0);
    update public.model7_td1_rc_state
      set no_slots_remaining=after_slots, updated_at=now()
      where base_variant=p_base_variant;
  end if;

  return jsonb_build_object(
    'veto_fired', before_slots > 0,
    'slots_before', before_slots,
    'slots_after', after_slots,
    'episode_armed', armed
  );
end;
$$;

-- Idempotent counterfactual resolution and containment update.
create or replace function public.apply_td1_rc_resolution(
  p_resolution_id text,
  p_prediction_id uuid,
  p_candle_ts timestamptz,
  p_base_variant text,
  p_side text,
  p_result text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.model7_td1_rc_state%rowtype;
  before_state jsonb;
  after_state jsonb;
  new_losses integer;
begin
  if p_side not in ('YES','NO') or p_result not in ('WIN','LOSS') then
    raise exception 'invalid resolution input';
  end if;

  perform pg_advisory_xact_lock(hashtext('TD1_RC:' || p_base_variant));

  if exists(select 1 from public.model7_td1_rc_resolutions where resolution_id=p_resolution_id) then
    select state_after into after_state
    from public.model7_td1_rc_resolutions where resolution_id=p_resolution_id;
    return jsonb_build_object('applied',false,'idempotent',true,'state_after',after_state);
  end if;

  insert into public.model7_td1_rc_state(base_variant)
  values (p_base_variant)
  on conflict (base_variant) do nothing;

  select * into s from public.model7_td1_rc_state
  where base_variant=p_base_variant for update;

  before_state := to_jsonb(s);

  if p_side='YES' then
    if p_result='WIN' then
      update public.model7_td1_rc_state set
        yes_consecutive_losses=0,
        yes_episode_armed=false,
        yes_slots_remaining=0,
        last_resolution_id=p_resolution_id,
        updated_at=now()
      where base_variant=p_base_variant;
    else
      new_losses := s.yes_consecutive_losses + 1;
      update public.model7_td1_rc_state set
        yes_consecutive_losses=new_losses,
        yes_slots_remaining=case
          when new_losses=3 and not s.yes_episode_armed then 2
          else s.yes_slots_remaining end,
        yes_episode_armed=case
          when new_losses=3 and not s.yes_episode_armed then true
          else s.yes_episode_armed end,
        last_resolution_id=p_resolution_id,
        updated_at=now()
      where base_variant=p_base_variant;
    end if;
  else
    if p_result='WIN' then
      update public.model7_td1_rc_state set
        no_consecutive_losses=0,
        no_episode_armed=false,
        no_slots_remaining=0,
        last_resolution_id=p_resolution_id,
        updated_at=now()
      where base_variant=p_base_variant;
    else
      new_losses := s.no_consecutive_losses + 1;
      update public.model7_td1_rc_state set
        no_consecutive_losses=new_losses,
        no_slots_remaining=case
          when new_losses=3 and not s.no_episode_armed then 2
          else s.no_slots_remaining end,
        no_episode_armed=case
          when new_losses=3 and not s.no_episode_armed then true
          else s.no_episode_armed end,
        last_resolution_id=p_resolution_id,
        updated_at=now()
      where base_variant=p_base_variant;
    end if;
  end if;

  select to_jsonb(x) into after_state
  from public.model7_td1_rc_state x where base_variant=p_base_variant;

  insert into public.model7_td1_rc_resolutions(
    resolution_id,prediction_id,candle_ts,base_variant,
    a2_decision,a2_counterfactual_result,state_before,state_after
  ) values (
    p_resolution_id,p_prediction_id,p_candle_ts,p_base_variant,
    p_side,p_result,before_state,after_state
  );

  return jsonb_build_object('applied',true,'idempotent',false,'state_after',after_state);
end;
$$;
