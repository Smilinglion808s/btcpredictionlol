CREATE TABLE public.v2_worker_runtime (
  worker_id text PRIMARY KEY,
  model_version text NOT NULL CHECK (model_version = 'v2-final-r1'),
  status jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.v2_worker_runtime TO service_role;
ALTER TABLE public.v2_worker_runtime ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.v2_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text NOT NULL CHECK (model_version = 'v2-final-r1'),
  candle_open timestamptz NOT NULL,
  checkpoint text NOT NULL CHECK (checkpoint IN ('T8','T45')),
  sleeve text NOT NULL CHECK (sleeve IN ('v2-direction8-r1','v2-fade8-r1','v2-direction45-r1')),
  side smallint CHECK (side IN (-1,0,1)),
  probability double precision,
  eligible boolean NOT NULL DEFAULT false,
  features_ready boolean NOT NULL,
  reason text,
  input_source text NOT NULL DEFAULT 'binance_spot_btcusdt',
  label_source text NOT NULL DEFAULT 'binance_index_direction_proxy',
  decision_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  receipt_latency_ms integer,
  worker_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (candle_open, checkpoint, sleeve)
);
GRANT ALL ON public.v2_checkpoints TO service_role;
ALTER TABLE public.v2_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE INDEX v2_checkpoints_candle_idx ON public.v2_checkpoints (candle_open DESC);

CREATE TABLE public.v2_candle_intents (
  candle_open timestamptz PRIMARY KEY,
  model_version text NOT NULL CHECK (model_version = 'v2-final-r1'),
  sleeve text NOT NULL CHECK (sleeve IN ('v2-direction8-r1','v2-fade8-r1','v2-direction45-r1')),
  checkpoint_id uuid NOT NULL REFERENCES public.v2_checkpoints(id),
  side smallint NOT NULL CHECK (side IN (-1,1)),
  execution text NOT NULL DEFAULT 'OFF' CHECK (execution = 'OFF'),
  stake_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.v2_candle_intents TO service_role;
ALTER TABLE public.v2_candle_intents ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.v2_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'V2_RECORD_IMMUTABLE'; END $$;
CREATE TRIGGER v2_checkpoints_immutable BEFORE UPDATE OR DELETE ON public.v2_checkpoints FOR EACH ROW EXECUTE FUNCTION public.v2_immutable();
CREATE TRIGGER v2_candle_intents_immutable BEFORE UPDATE OR DELETE ON public.v2_candle_intents FOR EACH ROW EXECUTE FUNCTION public.v2_immutable();