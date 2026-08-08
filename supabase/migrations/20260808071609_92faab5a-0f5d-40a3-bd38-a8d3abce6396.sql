CREATE TABLE IF NOT EXISTS public.b4x4_ob_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_candle_ts timestamptz NOT NULL,
  provider text NOT NULL DEFAULT 'okx',
  instrument text NOT NULL DEFAULT 'BTC-USDT',
  shadow_version text NOT NULL DEFAULT 'b4x4-ob-shadow-v1',
  captured_at timestamptz NOT NULL DEFAULT now(),
  event_ts timestamptz,
  feature_cutoff_ts timestamptz,
  book_json jsonb,
  trades_json jsonb,
  seq_id text,
  prev_seq_id text,
  book_complete boolean,
  sequence_gap boolean,
  sequence_gap_count integer,
  trade_window_start_ts timestamptz,
  trade_event_count integer,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS b4x4_ob_snapshots_target_uidx
  ON public.b4x4_ob_snapshots (target_candle_ts);

GRANT SELECT ON public.b4x4_ob_snapshots TO authenticated;
GRANT ALL ON public.b4x4_ob_snapshots TO service_role;
ALTER TABLE public.b4x4_ob_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read b4x4 ob snapshots"
  ON public.b4x4_ob_snapshots FOR SELECT TO authenticated USING (true);

CREATE TRIGGER b4x4_ob_snapshots_set_updated_at
  BEFORE UPDATE ON public.b4x4_ob_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.b4x4_shadow_market_data
  ADD COLUMN IF NOT EXISTS shadow_version text DEFAULT 'b4x4-ob-shadow-v1',
  ADD COLUMN IF NOT EXISTS provider text DEFAULT 'okx',
  ADD COLUMN IF NOT EXISTS instrument text DEFAULT 'BTC-USDT',
  ADD COLUMN IF NOT EXISTS shadow_only boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS used_in_decision boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS run_mode text,
  ADD COLUMN IF NOT EXISTS capture_status text,
  ADD COLUMN IF NOT EXISTS snapshot_event_ts timestamptz,
  ADD COLUMN IF NOT EXISTS snapshot_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS snapshot_persisted_at timestamptz,
  ADD COLUMN IF NOT EXISTS snapshot_age_ms double precision,
  ADD COLUMN IF NOT EXISTS source_seq_id text,
  ADD COLUMN IF NOT EXISTS prev_seq_id text,
  ADD COLUMN IF NOT EXISTS sequence_gap boolean,
  ADD COLUMN IF NOT EXISTS sequence_gap_count integer,
  ADD COLUMN IF NOT EXISTS book_complete boolean,
  ADD COLUMN IF NOT EXISTS collector_error_code text,
  ADD COLUMN IF NOT EXISTS collector_error_message text,
  ADD COLUMN IF NOT EXISTS best_bid_price double precision,
  ADD COLUMN IF NOT EXISTS best_bid_qty double precision,
  ADD COLUMN IF NOT EXISTS best_ask_price double precision,
  ADD COLUMN IF NOT EXISTS best_ask_qty double precision,
  ADD COLUMN IF NOT EXISTS mid_price double precision,
  ADD COLUMN IF NOT EXISTS spread_abs double precision,
  ADD COLUMN IF NOT EXISTS spread_bps double precision,
  ADD COLUMN IF NOT EXISTS microprice double precision,
  ADD COLUMN IF NOT EXISTS microprice_offset_bps double precision,
  ADD COLUMN IF NOT EXISTS depth_json jsonb,
  ADD COLUMN IF NOT EXISTS queue_imbalance_top1 double precision,
  ADD COLUMN IF NOT EXISTS queue_imbalance_top5 double precision,
  ADD COLUMN IF NOT EXISTS queue_imbalance_top20 double precision,
  ADD COLUMN IF NOT EXISTS depth_imbalance_1bps double precision,
  ADD COLUMN IF NOT EXISTS depth_imbalance_5bps double precision,
  ADD COLUMN IF NOT EXISTS depth_imbalance_10bps double precision,
  ADD COLUMN IF NOT EXISTS depth_imbalance_25bps double precision,
  ADD COLUMN IF NOT EXISTS trade_flow_json jsonb,
  ADD COLUMN IF NOT EXISTS taker_delta_30s double precision,
  ADD COLUMN IF NOT EXISTS taker_delta_2m double precision,
  ADD COLUMN IF NOT EXISTS taker_delta_3m double precision,
  ADD COLUMN IF NOT EXISTS taker_delta_5m double precision,
  ADD COLUMN IF NOT EXISTS taker_delta_15m double precision,
  ADD COLUMN IF NOT EXISTS cvd_3m double precision,
  ADD COLUMN IF NOT EXISTS trade_windows_complete boolean,
  ADD COLUMN IF NOT EXISTS trade_event_count integer,
  ADD COLUMN IF NOT EXISTS add_cancel_add_total double precision,
  ADD COLUMN IF NOT EXISTS add_cancel_cancel_total double precision,
  ADD COLUMN IF NOT EXISTS add_cancel_imbalance double precision,
  ADD COLUMN IF NOT EXISTS add_cancel_source_available boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS missing_source_capabilities text,
  ADD COLUMN IF NOT EXISTS flow_component_count integer,
  ADD COLUMN IF NOT EXISTS flow_composite_score double precision,
  ADD COLUMN IF NOT EXISTS flow_direction text,
  ADD COLUMN IF NOT EXISTS flow_strength double precision,
  ADD COLUMN IF NOT EXISTS flow_coherent boolean,
  ADD COLUMN IF NOT EXISTS raw_direction_relationship text,
  ADD COLUMN IF NOT EXISTS b4x4_raw_direction text,
  ADD COLUMN IF NOT EXISTS b4x4_final_prediction text,
  ADD COLUMN IF NOT EXISTS b4x4_published boolean,
  ADD COLUMN IF NOT EXISTS actual_direction text,
  ADD COLUMN IF NOT EXISTS raw_direction_correct boolean,
  ADD COLUMN IF NOT EXISTS b4x4_result text,
  ADD COLUMN IF NOT EXISTS b4x4_result_score double precision,
  ADD COLUMN IF NOT EXISTS shadow_resolved_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS b4x4_shadow_prediction_uidx
  ON public.b4x4_shadow_market_data (b4x4_prediction_id);