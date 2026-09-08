CREATE TABLE IF NOT EXISTS public.c85_deployment_bundles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_version TEXT NOT NULL,
  bundle_version TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'c85-bundles',
  storage_path TEXT NOT NULL,
  bundle_sha256 TEXT NOT NULL,
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_count INTEGER,
  byte_size BIGINT,
  checkpoint_utc TIMESTAMPTZ,
  last_processed_target_utc TIMESTAMPTZ,
  direction_fit_cutoff_utc TIMESTAMPTZ,
  meta_fit_cutoff_utc TIMESTAMPTZ,
  aux_fit_month TEXT,
  source_watermarks JSONB NOT NULL DEFAULT '{}'::jsonb,
  parity_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  built_by TEXT,
  build_sha TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  CONSTRAINT c85_deployment_bundles_status_chk
    CHECK (status IN ('PENDING','VERIFIED','ACTIVE','SUPERSEDED','REJECTED')),
  CONSTRAINT c85_deployment_bundles_version_uniq UNIQUE (model_version, bundle_version)
);

CREATE INDEX IF NOT EXISTS c85_deployment_bundles_active_idx
  ON public.c85_deployment_bundles (model_version, status, created_at DESC);

GRANT SELECT ON public.c85_deployment_bundles TO authenticated;
GRANT ALL ON public.c85_deployment_bundles TO service_role;

ALTER TABLE public.c85_deployment_bundles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users can read C85 bundles" ON public.c85_deployment_bundles;
CREATE POLICY "Signed-in users can read C85 bundles"
  ON public.c85_deployment_bundles FOR SELECT TO authenticated USING (true);

-- Exactly one ACTIVE bundle per model version; activation supersedes the rest.
CREATE OR REPLACE FUNCTION public.c85_activate_bundle(p_model_version TEXT, p_bundle_version TEXT)
RETURNS public.c85_deployment_bundles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.c85_deployment_bundles;
BEGIN
  UPDATE public.c85_deployment_bundles
     SET status = 'SUPERSEDED'
   WHERE model_version = p_model_version
     AND status = 'ACTIVE'
     AND bundle_version <> p_bundle_version;

  UPDATE public.c85_deployment_bundles
     SET status = 'ACTIVE', activated_at = now()
   WHERE model_version = p_model_version
     AND bundle_version = p_bundle_version
  RETURNING * INTO row;

  IF row.id IS NULL THEN
    RAISE EXCEPTION 'c85 bundle % / % not found', p_model_version, p_bundle_version;
  END IF;
  RETURN row;
END;
$$;

REVOKE ALL ON FUNCTION public.c85_activate_bundle(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.c85_activate_bundle(TEXT, TEXT) TO service_role;