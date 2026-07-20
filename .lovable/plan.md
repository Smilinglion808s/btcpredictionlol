## Goal
Close gaps in the AAS96 CSV so the export is a faithful dump of every column your analysis team may need. No model logic changes.

## Findings
`exportAas96Shadow` in `src/lib/predictions.functions.ts` whitelists columns explicitly, so any column added to `model7_aas96_shadow` after the export was last edited is silently dropped. Comparing the DB schema to the export, the following live columns are **missing from the CSV** today:

Timing / leakage audit (previously requested for other variants):
- `target_candle_ts`
- `input_candle_ts`
- `continuity_delta_seconds`
- `continuity_gate_passed`
- `snapshot_minutes_elapsed`
- `snapshot_belongs_to_prior_candle`

Training/state provenance:
- `last_training_at`
- `next_retrain_at_count`
- `usable_training_row`
- `active_abstain_rule`

Row identity/audit:
- `id` (shadow row id)
- `created_at`
- `updated_at`

CSV serializer (`rowsToCsv` in `stats.tsx`) already unions keys and handles nulls/quoting correctly — no changes needed there.

The "All Models" bundle calls `exportAas96Shadow` too, so fixing the AAS96 export also fixes the bundle.

## Change
Update `exportAas96Shadow` (only) in `src/lib/predictions.functions.ts` to add the 13 fields above to the returned row shape, preserving current key names and ordering the new fields in logical groups (identity, timing, snapshot, training-state, abstain-rule) near their siblings.

## Out of scope
- No changes to Layer A/B/C, veto, selector, resolver, orchestrator, or DB schema.
- No changes to Model 7 / TD1-RC / predictions CSV exports (say the word if you want the same audit sweep applied there).
- No UI changes.

## Verification
1. Trigger `CSV (AAS96)` from the stats page; confirm the new columns appear in the header row.
2. Spot-check one warmup SKIP row, one directional row, one Cleanup-Veto ABSTAIN row, and one Selector-B override row — every new column populated as expected.
