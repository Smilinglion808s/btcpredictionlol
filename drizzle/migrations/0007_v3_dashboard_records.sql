CREATE TABLE public.v3_worker_runtime (
  worker_id text PRIMARY KEY,
  status jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.v3_worker_runtime TO service_role;
ALTER TABLE public.v3_worker_runtime ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.v3_decisions (
  candle_open timestamptz PRIMARY KEY,
  status text NOT NULL,
  reason text,
  checkpoint integer,
  direction integer CHECK (direction IN (-1, 1)),
  rank double precision,
  t15_rank double precision,
  t30_rank double precision,
  decision_at timestamptz,
  fit_version text,
  delivery text,
  worker_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.v3_decisions TO service_role;
ALTER TABLE public.v3_decisions ENABLE ROW LEVEL SECURITY;
CREATE INDEX v3_decisions_status_idx ON public.v3_decisions (status, candle_open DESC);