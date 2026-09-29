# V2 Final R1

Frozen consolidation of the already studied V2-Lite + Fade8 policy. No new threshold search or choice based on the requested bankroll simulation. Finalized 29 September 2026 UTC (28 September Boise).

## Decision policy

One decision intent per BTC-USDT fifteen-minute candle. At T+8, try Direction8 first: equal-weight blend of separately calibrated ridge and shallow boosting on the 25 supporting inputs, confidence at least its fitted 70th-percentile calibration cutoff, and confidence × 1.75 >=1.03. If it abstains, try Fade8: the 33-input technical reversal blend, probability >=0.50, input opening move >=0.5 bp, and the latest completed-second price remains on the same side of the open by >=0.5 bp. Fade the input opening direction. If neither calls, try Direction45 at T+45 using the same directional recipe and confidence × 1.60 >=1.03. Do not place two trades, change side after a call, retry a different sleeve after quote rejection, or add an untested rolling branch.

At T+8 predictors use seconds 0–6 (ending 6.999), with second 7 (ending 7.999) used only for the fade price gate. At T+45 predictors use seconds 0–43 (ending 43.999). The nominal one-second compute budget is not measured exchange latency.

Sleeve identifiers: v2-direction8-r1, v2-fade8-r1, v2-direction45-r1. Parent identifier v2-final-r1. New identifiers require downstream registration; never alias them to old model identifiers or assume existing betting settings apply.

## Fits and portability

Directional models: 25 inputs (nine prior-candle/volatility, six clock, ten opening-window inputs). Fade: 33 derived inputs, adding ten technical indicators but using the same price/volume/trade feeds. No order-book, funding, open-interest or altcoin feed is required. Training/input venue is Binance spot BTCUSDT and labels are the lab's Binance index direction proxy. An OKX feed is not interchangeable without a feed-parity study.

Preserve original historical fits and refit cadence: up to 52 trailing weeks, final four weeks for calibration, refit every four weeks, labels settled at least one minute before fit cutoff. Initial blocks have less available warmup. Directional seed 280950, fade seed 290951. Ridge C=.1, max_iter1000; hist boosting160 rounds, rate .04, at most7 leaves, minleaf200, L2=20, early stopping off. Nonnegative-slope sigmoid calibration. Package historical fits for replay and fit block105 using only data available before 2026-09-14, valid for targets from September14 through October11 UTC. Expired/missing model, incomplete input or duplicate decision fails closed. No live deployment or orders in this task.

## Backtest and bankroll

Same 104 UTC weeks, 2024-09-16 through 2026-09-13: 69,888 opportunities. Preserve all archived outcomes, including ties scored as losses for either directional call. Distinguish the full proxy-label study from the archived official June–July outcomes. All dates have been researched previously; finalization does not create fresh holdout evidence.

User requested $50 starting capital and 4% flat for every trade. Interpret flat as $2 risk per trade throughout, calculated once as $50 × 4%; no compounding, P2, multiplier, recovery stake, top-up or borrowing. Stop if settled cash cannot fund the next full $2 stake; record the first unfundable entry/week. Treat payouts as effective decimal assumptions, with no separate fee deduction: Direction8 1.75; Fade8 2.20; Direction45 1.60. The 80% maker expectation is not an observed fill rate. Settlement is assumed available at candle close for subsequent entries; delayed cash availability, contract rounding, depth and fill selection are absent.

Report a single shared $50 bankroll, each sleeve's contribution after priority routing, and separate $50 standalone accounts using each sleeve's allocated trades (not its unconstrained opportunities). Include all104 weekly opening balance/profit/return/closing balance, sleeve calls/wins/profit, drawdown, worst week, losing streak, positive/negative/flat weeks, phase results, monthly results, official-grade diagnostic, odds stress and first-unfundable events. Flat-stake units, stake ROI and account percentage gain must be clearly distinguished. Include all scheduled trades in an audit ledger even after a simulated funding stop.

Freeze model and input identities before computing the requested bankroll path. Verify feature parity from raw bars, historical probabilities, all69,888 routed decisions, one-call and timing behavior, restart/idempotency, stale model rejection, payoff reconciliation and an extracted-package replay. Preserve source artifacts.
