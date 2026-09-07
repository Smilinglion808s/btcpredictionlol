-- ============================================================
-- C85 MULTI_META (c85-multi-meta-r1) — durable model storage
-- ============================================================

-- 1. Fitted artifact registry -------------------------------------------------
CREATE TABLE public.c85_model_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_version TEXT NOT NULL DEFAULT 'c85-multi-meta-r1',
  kind TEXT NOT NULL,                       -- C71_DIRECTION | C85_META | AUX_LONG | AUX_RECENT
  as_of_utc TIMESTAMPTZ NOT NULL,           -- UTC block / month boundary this fit applies from
  applies_from_utc TIMESTAMPTZ NOT NULL,
  applies_to_utc TIMESTAMPTZ,
  training_cutoff_utc TIMESTAMPTZ NOT NULL, -- labels strictly before this
  training_rows INTEGER,
  eligible_rows INTEGER,
  positive_rows INTEGER,
  feature_order_sha256 TEXT NOT NULL,
  training_data_sha256 TEXT,
  artifact_sha256 TEXT NOT NULL,
  artifact_storage TEXT,                    -- private object path (pickles/JSON)
  artifact_json JSONB,                      -- portable logistic state (heads only)
  recipe JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'WORKER_FIT',-- KIT_EXPORT | WORKER_FIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_version, kind, as_of_utc)
);
GRANT SELECT ON public.c85_model_versions TO authenticated;
GRANT ALL ON public.c85_model_versions TO service_role;
ALTER TABLE public.c85_model_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "c85_model_versions_read" ON public.c85_model_versions
  FOR SELECT TO authenticated USING (true);

-- 2. Per-target decision rows -------------------------------------------------
CREATE TABLE public.c85_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_version TEXT NOT NULL DEFAULT 'c85-multi-meta-r1',
  ticker TEXT NOT NULL,
  target_open_utc TIMESTAMPTZ NOT NULL,
  deadline_utc TIMESTAMPTZ NOT NULL,        -- target_open + 5s
  run_mode TEXT NOT NULL DEFAULT 'LIVE',    -- LIVE | RESEARCH_BACKFILL | BRIDGE
  status TEXT NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED|COMPUTING|PUBLISHED|ABSTAIN|INVALID|EXPIRED|MISSED|ERROR
  status_reason TEXT,

  -- validity chain
  binance_complete BOOLEAN,
  anchor_valid BOOLEAN,
  cm_valid BOOLEAN,
  auxiliary_valid BOOLEAN,
  source_ok BOOLEAN,
  core_valid BOOLEAN,
  structure_valid BOOLEAN,
  market_q1 BOOLEAN,

  -- heads (distinctly labelled; a rank is NOT a win probability)
  probability_yes DOUBLE PRECISION,
  proposal SMALLINT,
  probability_correct DOUBLE PRECISION,
  aux_long_logit DOUBLE PRECISION,
  aux_long_logscale DOUBLE PRECISION,
  aux_recent_logit DOUBLE PRECISION,
  aux_recent_logscale DOUBLE PRECISION,

  -- rank family 1 (admission)
  admission_rank DOUBLE PRECISION,
  admission_rank_count INTEGER,
  -- rank family 2 (final filter)
  filter_rank DOUBLE PRECISION,
  filter_rank_count INTEGER,

  -- decision chain
  core_side SMALLINT,
  extension BOOLEAN,
  last_yes_price DOUBLE PRECISION,
  base_side SMALLINT,
  weak BOOLEAN,
  deterioration_ewma16 DOUBLE PRECISION,
  deterioration_ewma128 DOUBLE PRECISION,
  deterioration_settled_count INTEGER,
  deterioration_warmup BOOLEAN,
  final_side SMALLINT,
  gate_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  consumed_state_cutoff_ns BIGINT,

  -- provenance / inputs (immutable once published)
  direction_fit_id UUID REFERENCES public.c85_model_versions(id),
  meta_fit_id UUID REFERENCES public.c85_model_versions(id),
  aux_fit_month TEXT,
  feature_order_sha256 TEXT,
  features JSONB,
  source_ids JSONB,
  source_hash TEXT,

  -- timing evidence (ns as 64-bit; never a JS Number round-trip)
  target_open_ns BIGINT,
  packet_freeze_ns BIGINT,
  last_event_ns BIGINT,
  last_receipt_ns BIGINT,
  feed_watermarks JSONB,
  compute_started_ns BIGINT,
  compute_complete_ns BIGINT,
  decision_durable_ns BIGINT,
  dispatch_ns BIGINT,
  publication_offset_ms DOUBLE PRECISION,
  deadline_met BOOLEAN,

  -- execution separated from model quality
  webhook_dedupe_key TEXT,
  webhook_status TEXT,
  webhook_attempts INTEGER NOT NULL DEFAULT 0,
  webhook_last_error TEXT,
  executed BOOLEAN NOT NULL DEFAULT false,

  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_version, ticker, target_open_utc)
);
CREATE INDEX c85_targets_open_idx ON public.c85_targets (target_open_utc DESC);
CREATE INDEX c85_targets_mode_status_idx ON public.c85_targets (run_mode, status);
GRANT SELECT ON public.c85_targets TO authenticated;
GRANT ALL ON public.c85_targets TO service_role;
ALTER TABLE public.c85_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "c85_targets_read" ON public.c85_targets
  FOR SELECT TO authenticated USING (true);

-- 3. Official settlements (never overwrite the call) --------------------------
CREATE TABLE public.c85_settlements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_version TEXT NOT NULL DEFAULT 'c85-multi-meta-r1',
  ticker TEXT NOT NULL,
  target_open_utc TIMESTAMPTZ NOT NULL,
  settlement_source TEXT NOT NULL DEFAULT 'KALSHI_OFFICIAL',
  official_result TEXT,                     -- YES | NO | VOID | PENDING
  label SMALLINT,                           -- +1 YES, -1 NO, NULL void/pending
  settlement_ts TIMESTAMPTZ,
  settlement_ns BIGINT,
  settlement_value DOUBLE PRECISION,
  outcome TEXT,                             -- WIN | LOSS | ABSTAIN | VOID | PENDING
  raw_net SMALLINT,                         -- +1 / -1 / 0
  consumed_by_deterioration_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_version, ticker, target_open_utc, settlement_source)
);
CREATE INDEX c85_settlements_open_idx ON public.c85_settlements (target_open_utc DESC);
GRANT SELECT ON public.c85_settlements TO authenticated;
GRANT ALL ON public.c85_settlements TO service_role;
ALTER TABLE public.c85_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "c85_settlements_read" ON public.c85_settlements
  FOR SELECT TO authenticated USING (true);

-- 4. Atomic monotonic checkpoints ---------------------------------------------
CREATE TABLE public.c85_state_checkpoints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_version TEXT NOT NULL DEFAULT 'c85-multi-meta-r1',
  checkpoint_seq BIGINT NOT NULL,
  as_of_utc TIMESTAMPTZ NOT NULL,
  last_processed_target_utc TIMESTAMPTZ,
  next_target_utc TIMESTAMPTZ,
  stage TEXT NOT NULL DEFAULT 'INIT',       -- INIT|VERIFY|SEED|BRIDGE|FITTING|READY|BLOCKED
  admission_rank_state JSONB NOT NULL DEFAULT '{}'::jsonb,  -- YES/NO 768-score queues
  filter_rank_state JSONB NOT NULL DEFAULT '{}'::jsonb,     -- second rank family
  deterioration_state JSONB NOT NULL DEFAULT '{}'::jsonb,   -- pooled EWMAs + counts
  pending_base_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
  consumed_settlements JSONB NOT NULL DEFAULT '[]'::jsonb,
  expert_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  applicable_fits JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_watermarks JSONB NOT NULL DEFAULT '{}'::jsonb,
  state_sha256 TEXT NOT NULL,
  parent_sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_version, checkpoint_seq)
);
CREATE INDEX c85_checkpoints_latest_idx
  ON public.c85_state_checkpoints (model_version, checkpoint_seq DESC);
GRANT SELECT ON public.c85_state_checkpoints TO authenticated;
GRANT ALL ON public.c85_state_checkpoints TO service_role;
ALTER TABLE public.c85_state_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "c85_checkpoints_read" ON public.c85_state_checkpoints
  FOR SELECT TO authenticated USING (true);

-- 5. Worker health -------------------------------------------------------------
CREATE TABLE public.c85_worker_health (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_version TEXT NOT NULL DEFAULT 'c85-multi-meta-r1',
  worker_id TEXT NOT NULL,
  readiness TEXT NOT NULL DEFAULT 'WARMING', -- WARMING | READY | BLOCKED
  stage TEXT,
  blocking_reason TEXT,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  feed_freshness JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_as_of_utc TIMESTAMPTZ,
  last_target_utc TIMESTAMPTZ,
  next_target_utc TIMESTAMPTZ,
  last_checkpoint_seq BIGINT,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  build_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_version, worker_id)
);
GRANT SELECT ON public.c85_worker_health TO authenticated;
GRANT ALL ON public.c85_worker_health TO service_role;
ALTER TABLE public.c85_worker_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "c85_worker_health_read" ON public.c85_worker_health
  FOR SELECT TO authenticated USING (true);

-- 6. Webhook outbox --------------------------------------------------------------
CREATE TABLE public.c85_outbox (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,          -- C85:<version>:<ticker>:<target>
  target_id UUID NOT NULL REFERENCES public.c85_targets(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',    -- PENDING|SENT|FAILED|EXPIRED|SUPPRESSED
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  not_before TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  response_status INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX c85_outbox_state_idx ON public.c85_outbox (state, not_before);
GRANT SELECT ON public.c85_outbox TO authenticated;
GRANT ALL ON public.c85_outbox TO service_role;
ALTER TABLE public.c85_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "c85_outbox_read" ON public.c85_outbox
  FOR SELECT TO authenticated USING (true);

-- updated_at triggers ----------------------------------------------------------
CREATE TRIGGER c85_model_versions_set_updated_at BEFORE UPDATE ON public.c85_model_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER c85_targets_set_updated_at BEFORE UPDATE ON public.c85_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER c85_settlements_set_updated_at BEFORE UPDATE ON public.c85_settlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER c85_worker_health_set_updated_at BEFORE UPDATE ON public.c85_worker_health
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER c85_outbox_set_updated_at BEFORE UPDATE ON public.c85_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Immutability: a published live decision's model inputs cannot be rewritten.
CREATE OR REPLACE FUNCTION public.c85_targets_guard_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.published_at IS NOT NULL AND OLD.run_mode = 'LIVE' THEN
    IF NEW.final_side IS DISTINCT FROM OLD.final_side
       OR NEW.probability_yes IS DISTINCT FROM OLD.probability_yes
       OR NEW.probability_correct IS DISTINCT FROM OLD.probability_correct
       OR NEW.features IS DISTINCT FROM OLD.features
       OR NEW.target_open_utc IS DISTINCT FROM OLD.target_open_utc
       OR NEW.ticker IS DISTINCT FROM OLD.ticker THEN
      RAISE EXCEPTION 'c85_targets: published live decision is immutable (%)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER c85_targets_immutable BEFORE UPDATE ON public.c85_targets
  FOR EACH ROW EXECUTE FUNCTION public.c85_targets_guard_immutable();