// V6 — frozen deployment constants. Nothing here is tunable at runtime.

/** sha256 of `src/lib/v6/model.json` (V6_complete_model.json, byte-identical). */
export const V6_ARTIFACT_SHA256 =
  "b30889bfc1117f67bb81606bea664184330648e550dac402e43a42e592244146";

export const V6_MODEL_VERSION = "V6";
export const V6_FIT_ID = "v6-frozen-r1";
export const V6_FEATURE_SCHEMA_VERSION = "v6-72r-123gb-4a";

export const V6_CANDLE_STREAM = {
  symbol: "BTC-USDT",
  timeframe: "15m",
  provider: "okx",
} as const;

/** Candles pulled before T-15m so long-window indicators (EMA200/MACD) converge. */
export const V6_WARMUP_CANDLES = 800;

/** Minimum contiguous confirmed history required before inference may run. */
export const V6_MIN_HISTORY_CANDLES = 260;
