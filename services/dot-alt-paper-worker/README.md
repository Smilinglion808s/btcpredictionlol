# dot-alt-paper-worker

Standalone SOLUSDT/DOGEUSDT PAPER collector (Binance USD-M public `bookTicker` + `aggTrade`).
Independent of `dot-paper-worker` and its BTC ledger. No credentials, orders or webhooks.

- Start: `python -m alt.main` (reads `PORT`, binds `0.0.0.0`; `BIND` overrides)
- `DATA_DIR`: JSONL log folder (Docker default `/tmp/dot-alt`, ephemeral; point at a Railway volume to persist). Max ~20 MB (5 MB × 2 files × 2 symbols).
- `GET /health`: state (CONNECTING/RUNNING/STALE/BACKOFF/STOPPED), counters, last event age, per-symbol quote freshness, maker `UNKNOWN` / taker `TOP_OF_BOOK_ONLY_SIZE_UNCHECKED`.
- `GET /events/latest`: latest quote and trade per symbol.
- Tests: `python -m pytest -q alt/tests`
