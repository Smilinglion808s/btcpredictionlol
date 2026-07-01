## What's missing today

The last Model 2.1 update saved the **weights** and the **scoring/confidence/cap rules** into `model_settings.prompt_template`, but it did NOT include the per-indicator `indicator_logic` block — the bullish / bearish / neutral criteria that tell the model when to score an indicator +1, +0.5, 0, -0.5, or -1.

Without that block, the model has to guess what "bullish" means for e.g. `wick_rejection_defense` vs `reclaim_breakdown_behavior`. Weights are applied, but the scores feeding those weights are not grounded in your spec.

## Fix

Update the active Model 2.1 row in `model_settings` and extend `prompt_template` to embed the full `indicator_logic` from your spec, for all 12 indicators:

- completed_candle_structure
- failed_breakout_rejection_zones
- wick_rejection_defense
- reclaim_breakdown_behavior
- support_resistance_proximity
- last_8_candle_momentum
- candle_close_location
- previous_wick_reaction
- volume
- current_candle_vs_open
- bullish_liquidity_sweep_bear_trap_reclaim
- bearish_exhaustion_downside_failure

For each indicator the prompt will include:
- `weight`
- `bullish:` bullet list of criteria (score +1 when strongly met, +0.5 when partially)
- `bearish:` bullet list of criteria (score -1 / -0.5)
- `neutral:` bullet list (score 0)

Also add an explicit scoring instruction so the model applies the block consistently:
- Score each indicator on {-1, -0.5, 0, +0.5, +1} based on how many of its bullish/bearish criteria are cleanly met vs partially met vs neutral.
- Use 0 when the neutral criteria fit, when criteria conflict, or when data is insufficient.
- One-sided indicators (e.g. `failed_breakout_rejection_zones` has no bullish list, `bullish_liquidity_sweep_bear_trap_reclaim` has no bearish list) can only score in their defined direction or 0.

Everything else already saved (weights, YES/NO thresholds at ±7.5, confidence bands, caps, `TRADE` filter at 3/5, required JSON output shape) stays as-is.

## Technical detail

- Single `UPDATE public.model_settings SET prompt_template = ... WHERE id = '527f5c6d-9866-4566-8a63-17fff589e0b7'` via the insert tool.
- Content-only change — no schema migration, no server or UI code changes.
- Takes effect on the next scheduled 15m run.
