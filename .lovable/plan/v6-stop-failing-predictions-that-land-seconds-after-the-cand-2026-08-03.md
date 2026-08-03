# V6: stop failing predictions that land seconds after the candle opens

## What's happening now

The only V6 row so far is for the 06:00 candle. It was produced 15.8 seconds after that candle opened, and V6 threw the whole prediction away:

- `operational_status = OP_FAIL`, `operational_error = prediction_after_target_open`
- `final_prediction = OP_FAIL`, even though the model actually produced a clean base call (`GREEN`)

V6 currently requires the row to be written strictly before the target candle opens. a96 and TD1-RC have no such rule — they run whenever the pipeline reaches them and publish the prediction.

There is a second cost: V6 continuity treats any OP_FAIL row as a history break, so a single late run also wipes the 8-candle base-prediction history used by the saturation veto and the pickup rules.

## What to change

Make V6 behave like a96 and TD1-RC: a late run still publishes the real prediction, with the lateness recorded rather than treated as a failure.

1. **Grace window.** Runs that complete within a grace window after the target candle opens are `OK` and publish the model's real `final_prediction` (or `STRATEGIC_ABSTAIN`). Default grace: 300 seconds (5 minutes), well inside the 15-minute candle.
2. **Hard cutoff preserved.** Past the grace window the row stays `OP_FAIL` with `prediction_after_target_open`, since a run that drifts toward the target candle's close is no longer a legitimate forward prediction.
3. **Honest timing audit.** Keep `prediction_created_before_target` and `timing_valid` as strict truth flags (still `false` for a late-but-accepted run) and record the lateness in seconds in the operational/error metadata, so the CSV and audit trail show exactly how late each prediction was.
4. **Continuity.** Late-but-accepted rows have a real `base_v6_prediction`, so they no longer break the 8-candle history chain. Only true OP_FAIL rows still clear history.
5. **Existing row.** The single 06:00 OP_FAIL row was a genuine model prediction (base `GREEN`) that only failed the timing rule. Repair it in place to `OK` with the real final prediction under the new rule, so the forward test starts from a clean, accurate record. No other data changes.
6. **Model integrity untouched.** No change to features, inference, thresholds, vetoes, pickups, or scoring. Inputs are still cut off at the target candle open, so nothing from the target candle can leak in.

## Technical notes

- `src/lib/v6/orchestrator.ts`: replace the `createdBefore = Date.now() < targetTs.getTime()` gate with a grace-aware acceptance check (`lateness_s = (now - targetOpen)/1000`, accept when `lateness_s < V6_LATE_GRACE_S`). `operational_status`, `final_prediction`, `abstain_status`, and `abstain_reason` follow the acceptance check; `prediction_created_before_target` / `timing_valid` keep their strict definitions.
- Add `V6_LATE_GRACE_S = 300` to the V6 config module next to the other frozen constants.
- Apply the same grace logic in `opFailRow` so its timing flags stay consistent.
- `loadPriorBaseState` already breaks on `operational_status !== "OK"`; accepted late rows are `OK`, so continuity is preserved with no change there.
- The 06:00 repair is a one-off data update to `v6_predictions` for that target candle, recomputing `final_prediction` from the stored `pre_weak_red_veto_prediction` / overlay flags already in the row.
