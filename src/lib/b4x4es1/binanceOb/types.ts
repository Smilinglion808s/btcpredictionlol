// B4x4-ES1 Binance Order-Book R1 — shared types.

import type { CaptureStatus, MarketKind } from "./config";

export type PriceLevel = [price: number, qty: number];

export interface DepthDiffEvent {
  /** Exchange event time (ms). */
  E: number;
  /** Transaction time (ms), futures only. */
  T?: number;
  s: string;
  U: number;
  u: number;
  /** Futures only: previous final update ID. */
  pu?: number;
  b: [string, string][];
  a: [string, string][];
  /** Futures only. */
  ps?: string;
  st?: number;
}

export interface DepthSnapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

/** Per-band book metrics. */
export interface BandMetrics {
  bidDepthBtc: number;
  askDepthBtc: number;
  totalDepthBtc: number;
  bidDepthUsd: number;
  askDepthUsd: number;
  totalDepthUsd: number;
  imbalance: number | null;
}

export interface BookMetrics {
  bestBid: number | null;
  bestBidQtyBtc: number | null;
  bestAsk: number | null;
  bestAskQtyBtc: number | null;
  midPrice: number | null;
  spreadBps: number | null;
  microprice: number | null;
  micropriceDisplacementBps: number | null;
  crossed: boolean;
  bands: Record<number, BandMetrics>;
}

/** One persisted derived observation (one integer second before the target). */
export interface ObservationRow {
  target_ts: string;
  market_kind: MarketKind;
  venue: string;
  symbol: string;
  sample_offset_seconds: number;
  sample_ts: string;
  feature_cutoff_ts: string;

  exchange_event_ts: string | null;
  received_at: string | null;
  exchange_to_receive_ms: number | null;
  target_age_ms: number | null;

  first_update_id: number | null;
  last_update_id: number | null;
  previous_update_id: number | null;
  sequence_ok: boolean;
  local_book_initialized: boolean;
  book_complete_10bps: boolean;
  resync_generation: number;
  update_count_1s: number;

  best_bid: number | null;
  best_bid_qty_btc: number | null;
  best_ask: number | null;
  best_ask_qty_btc: number | null;
  mid_price: number | null;
  spread_bps: number | null;
  microprice: number | null;
  microprice_displacement_bps: number | null;

  bid_depth_btc_1bps: number | null;
  ask_depth_btc_1bps: number | null;
  total_depth_btc_1bps: number | null;
  imbalance_1bps: number | null;
  bid_depth_btc_2bps: number | null;
  ask_depth_btc_2bps: number | null;
  total_depth_btc_2bps: number | null;
  imbalance_2bps: number | null;
  bid_depth_btc_5bps: number | null;
  ask_depth_btc_5bps: number | null;
  total_depth_btc_5bps: number | null;
  imbalance_5bps: number | null;
  bid_depth_btc_10bps: number | null;
  ask_depth_btc_10bps: number | null;
  total_depth_btc_10bps: number | null;
  bid_depth_usd_10bps: number | null;
  ask_depth_usd_10bps: number | null;
  total_depth_usd_10bps: number | null;
  imbalance_10bps: number | null;
  abs_imbalance_10bps: number | null;

  bid_added_btc_1s: number | null;
  bid_removed_btc_1s: number | null;
  ask_added_btc_1s: number | null;
  ask_removed_btc_1s: number | null;
  normalized_ofi_1s: number | null;

  capture_status: CaptureStatus;
  capture_reason: string | null;
  source_ws_url_id: string;
  collector_version: string;
  implementation_revision: string;
  build_identifier: string | null;
  config_hash: string;
  feature_schema_hash: string;
}

export type BoundaryFeatureRow = Record<string, unknown> & {
  id?: string;
  target_ts: string;
  market_kind: MarketKind;
  capture_status: CaptureStatus;
  ready: boolean;
  history_ready: boolean;
};

export interface PolicyInputs {
  finalImbalance10bps: number | null;
  absPercentile96: number | null;
  signPersistence15s: number | null;
  ready: boolean;
  historyReady: boolean;
}
