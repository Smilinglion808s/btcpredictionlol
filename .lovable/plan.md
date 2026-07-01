## Goal
Export the current Stats page data as a CSV file you can hand to another bot for model tuning.

## What the CSV will contain
One row per prediction from the `predictions` table (all history currently on the Stats page), with these columns:

- `created_at` (UTC ISO)
- `candle_ts` (UTC ISO — the 15m candle the prediction targets)
- `model_version`
- `api_model_id`
- `prediction` (YES / NO / NO CLEAR EDGE)
- `confidence` (0–100)
- `status` (win / loss / push / pending)
- `btc_price_at_prediction`
- `actual_next_candle_open/high/low/close`
- `setup_type`
- `market_condition`
- `reasoning_summary`
- `resolved_at`

Plus a second small CSV, `stats_summary.csv`, with the aggregate KPIs shown on the page (overall/last 10/25/50 WR, wins, losses, pushes, YES/NO WR, avg confidence buckets, by_setup, by_confidence_bucket, by_market_condition flattened).

## How
One-off export — no app code changes:
1. Query `predictions` and `prediction_stats()` via psql.
2. Write `/mnt/documents/btc15m_predictions.csv` and `/mnt/documents/btc15m_stats_summary.csv`.
3. Surface both as downloadable artifacts in chat.

## Open question
Do you want **all predictions ever recorded**, or only the current model's rows (Model 2.1, i.e. `api_model_id = 'btc15m_m2_1'`)? Stats page shows the current running set, so I'd default to Model 2.1 only unless you say otherwise.
