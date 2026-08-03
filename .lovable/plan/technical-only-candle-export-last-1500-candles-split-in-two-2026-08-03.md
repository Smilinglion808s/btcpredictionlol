# Technical-Only Candle Export — Last 1500 Candles, Split in Two

Two CSV files covering the most recent 1500 confirmed BTC-USDT 15m candles, containing only candle/market technical data. No model inputs, no model outputs, no predictions, no vetoes, no scoring.

## Files

- `btc15m_technical_part1_oldest750.csv` — candles 1–750 (oldest half)
- `btc15m_technical_part2_newest750.csv` — candles 751–1500 (newest half)

Both sorted oldest → newest, identical column sets.

## Source of truth

`candles` table filtered to `symbol='BTC-USDT'`, `timeframe='15m'`, `confirm=true`, `fetch_source='okx'`, ordered by `candle_ts`, last 1500 rows. Stored columns are OHLCV only, so every additional field is derived deterministically from that OHLCV series (using the same math already in the project's indicator helpers), computed with full lookback history so early rows are not warm-up-biased.

## Columns

Stored:
- `candle_ts` (UTC ISO), `candle_ts_mt`, `open`, `high`, `low`, `close`, `volume`, `volume_quote`, `confirm`, `fetch_source`

Candle anatomy:
- `direction` (GREEN/RED/DOJI), `body`, `body_pct_of_range`, `range`, `upper_wick`, `lower_wick`, `upper_wick_pct`, `lower_wick_pct`, `close_position_in_range`, `change_abs`, `change_pct`, `gap_from_prev_close`, `true_range`

Trend / moving averages:
- `ema9`, `ema21`, `ema50`, `ema200`, `sma20`, `ema9_minus_ema21`, `ema21_minus_ema50`, `dist_from_ema9_pct`, `dist_from_ema21_pct`, `dist_from_ema50_pct`, `ema_alignment` (UP/DOWN/MIXED), `trend_age_candles`, `close_slope_8`

Volatility:
- `atr14`, `atr14_pct`, `avg_range_20`, `range_expansion_vs_avg20`, `stdev_close_20`, `bb_upper_20_2`, `bb_lower_20_2`, `bb_width_pct`, `bb_position`

Momentum / oscillators:
- `rsi14`, `macd_line`, `macd_signal`, `macd_hist`, `macd_hist_over_atr14`, `roc_4`, `roc_8`, `momentum_8_over_atr`, `stoch_k14`, `stoch_d3`

Structure / channel:
- `high_20`, `low_20`, `channel_width_pct`, `channel_position_0_1`, `channel_zone`, `dist_to_high20_pct`, `dist_to_low20_pct`, `same_color_streak`, `higher_low_sequence_4`, `lower_high_sequence_4`, `failed_breakout_up`, `failed_breakout_down`, `bullish_liquidity_sweep`, `bearish_liquidity_sweep`, `inside_bar`, `outside_bar`

Volume:
- `vol_avg_20`, `volume_expansion`, `vol_zscore_20`, `signed_volume`, `cum_volume_delta_20`, `vwap_20`, `dist_from_vwap20_pct`

Path / efficiency (rolling, candle-only):
- `net_displacement_4`, `total_body_path_4`, `path_efficiency_4`, `mean_body_to_range_2`, `aligned_wick_pressure_4`, `dist_from_4_candle_low_bps`, `dist_from_4_candle_high_bps`

Continuity audit:
- `prev_candle_ts`, `gap_from_prev_seconds`, `boundary_contiguous`

## Explicitly excluded

No prediction rows, model versions, decisions, probabilities, vetoes, abstention reasons, layer selections, fit ids, results, or scores from any model (TD1-RC, a96, AAS96, Model 3/6/7/8, A2, B2/B4.2). Purely candle-derived.

## Technical notes

Generated as a one-off analysis script (not app code) reading the database directly; no application files change. Indicator math mirrors `src/lib/indicators.ts` and `src/lib/model6/telemetry.ts` conventions so values are consistent with what the app computes. Numeric fields rounded to 6 decimals; nulls left blank where lookback is insufficient. Both files delivered as downloadable artifacts.
