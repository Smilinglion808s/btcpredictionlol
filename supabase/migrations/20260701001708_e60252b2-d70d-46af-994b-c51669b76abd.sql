
-- Ensure only 2.1 is active
UPDATE public.model_settings SET is_active = false WHERE model_version <> 'BTC 15m Model 2.1';

WITH spec AS (
  SELECT '{
    "model_id": "btc15m_m2_1",
    "model_name": "BTC 15m Model 2.1",
    "active": true,
    "asset": "BTCUSDT",
    "timeframe": "15m",
    "default_run_type": "Run Next",
    "confidence_definition": "Confidence represents likelihood that the prediction is correct, not just signal strength.",
    "minimum_trade_confidence": "3/5",
    "indicator_weights": {
      "completed_candle_structure": 16.0,
      "failed_breakout_rejection_zones": 8.0,
      "wick_rejection_defense": 13.0,
      "reclaim_breakdown_behavior": 10.0,
      "support_resistance_proximity": 7.0,
      "last_8_candle_momentum": 10.0,
      "candle_close_location": 6.0,
      "ma7_direction": 5.0,
      "previous_wick_reaction": 6.0,
      "volume": 5.0,
      "current_candle_vs_open": 0.5,
      "bullish_liquidity_sweep_bear_trap_reclaim": 8.0,
      "bearish_exhaustion_downside_failure": 5.5
    },
    "new_indicator_rules": {
      "bullish_liquidity_sweep_bear_trap_reclaim": [
        "Recent candle sweeps below prior low or support.",
        "Price fails to continue lower.",
        "Candle closes back inside prior range.",
        "Large lower wick forms.",
        "Taker-buy volume improves.",
        "Next candle opens near or above reclaim level."
      ],
      "bearish_exhaustion_downside_failure": [
        "Multiple red candles but downside expansion slows.",
        "Lower lows stop extending cleanly.",
        "Volume rises but price stops dropping.",
        "Prior candle closes off the low.",
        "Large lower wick appears after sell pressure.",
        "Price is stretched below MA(7) and vulnerable to mean reversion."
      ]
    },
    "trade_filter": {
      "1/5": "Avoid — noisy or coin flip.",
      "2/5": "Avoid — directional lean only.",
      "3/5": "Tradable edge.",
      "4/5": "Strong trade setup.",
      "5/5": "Extremely rare."
    },
    "outputs": {
      "YES": "Candle likely closes above its open.",
      "NO": "Candle likely closes below its open.",
      "NO CLEAR EDGE": "No clean directional edge."
    },
    "grading_rules": {
      "YES": "WIN if target candle close > target candle open; LOSS if target candle close <= target candle open.",
      "NO": "WIN if target candle close < target candle open; LOSS if target candle close >= target candle open.",
      "NO CLEAR EDGE": "Mark N/A or skip grading."
    }
  }'::jsonb AS s
)
UPDATE public.model_settings ms
SET
  is_active = true,
  api_model_id = 'btc15m_m2_1',
  confidence_threshold = 60,
  indicator_weights = (SELECT s->'indicator_weights' FROM spec),
  prompt_template = 'You are running BTC 15m Model 2.1 (spec id btc15m_m2_1) on BTCUSDT 15m candles.
Default run_type = "Run Next" -> predict whether the NEXT 15m candle closes above (YES) or below (NO) its own open. Use "NO CLEAR EDGE" when no clean directional edge exists.
Confidence represents the likelihood the call is correct (not signal strength), on a 1/5 to 5/5 scale. Minimum tradable confidence is 3/5. Trade filter:
- 1/5: Avoid — noisy or coin flip.
- 2/5: Avoid — directional lean only.
- 3/5: Tradable edge.
- 4/5: Strong trade setup.
- 5/5: Extremely rare.

Apply the supplied indicator_weights. Two indicators have explicit rules — ALL sub-conditions should broadly line up before you lean on them:

bullish_liquidity_sweep_bear_trap_reclaim (weight 8.0):
- Recent candle sweeps below prior low or support.
- Price fails to continue lower.
- Candle closes back inside prior range.
- Large lower wick forms.
- Taker-buy volume improves.
- Next candle opens near or above reclaim level.

bearish_exhaustion_downside_failure (weight 5.5):
- Multiple red candles but downside expansion slows.
- Lower lows stop extending cleanly.
- Volume rises but price stops dropping.
- Prior candle closes off the low.
- Large lower wick appears after sell pressure.
- Price is stretched below MA(7) and vulnerable to mean reversion.

Cap confidence at 2/5 when price is directly under resistance / above support / at a major round number, when the signal candle already made a large extended move, when there is a large wick against the prediction, when price is flipping around the candle open, when volume looks like absorption, or when Run Next would require chasing an extended candle. Allow 3/5+ only when documented YES or NO conditions are clearly met.

Grading (informational):
- YES: WIN if target candle close > target candle open; else LOSS.
- NO: WIN if target candle close < target candle open; else LOSS.
- NO CLEAR EDGE: skipped (push).

Use only the supplied closed candles and computed indicators.

Respond with JSON only in this exact shape:
{
  "model": "BTC 15m Model 2.1",
  "run_type": "Run Next",
  "target_candle": "<15m UTC window e.g. 2026-06-30T20:00:00Z -> 20:15:00Z>",
  "call": "YES" | "NO" | "NO CLEAR EDGE",
  "confidence": "1/5" | "2/5" | "3/5" | "4/5" | "5/5",
  "trade_status": "TRADE" | "SKIP",
  "flip_level": "<price level invalidating the call>",
  "confirmation_level": "<price level strengthening the call>",
  "final_interpretation": "<short label summarizing the setup>",
  "notes": "<short reason>"
}',
  updated_at = now()
WHERE ms.model_version = 'BTC 15m Model 2.1';

-- If the row didn't exist, insert it.
INSERT INTO public.model_settings (model_version, api_model_id, is_active, confidence_threshold, auto_run_enabled, require_manual_approval, indicator_weights, prompt_template)
SELECT 'BTC 15m Model 2.1', 'btc15m_m2_1', true, 60, true, false,
  '{
    "completed_candle_structure": 16.0,
    "failed_breakout_rejection_zones": 8.0,
    "wick_rejection_defense": 13.0,
    "reclaim_breakdown_behavior": 10.0,
    "support_resistance_proximity": 7.0,
    "last_8_candle_momentum": 10.0,
    "candle_close_location": 6.0,
    "ma7_direction": 5.0,
    "previous_wick_reaction": 6.0,
    "volume": 5.0,
    "current_candle_vs_open": 0.5,
    "bullish_liquidity_sweep_bear_trap_reclaim": 8.0,
    "bearish_exhaustion_downside_failure": 5.5
  }'::jsonb,
  'See updated prompt in migration.'
WHERE NOT EXISTS (SELECT 1 FROM public.model_settings WHERE model_version = 'BTC 15m Model 2.1');
