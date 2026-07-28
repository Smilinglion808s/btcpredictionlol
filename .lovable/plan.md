
# Universal CSV v2 — Canonical, Auditable, Spine-Complete

This is strictly an export/data layer upgrade. No model, retraining, threshold, abstention, webhook, or historical-row logic is touched. Legacy columns are preserved 1:1; new canonical/audit sections are appended in grouped order.

## Scope confirmation (unchanged)
TD1-RC / AAS96 / a96 / Model 6 / A2 prediction logic, retraining, thresholds, abstention rules, webhooks, automated betting, and all historical model outputs remain untouched. This task only edits export/query code and adds a schema manifest generator.

## Deliverables

1. **New server function** `exportUniversalCsv` in `src/lib/predictions.functions.ts` (or new `src/lib/universal_export.functions.ts`) that returns `{ csv, manifest }`. Runs server-side with `supabaseAdmin` so it can page across `predictions`, `predictions_archive`, `candles`, `model7_td1_rc_shadow`, `model7_aas96_shadow`, `a96_predictions`, and `a96_fit_state`.

2. **Rewrite `downloadUniversal`** in `src/routes/_authenticated/history.tsx` to call the server function, download `btc15m_universal.csv` and `btc15m_universal_schema_manifest.json` as a pair (two blob downloads, or a single `.zip` — will use two files, simpler).

3. **New pure module** `src/lib/universal_export/` containing:
   - `spine.ts` — generate contiguous 15-min boundary list between min/max ts.
   - `canonical.ts` — canonical lookup + validation from `candles` (BTC-USDT / 15m / okx / confirm=true / exact ts / single row).
   - `normalize.ts` — YES/NO/SKIP/NO CLEAR EDGE/ABSTAIN → GREEN/RED/ABSTAIN; canonical scoring (+1/-1/0/null).
   - `abstention.ts` — model-specific STRATEGIC vs OPERATIONAL classifier with normalized reason codes from the spec.
   - `manifest.ts` — build the JSON manifest from a typed column registry.
   - `columns.ts` — single source of truth: `{ name, category, source, prediction_time_safe, resolution_time_only, nullable, description, model_dep }[]`.

4. **Tests** under `src/lib/universal_export/__tests__/`:
   - `canonical.test.ts` — query shape requires all 5 filters; missing/unconfirmed/wrong-provider/wrong-symbol/duplicate/mismatched-ts/nonfinite-ohlc all yield `valid=false` with the correct reason; direction derives only from open/close; no nearest-fallback.
   - `normalize.test.ts` — YES→GREEN, NO→RED, SKIP/ABSTAIN/NO CLEAR EDGE→ABSTAIN; scoring: correct=+1, wrong=-1, abstain=0, PUSH=null, invalid GT=null, missing pred=null.
   - `spine.test.ts` — exact 1 row per expected boundary between range; missing predictions produce placeholder rows; two nonadjacent rows never appear contiguous; prior_4/21/30 flags reflect real uninterrupted history.
   - `abstention.test.ts` — sample reason strings from spec route to correct STRATEGIC/OPERATIONAL bucket.
   - `manifest.test.ts` — every emitted CSV column exists in the manifest; `prediction_time_safe=false` for every CANONICAL_OUTCOME / LEGACY_OUTCOME / COUNTERFACTUAL / RESOLUTION_METADATA column.
   - `idempotent.test.ts` — same input rows produce byte-identical CSV twice.
   - `disagreement.test.ts` — mismatched legacy vs canonical → `canonical_disagrees_with_legacy=true`.
   - `a96_lineage.test.ts` — `a96_fit_episode_lineage_valid=false` when episode changes under same artifact.
   - `prospective.test.ts` — a96 row with `prospective_valid=false` yields `a96_canonical_result_score=null` and is flagged `a96_prospective_row_valid=false`.

## Data flow

```text
range [tsMin, tsMax]
   │
   ├── page predictions + archive union (existing helper, already paginated)
   ├── page candles WHERE symbol='BTC-USDT' AND timeframe='15m' AND fetch_source='okx' AND confirm=true AND candle_ts BETWEEN ...
   ├── page model7_td1_rc_shadow (candle_ts BETWEEN)
   ├── page model7_aas96_shadow  (candle_ts BETWEEN)
   ├── page a96_predictions      (target_candle_ts BETWEEN) + a96_fit_state (lineage)
   │
   ▼
buildSpine(tsMin, tsMax) → boundary[]
   │
   ▼
for each boundary:
   canonical = lookupCanonical(candlesMap, boundary)   // never nearest, never substitute
   pred      = predsByCandleTs.get(boundary) ?? null
   td1, aas96, a96 = respective maps (also keyed by exact boundary)
   row = mergeLegacy(pred) ⊕ canonicalBlock ⊕ perModelCanonical ⊕ abstentionClass ⊕ lineage ⊕ availabilityFlags ⊕ spineAudit ⊕ timingAudit
   emit row
sort by expected_candle_boundary asc
```

## New column groups (appended after existing legacy columns, order preserved)

- **Canonical outcome**: 14 fields from §1.
- **Legacy preservation flags**: 4 fields from §2 (`legacy_actual_direction`, `legacy_status`, `legacy_settlement_source`, `canonical_disagrees_with_legacy`).
- **Canonical per-model scoring**: 8 fields from §3.
- **Spine**: `expected_candle_boundary`, `prediction_row_present`, `missing_prediction_reason`, `previous_expected_candle_ts`, `gap_from_previous_exported_row_seconds`, `missing_boundaries_since_previous_row`, `prior_4_boundaries_contiguous`, `prior_21_boundaries_contiguous`, `prior_30_boundaries_contiguous`.
- **Timing**: 7 fields from §5.
- **Abstention classification (per model × 5 fields)**: `{td1,aas96,a96,base}_output_class`, `_abstain_class`, `_normalized_abstain_reason`, `_prospective_row_valid`, `_prospective_invalid_reason`.
- **Lineage**: 13 fields from §7 including `a96_fit_episode_lineage_valid` / `_error`.
- **Availability**: 6 flags from §8.
- **`universal_schema_version` = `"btc15m-universal-v2"`**.

## Normalization rules (canonical, applied only for canonical_* fields)

`YES→GREEN`, `NO→RED`, `SKIP|NO CLEAR EDGE|ABSTAIN→ABSTAIN`. Scoring uses only stored prediction-time output vs canonical direction:

| canonical_dir | pred    | score |
|---------------|---------|-------|
| GREEN/RED     | matches | +1    |
| GREEN/RED     | opp     | -1    |
| GREEN/RED     | ABSTAIN | 0     |
| PUSH          | any     | null  |
| invalid GT    | any     | null  |
| any           | missing | null  |

Existing `status`, `correct`, `result_score`, `td1_rc_result`, etc. are **not** used to compute canonical scores and remain untouched.

## Formatting

ISO-8601 UTC, existing MT columns preserved, booleans as `true`/`false`, numbers as numbers (not quoted), JSON columns via stable `JSON.stringify` with sorted keys helper for object columns, ascending sort by `expected_candle_boundary`, no removal/rename of existing columns.

## Manifest

`btc15m_universal_schema_manifest.json` — array of column descriptors. Any column touching actual OHLC / direction / result / score / resolution timestamp / counterfactual gets `prediction_time_safe:false`.

## Non-goals (explicit)

- No changes to `prediction.server.ts`, model orchestrators, retraining, or resolution logic.
- No writes to historical rows, no repair of a96 fit episodes.
- No new DB migrations (canonical lookup uses existing `candles` table; if any small denormalization is needed, will call it out and revert to pure-read).

## Post-implementation report

I will report files changed, tests added + results, and counts for: total boundaries, missing prediction rows, valid canonical candles, invalid canonical candles, legacy/canonical disagreements, strategic abstentions per model, operational failures per model, and an explicit confirmation that no model / retraining / webhook / betting code was modified.
