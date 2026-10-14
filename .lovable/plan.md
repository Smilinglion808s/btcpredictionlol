# DOT paper lab audit (read-only, no changes)

## Finding
This BTC Predictor Pro project does NOT contain an altcoin DOT paper lab. There is no SOL or DOGE feed, no SOL/DOGE perpetual order-book collector, and no maker/taker queue simulator. The only "DOT" here is a BTC-only paper observer.

## What exists here
- `services/dot-paper-worker/` (Python, Railway): one paper account. `config.py` rejects anything except BTCUSD/BTCUSDT PAPER. Feed: Kraken Spot BTC/USD over `wss://ws.kraken.com/v2` (ticker BBO + trades), in `marketdata.py`. Fills are taker-only (fee + slippage + latency model in `engine.py`). State in local SQLite, not this app's database.
- Strategies: `strategy.py` / `strategy_config.json`, `strategy_fast.py` / `strategy_fast_config.json` (BTC, unvalidated, research only).
- Site: `/paper` page (`src/routes/_authenticated/paper.tsx`, `src/components/dot-paper/`), read-only via `src/lib/dot-paper.server.ts` (GET only).
- Timestamps: quotes and trades keep exchange time, receipt time and processed time (`exchange_ms`, `receipt_ms`, `event_ms`), plus quote age and sequence.
- Database: no DOT, paper, SOL, DOGE or perp tables.
- Separate BTC Binance order-book collector (`services/binance-ob-collector`, Spot + USD-M perp, BTCUSDT only). Its health heartbeat was fresh at 22:08:59 UTC today for both markets.

## Where paper-only strategies could go
New strategy module + config next to `strategy_fast.py` inside `services/dot-paper-worker/worker/`. Adding SOL/DOGE would need changes to the symbol guard, the feed, and a new maker simulator.

## Separate DOT app
If DOT built a full altcoin lab, it is in a different Lovable project. With your permission I can search your workspace projects and look at it read-only.

No files, settings, cron jobs, trading or deployments were changed.
