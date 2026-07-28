## Goal
Generate a downloadable PDF report of **Model 3 — Selective Edge R1 (m3-se-r1)** trade performance, including the full tracked CSV data and summary analytics.

## Approach

1. **Pull data** from `model3_se_predictions` (all rows, all 60+ tracked columns) plus `model3_se_fits` (fit provenance) and `model3_se_blocks` (rolling summaries) via `supabaseAdmin`.

2. **Build a PDF** at `/mnt/documents/model_3_se_r1_performance.pdf` using LibreOffice headless (same pattern as the prior Model 3 FWD PDF export):
   - **Cover page**: model version, code version, date range covered, resolved count, pending count.
   - **Summary stats**: published win rate, wins/losses/pushes, abstain count, coverage, raw (pre-selector) win rate, selector net effect (abstained losers − abstained winners).
   - **Fit history table**: fit_id, activated_at, training rows, OOF accuracy/Brier, selector ROC-AUC, selection threshold, estimated coverage.
   - **Rolling blocks table**: last N 96-candle blocks with win rate, coverage, selector net.
   - **Full trades table**: every resolved prediction with all tracked columns (candle_ts, published/raw prediction, result, prices OHLCV, calibrated probabilities, selector margin, abstain category/detail, fit_id, timing/leakage audit fields). Header row + first column repeat on each page.

3. **QA**: convert PDF pages to images and inspect for clipping/overflow; fix and re-run until clean.

4. **Deliver** via `<presentation-artifact>`.

## Technical notes
- One-shot generation script under `/tmp/`; no new app routes or UI changes.
- Full column set from `model3_se_predictions` (per prior audit expansion: abstain_category, abstain_detail, selector_margin, direction_confidence_gap, fit provenance, OHLCV, calibrated probs, timing/leakage fields).
- PDF landscape, tabloid or wider, with small font on the trades table so all columns fit; long tables paginate with repeated header + candle_ts column.
