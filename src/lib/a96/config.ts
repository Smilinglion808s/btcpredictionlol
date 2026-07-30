// a96-r2 frozen production configuration. r2 is a patch that replaces r1's
// disagreement-selector / fit-leader logic with a single Layer-A directional
// source gated by a fixed margin band on layer_a_prob_mean.
export const A96_MODEL_NAME = "a96";
export const A96_MODEL_VERSION = "a96-r3";
export const A96_VARIANT = "layer-a-margin-agreement-efficiency";

export const A96_CONFIG = {
  // r2 margin band (frozen). |layer_a_prob_mean - 0.5| must fall in
  // [layer_a_margin_min_inclusive, layer_a_margin_max_exclusive).
  layer_a_margin_min_inclusive: 0.01,
  layer_a_margin_max_exclusive: 0.04,

  // Agreement-veto thresholds (unchanged from r1).
  agreement_distance_from_4_low_bps: 32.0,
  agreement_mean_2_body_to_range_max: 0.30,
  required_prior_candles: 4,
  expected_candle_seconds: 900,
  abstain_on_unusable_agreement_history: true,

  // r3 four-candle path-efficiency toxic band (frozen). ABSTAIN when
  // efficiency is in [min_inclusive, max_exclusive).
  four_candle_efficiency_veto_min_inclusive: 0.25,
  four_candle_efficiency_veto_max_exclusive: 0.40,


  // r1 fit-selector thresholds retained ONLY as audit constants — they are
  // NOT consulted by the r2 decision path. baseSelectedLayer and fitState
  // are still recorded on each row for auditability.
  fit_selector_min_resolved: 8,
  fit_selector_min_net_gap: 4,
} as const;

// Canonical candle stream. All a96-r2 operations must read from this single
// (symbol, timeframe, provider) tuple and require confirm=true.
export const A96_CANDLE_STREAM = {
  symbol: "BTC-USDT",
  timeframe: "15m",
  provider: "okx",
} as const;

// Consistency tolerances (basis points, target_open vs prior candle close /
// vs resolved actual_open). Anything beyond these is treated as a
// cross-stream / staleness fault, not a normal spot drift.
export const A96_TARGET_OPEN_TOLERANCE_BPS = 30;
export const A96_RESOLUTION_OPEN_TOLERANCE_BPS = 50;

// Retry-poll for the immediately-prior canonical candle.
export const A96_PRIOR_CANDLE_POLL_ATTEMPTS = 30;
export const A96_PRIOR_CANDLE_POLL_INTERVAL_MS = 3000;
