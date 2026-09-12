
CREATE TABLE public.v11_context_rows (
  target_ts timestamptz PRIMARY KEY,
  ticker text NOT NULL DEFAULT '',
  input_valid boolean NOT NULL DEFAULT false,
  label smallint,
  settlement_ts timestamptz,
  feats jsonb NOT NULL,
  source text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.v11_context_rows TO service_role;
ALTER TABLE public.v11_context_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v11_context_rows service only" ON public.v11_context_rows FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.v11_vectors (
  target_ts timestamptz PRIMARY KEY,
  vector jsonb,
  vol double precision,
  valid boolean NOT NULL DEFAULT false,
  missing jsonb NOT NULL DEFAULT '[]'::jsonb,
  label smallint,
  settlement_ts timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX v11_vectors_valid_ts_idx ON public.v11_vectors (valid, target_ts);
GRANT ALL ON public.v11_vectors TO service_role;
ALTER TABLE public.v11_vectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v11_vectors service only" ON public.v11_vectors FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.v11_heads (
  fit_date date PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  scaler jsonb NOT NULL,
  coefficients jsonb NOT NULL,
  intercept double precision NOT NULL,
  training_rows integer NOT NULL,
  training_start_ts timestamptz NOT NULL,
  training_end_ts timestamptz NOT NULL,
  training_fingerprint text NOT NULL,
  converged boolean NOT NULL,
  iterations integer NOT NULL,
  gradient_norm double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.v11_heads TO service_role;
ALTER TABLE public.v11_heads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v11_heads service only" ON public.v11_heads FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.v11_scores (
  target_ts timestamptz PRIMARY KEY,
  ticker text NOT NULL DEFAULT '',
  head_date date,
  probability double precision,
  confidence double precision,
  rank double precision,
  rank_history integer NOT NULL DEFAULT 0,
  availability double precision,
  admission_gate double precision,
  valid boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.v11_scores TO service_role;
ALTER TABLE public.v11_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v11_scores service only" ON public.v11_scores FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.v11_decisions (
  target_ts timestamptz PRIMARY KEY,
  ticker text NOT NULL DEFAULT '',
  event_key text NOT NULL UNIQUE,
  leg text,
  side smallint NOT NULL DEFAULT 0,
  reason text NOT NULL,
  probability double precision,
  rank double precision,
  admission_gate double precision,
  head_date date,
  v1_status text,
  v1_reason text,
  v1_final_side smallint,
  v1_floor_open boolean,
  v1_send_claim text NOT NULL DEFAULT 'unknown',
  strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  dispatch_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.v11_decisions TO service_role;
ALTER TABLE public.v11_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v11_decisions service only" ON public.v11_decisions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.v11_decisions_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'v11_decisions rows are append-only';
END;
$$;
CREATE TRIGGER v11_decisions_no_update BEFORE UPDATE ON public.v11_decisions
  FOR EACH ROW EXECUTE FUNCTION public.v11_decisions_immutable();

CREATE TABLE public.v11_state (
  state_key text PRIMARY KEY,
  last_processed_ts timestamptz,
  last_fit_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.v11_state TO service_role;
ALTER TABLE public.v11_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v11_state service only" ON public.v11_state FOR ALL TO service_role USING (true) WITH CHECK (true);
