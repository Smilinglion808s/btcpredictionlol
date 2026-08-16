// B4x4-ES1 Binance Order-Book R1 — frozen identity and constants.
//
// Binance Global only. Binance.US is never an acceptable substitute; an
// unreachable Global endpoint is recorded as REGION_BLOCKED.

import { createHash } from "crypto";

export const BINANCE_OB_VERSION = "binance-ob-r1" as const;
export const BINANCE_OB_COLLECTOR_VERSION = "binance-ob-collector-r1" as const;
export const BINANCE_OB_POLICY_VERSION = "binance-ob-policy-r1" as const;
export const BINANCE_OB_FEATURE_SCHEMA = "binance-ob-1s-60s-depth-1-2-5-10bps-r1-repair1" as const;
export const BINANCE_OB_DEFAULT_MODE = "SHADOW_ONLY" as const;
export const BINANCE_OB_PRIMARY_MARKET = "SPOT" as const;
export const BINANCE_OB_IMPLEMENTATION_REVISION = "binance-ob-r1-repair1" as const;
export const BINANCE_OB_PREVIOUS_IMPLEMENTATION_REVISION = "binance-ob-r1" as const;

export const BINANCE_OB_VENUE = "BINANCE_GLOBAL" as const;
export const BINANCE_OB_SYMBOL = "BTCUSDT" as const;
export const BINANCE_OB_RESOLVER_VERSION = "binance-ob-resolver-r1" as const;

/** Canonical outcome truth stays OKX — Binance is an explanatory input only. */
export const BINANCE_OB_OUTCOME_SOURCE = "OKX:BTC-USDT:15m:confirmed" as const;

export const TF_MS = 15 * 60 * 1000;

export const DEPTH_BANDS_BPS = [1, 2, 5, 10] as const;
export type DepthBandBps = (typeof DEPTH_BANDS_BPS)[number];

/** Observation window: offsets T-60s .. T-2s inclusive => 59 rows per market. */
export const OBS_START_OFFSET_S = 60;
export const OBS_END_OFFSET_S = 2;
export const EXPECTED_OBSERVATIONS = 59;
export const MIN_READY_OBSERVATIONS = 50;
export const FEATURE_CUTOFF_OFFSET_MS = 2_000;
export const MIN_TARGET_AGE_MS = 2_000;
export const MAX_TARGET_AGE_MS = 5_000;

/** Percentile history is strictly the previous 96 valid same-market rows. */
export const HISTORY_WINDOW = 96;

/** Collector heartbeat contract. */
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const HEARTBEAT_STALE_MS = 15_000;

/** Spot listen keys expire at 24h; warm a replacement before 23h50m. */
export const CONNECTION_ROLLOVER_MS = (23 * 60 + 50) * 60 * 1000;

export type MarketKind = "SPOT" | "USD_M_PERP";

export interface BinanceSourceConfig {
  marketKind: MarketKind;
  symbol: string;
  primary: boolean;
  wsUrl: string;
  wsAlternateUrl: string | null;
  snapshotUrl: string;
  snapshotLimit: number;
  sourceWsUrlId: string;
}

export const BINANCE_SOURCES: Record<MarketKind, BinanceSourceConfig> = {
  SPOT: {
    marketKind: "SPOT",
    symbol: BINANCE_OB_SYMBOL,
    primary: true,
    wsUrl: "wss://stream.binance.com:9443/ws/btcusdt@depth@100ms",
    wsAlternateUrl: "wss://stream.binance.com:443/ws/btcusdt@depth@100ms",
    snapshotUrl: "https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=5000",
    snapshotLimit: 5000,
    sourceWsUrlId: "binance-global-spot-btcusdt-depth-100ms",
  },
  USD_M_PERP: {
    marketKind: "USD_M_PERP",
    symbol: BINANCE_OB_SYMBOL,
    primary: false,
    wsUrl: "wss://fstream.binance.com/public/ws/btcusdt@depth@100ms",
    wsAlternateUrl: null,
    snapshotUrl: "https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000",
    snapshotLimit: 1000,
    sourceWsUrlId: "binance-global-usdm-btcusdt-depth-100ms",
  },
};

export const CAPTURE_STATUSES = [
  "FRESH",
  "STALE",
  "NO_DATA",
  "SEQUENCE_GAP",
  "RESYNCING",
  "INCOMPLETE_BOOK",
  "CROSSED_BOOK",
  "REST_FALLBACK",
  "REGION_BLOCKED",
  "COLLECTOR_ERROR",
] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const BINANCE_OB_POLICIES = [
  "SPOT_FOLLOW_CURRENT_BAND",
  "SPOT_FADE_CURRENT_BAND",
  "SPOT_FOLLOW_PERSISTENT",
  "SPOT_FADE_PERSISTENT",
  "SPOT_PERP_CONSENSUS_FOLLOW",
  "SPOT_PERP_CONSENSUS_FADE",
] as const;
export type BinanceObPolicyName = (typeof BINANCE_OB_POLICIES)[number];

export interface PolicyDefinition {
  name: BinanceObPolicyName;
  markets: MarketKind[];
  absPercentileMin: number;
  absPercentileMax: number;
  minSignPersistence15s: number | null;
  requireSignAgreement: boolean;
  fade: boolean;
}

export const POLICY_DEFINITIONS: readonly PolicyDefinition[] = [
  {
    name: "SPOT_FOLLOW_CURRENT_BAND",
    markets: ["SPOT"],
    absPercentileMin: 0.0,
    absPercentileMax: 0.6,
    minSignPersistence15s: null,
    requireSignAgreement: false,
    fade: false,
  },
  {
    name: "SPOT_FADE_CURRENT_BAND",
    markets: ["SPOT"],
    absPercentileMin: 0.0,
    absPercentileMax: 0.6,
    minSignPersistence15s: null,
    requireSignAgreement: false,
    fade: true,
  },
  {
    name: "SPOT_FOLLOW_PERSISTENT",
    markets: ["SPOT"],
    absPercentileMin: 0.2,
    absPercentileMax: 0.6,
    minSignPersistence15s: 0.7,
    requireSignAgreement: false,
    fade: false,
  },
  {
    name: "SPOT_FADE_PERSISTENT",
    markets: ["SPOT"],
    absPercentileMin: 0.2,
    absPercentileMax: 0.6,
    minSignPersistence15s: 0.7,
    requireSignAgreement: false,
    fade: true,
  },
  {
    name: "SPOT_PERP_CONSENSUS_FOLLOW",
    markets: ["SPOT", "USD_M_PERP"],
    absPercentileMin: 0.2,
    absPercentileMax: 0.6,
    minSignPersistence15s: 0.7,
    requireSignAgreement: true,
    fade: false,
  },
  {
    name: "SPOT_PERP_CONSENSUS_FADE",
    markets: ["SPOT", "USD_M_PERP"],
    absPercentileMin: 0.2,
    absPercentileMax: 0.6,
    minSignPersistence15s: 0.7,
    requireSignAgreement: true,
    fade: true,
  },
] as const;

function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

let configHashCache: string | null = null;
export function binanceObConfigHash(): string {
  configHashCache ??= sha({
    version: BINANCE_OB_VERSION,
    collector: BINANCE_OB_COLLECTOR_VERSION,
    policy: BINANCE_OB_POLICY_VERSION,
    venue: BINANCE_OB_VENUE,
    symbol: BINANCE_OB_SYMBOL,
    bands: DEPTH_BANDS_BPS,
    window: [OBS_START_OFFSET_S, OBS_END_OFFSET_S],
    expected: EXPECTED_OBSERVATIONS,
    minObs: MIN_READY_OBSERVATIONS,
    age: [MIN_TARGET_AGE_MS, MAX_TARGET_AGE_MS],
    history: HISTORY_WINDOW,
    sources: BINANCE_SOURCES,
    policies: POLICY_DEFINITIONS,
    revision: BINANCE_OB_IMPLEMENTATION_REVISION,
  });
  return configHashCache;
}

let schemaHashCache: string | null = null;
export function binanceObFeatureSchemaHash(): string {
  schemaHashCache ??= sha({
    schema: BINANCE_OB_FEATURE_SCHEMA,
    revision: BINANCE_OB_IMPLEMENTATION_REVISION,
    bands: DEPTH_BANDS_BPS,
    windows: [5, 15, 60],
    history: HISTORY_WINDOW,
  });
  return schemaHashCache;
}

export function valuesHash(values: Record<string, unknown>): string {
  const keys = Object.keys(values).sort();
  return sha(keys.map((k) => [k, values[k]]));
}

/** Exact 15-minute UTC boundary containing/preceding `ms`. */
export function floorTarget(ms: number): number {
  return Math.floor(ms / TF_MS) * TF_MS;
}

export function isExactBoundary(iso: string): boolean {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && ms % TF_MS === 0;
}

/** Boise-local calendar date for daily reporting. */
export function binanceObLocalDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Boise",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
