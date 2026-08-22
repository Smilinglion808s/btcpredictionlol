ALTER TABLE public.t45_pf_fits
  ADD CONSTRAINT t45_pf_fits_identity_block_key UNIQUE (model_version, block_start_index);

ALTER TABLE public.t45_pf_predictions
  ADD COLUMN IF NOT EXISTS execution_path text,
  ADD COLUMN IF NOT EXISTS repair_probability_green double precision,
  ADD COLUMN IF NOT EXISTS repair_confidence double precision,
  ADD COLUMN IF NOT EXISTS repair_confidence_rank double precision,
  ADD COLUMN IF NOT EXISTS repair_base_direction smallint,
  ADD COLUMN IF NOT EXISTS repair_would_trade boolean,
  ADD COLUMN IF NOT EXISTS repair_prediction smallint,
  ADD COLUMN IF NOT EXISTS repair_fit_id text,
  ADD COLUMN IF NOT EXISTS repair_state_checksum text,
  ADD COLUMN IF NOT EXISTS repaired_at timestamptz;

CREATE OR REPLACE FUNCTION public.t45pf_mint_lock(p_block_start integer)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('t45pf_fit_mint:' || p_block_start::text, 0)) IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.t45pf_mint_lock(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.t45pf_mint_lock(integer) TO service_role;