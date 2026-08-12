CREATE TABLE IF NOT EXISTS public.v6_r5_route_brake_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_key text NOT NULL,
  model_version text NOT NULL DEFAULT 'V6',
  model_revision text NOT NULL,
  pause_active boolean NOT NULL DEFAULT false,
  consecutive_shadow_losses integer NOT NULL DEFAULT 0,
  last_shadow_result text,
  last_shadow_target_ts timestamptz,
  last_shadow_prediction text,
  state_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v6_r5_route_brake_state_unique UNIQUE (model_revision, route_key)
);

GRANT ALL ON public.v6_r5_route_brake_state TO service_role;
ALTER TABLE public.v6_r5_route_brake_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages v6 route brake state"
  ON public.v6_r5_route_brake_state FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER v6_r5_route_brake_state_set_updated_at
  BEFORE UPDATE ON public.v6_r5_route_brake_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.v6_predictions
  ADD COLUMN IF NOT EXISTS r5_pre_brake_prediction text,
  ADD COLUMN IF NOT EXISTS r5_pre_brake_source text,
  ADD COLUMN IF NOT EXISTS r5_pre_brake_reason text,
  ADD COLUMN IF NOT EXISTS r5_green_route_brake_evaluable boolean,
  ADD COLUMN IF NOT EXISTS r5_green_route_pause_active boolean,
  ADD COLUMN IF NOT EXISTS r5_green_route_consecutive_shadow_losses integer,
  ADD COLUMN IF NOT EXISTS r5_green_route_brake_triggered boolean,
  ADD COLUMN IF NOT EXISTS r5_green_route_brake_reason text,
  ADD COLUMN IF NOT EXISTS r5_anchor_red_route_brake_evaluable boolean,
  ADD COLUMN IF NOT EXISTS r5_anchor_red_route_pause_active boolean,
  ADD COLUMN IF NOT EXISTS r5_anchor_red_route_consecutive_shadow_losses integer,
  ADD COLUMN IF NOT EXISTS r5_anchor_red_route_brake_triggered boolean,
  ADD COLUMN IF NOT EXISTS r5_anchor_red_route_brake_reason text,
  ADD COLUMN IF NOT EXISTS r5_route_brake_triggered boolean,
  ADD COLUMN IF NOT EXISTS r5_route_brake_route_key text,
  ADD COLUMN IF NOT EXISTS r5_route_brake_reason text,
  ADD COLUMN IF NOT EXISTS r5_route_brake_underlying_prediction text,
  ADD COLUMN IF NOT EXISTS r5_route_brake_underlying_actual text,
  ADD COLUMN IF NOT EXISTS r5_route_brake_underlying_result text,
  ADD COLUMN IF NOT EXISTS r5_route_brake_underlying_raw_score double precision,
  ADD COLUMN IF NOT EXISTS r5_route_brake_underlying_adjusted_score double precision,
  ADD COLUMN IF NOT EXISTS r5_route_brake_raw_contribution double precision,
  ADD COLUMN IF NOT EXISTS r5_route_brake_adjusted_contribution double precision,
  ADD COLUMN IF NOT EXISTS r5_green_route_shadow_eligible boolean,
  ADD COLUMN IF NOT EXISTS r5_green_route_shadow_result text,
  ADD COLUMN IF NOT EXISTS r5_green_route_shadow_streak_before integer,
  ADD COLUMN IF NOT EXISTS r5_green_route_shadow_streak_after integer,
  ADD COLUMN IF NOT EXISTS r5_green_route_pause_before_resolution boolean,
  ADD COLUMN IF NOT EXISTS r5_green_route_pause_after_resolution boolean,
  ADD COLUMN IF NOT EXISTS r5_anchor_red_route_shadow_eligible boolean,
  ADD COLUMN IF NOT EXISTS r5_anchor_red_route_shadow_result text,
  ADD COLUMN IF NOT EXISTS r5_anchor_red_route_shadow_streak_before integer,
  ADD COLUMN IF NOT EXISTS r5_anchor_red_route_shadow_streak_after integer,
  ADD COLUMN IF NOT EXISTS r5_anchor_red_route_pause_before_resolution boolean,
  ADD COLUMN IF NOT EXISTS r5_anchor_red_route_pause_after_resolution boolean;