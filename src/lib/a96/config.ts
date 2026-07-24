// a96-r1 frozen production configuration. Do not tune these values during
// the first 300–500 resolved prospective candles.
export const A96_MODEL_NAME = "a96";
export const A96_MODEL_VERSION = "a96-r1";
export const A96_VARIANT = "a96";

export const A96_CONFIG = {
  fit_selector_min_resolved: 8,
  fit_selector_min_net_gap: 4,
  agreement_distance_from_4_low_bps: 32.0,
  agreement_mean_2_body_to_range_max: 0.30,
  required_prior_candles: 4,
  expected_candle_seconds: 900,
  abstain_on_unusable_agreement_history: true,
} as const;
