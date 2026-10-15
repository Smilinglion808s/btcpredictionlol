# dot-alt-paper-worker

Standalone SOLUSDT/DOGEUSDT PAPER collector (Binance USD-M public `bookTicker` + `aggTrade`).
Independent of `dot-paper-worker` and its BTC ledger. No credentials, orders or webhooks.

- Start: `python -m alt.entry` (reads `PORT`, binds `0.0.0.0`; `BIND` overrides)
- `DATA_DIR`: mount root (Docker default `/tmp/dot-alt`, ephemeral; on Railway set to the volume mount, e.g. `/data/alt-paper`). Logs are written only to the strictly validated `DATA_DIR/events/` subfolder; other root entries (e.g. `lost+found`) are ignored and never touched. Max ~20 MB.
- `GET /health`: state (CONNECTING/RUNNING/STALE/BACKOFF/STOPPED), counters, last event age, per-symbol quote freshness, maker `UNKNOWN` / taker `TOP_OF_BOOK_ONLY_SIZE_UNCHECKED`.
- `GET /events/latest`: latest quote and trade per symbol.
- Tests: `python -m pytest -q alt/tests`

## Virtual $1,000 paper ledger (simulation only)
- SQLite at `DATA_DIR/ledger/paper.sqlite3` (strict allowlist; never reset; identity mismatch ⇒ ledger disabled, collector keeps running).
- `GET /paper/status`: cash, equity, used margin, open positions (mark-to-market), last 20 trades; 503 if ledger unavailable.
- Simulated taker fills at BBO ± slippage + fees; isolated margin, one position/symbol, liquidation at 0.5% maintenance (loss capped at margin), time exit.
- Env: `ALT_PAPER_STRATEGY_ENABLED` (default `false`), `ALT_PAPER_LEVERAGE` (1–20, default 20; existing positions keep their recorded leverage), `ALT_PAPER_HOLD_MIN` (5/15/30, default 15), `ALT_PAPER_MARGIN_FRACTION` (default 0.20), `ALT_PAPER_MARGIN_BASE` (`equity` default = cash + open positions at fresh marks ≤10s, fails closed if any mark is unknown/stale; or `cash`), `ALT_PAPER_FEE_BPS` (5), `ALT_PAPER_SLIPPAGE_BPS` (2), `ALT_PAPER_SIGNAL_BPS` (10).
- Rule `EXPLORATORY_MOMENTUM_V0` (60s mid move ≥ signal bps ⇒ follow) is a plumbing placeholder only; no profitability claim. Entries only on fresh, unflagged quotes.
