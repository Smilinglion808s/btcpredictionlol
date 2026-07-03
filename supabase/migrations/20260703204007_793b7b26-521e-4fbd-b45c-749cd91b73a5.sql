
CREATE TABLE public.model_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version TEXT NOT NULL,
  api_model_id TEXT,
  prompt_template TEXT NOT NULL,
  indicator_weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_threshold NUMERIC,
  auto_run_enabled BOOLEAN,
  require_manual_approval BOOLEAN,
  notes TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_archives TO authenticated;
GRANT ALL ON public.model_archives TO service_role;

ALTER TABLE public.model_archives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read model archives"
  ON public.model_archives FOR SELECT
  USING (true);

CREATE INDEX idx_model_archives_archived_at ON public.model_archives (archived_at DESC);
