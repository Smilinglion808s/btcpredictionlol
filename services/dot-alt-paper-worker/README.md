# dot-alt-paper-worker

Standalone SOLUSDT/DOGEUSDT PAPER collector (Binance USD-M public `bookTicker` + `aggTrade`).
Independent of `dot-paper-worker` and its BTC ledger. No credentials, orders or webhooks.

- Start: `python -m alt.main` (reads `PORT`, binds `0.0.0.0`; `BIND` overrides)
- `DATA_DIR`: mount root (Docker default `/tmp/dot-alt`, ephemeral; on Railway set to the volume mount, e.g. `/data/alt-paper`). Logs are written only to the strictly validated `DATA_DIR/events/` subfolder; other root entries (e.g. `lost+found`) are ignored and never touched. Max ~20 MB.
- `GET /health`: state (CONNECTING/RUNNING/STALE/BACKOFF/STOPPED), counters, last event age, per-symbol quote freshness, maker `UNKNOWN` / taker `TOP_OF_BOOK_ONLY_SIZE_UNCHECKED`.
- `GET /events/latest`: latest quote and trade per symbol.
- Tests: `python -m pytest -q alt/tests`
