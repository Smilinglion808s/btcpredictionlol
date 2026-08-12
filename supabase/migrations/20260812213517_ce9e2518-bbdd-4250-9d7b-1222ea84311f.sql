ALTER TABLE public.v6_predictions
  ADD COLUMN IF NOT EXISTS r5_route_brake_revision text,
  ADD COLUMN IF NOT EXISTS r5_route_brake_activated_at text,
  ADD COLUMN IF NOT EXISTS r5_route_brake_pause_loss_threshold integer,
  ADD COLUMN IF NOT EXISTS r5_route_brake_resume_win_threshold integer,
  ADD COLUMN IF NOT EXISTS r5_route_brake_state_rebuilt boolean;