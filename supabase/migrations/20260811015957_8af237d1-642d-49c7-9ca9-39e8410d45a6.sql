ALTER TABLE public.b4x4_predictions
  ADD COLUMN IF NOT EXISTS build_identifier text,
  ADD COLUMN IF NOT EXISTS deploy_environment text,
  ADD COLUMN IF NOT EXISTS build_commit_sha text;