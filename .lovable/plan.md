## Problem

Current live rate: **15 of 39 predictions (38%) are NO CLEAR EDGE**. Target is 5–10%.

Root cause: the active Model 2.1 prompt uses a symmetric NCE band of `-6.5 < total_score < 6.5`. Because most 15m setups land in the low-single-digits of weighted score, the band swallows the majority of candles.

## Fix (three levers, applied together)

**1. Tighten the NCE band in the prompt**
Update the active `model_settings.prompt_template` so the final-call rules read:

```
YES if total_score >= 2.5
NO if total_score <= -2.5
NO CLEAR EDGE if -2.5 < total_score < 2.5
```

Also re-map the confidence tiers so the ranges stay meaningful with the lower threshold:
- 2/5 = 2.5–9.99 (directional lean / cap active)
- 3/5 = 10–19.99 (tradable)
- 4/5 = 20–34.99 (strong)
- 5/5 = 35+ (rare)

Rule of thumb: NCE band ≈ 2.5% of the ±100 score range → historically hits ~5–10% of candles.

**2. Loosen the "abstain if data insufficient" guidance**
Add a line telling the model that a marginal directional lean should be called YES/NO with 2/5 confidence rather than abstaining. NCE is reserved for true two-sided conflict (bull and bear weighted scores both above ~10 and within 20% of each other).

**3. Keep `trade_status` gated at 3/5**
Confidence ≥ 3/5 still required for `TRADE` (webhook consumer / bot logic unchanged). So more directional calls get logged and graded, but only the higher-conviction ones get flagged as tradable. Win-rate accounting is unaffected because NCE remains status=`push`.

## What changes in code / DB

- **DB migration:** `UPDATE public.model_settings` on the active row to swap the three threshold lines and confidence tiers in `prompt_template`, and append the "prefer 2/5 lean over NCE" clause.
- **No app code changes.** `prediction.server.ts` already reads the prompt from `model_settings`, normalizes confidence, and records NCE as `push`. Webhook payload and stats page behavior stay the same.

## Validation

- Watch the next ~20 predictions; NCE share should drop toward 1–2 out of 20.
- If NCE is still >15% after 20 candles, drop threshold to ±1.5.
- If NCE falls to 0% and 2/5 calls dominate, raise to ±3.5.

## Open question

Do you want me to also **archive current Model 2.1 stats** (like we did for 1.9) before the threshold change so the win-rate comparison is clean, or keep the running stats continuous?
