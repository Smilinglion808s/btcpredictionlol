# Replace AAS96 with a96-r1

## Scope

Replace only the **final selection / abstention / publishing / state / scoring** stage of AAS96. Keep the existing AAS Layer A (logistic L003/L010 + armor override) and Layer B (expert history horizons) inference exactly as they are. All Selector B Confirmation V1 and Cleanup Veto V1 overlays are removed from the pipeline (they are what a96-r1 replaces).

Production labels going forward:
- `model_name = a96`
- `model_version = a96-r1`
- `variant = a96`

## Frozen rules (from spec, do NOT tune for 300–500 candles)

- `fit_selector_min_resolved = 8`
- `fit_selector_min_net_gap = 4`
- `agreement_distance_from_4_low_bps = 32.0`
- `agreement_mean_2_body_to_range_max = 0.30`
- `abstain_on_unusable_agreement_history = true`

Decision order per candle:
1. Existing Layer A inference → GREEN/RED
2. Existing Layer B inference → GREEN/RED
3. Existing internal base selector → `base_selected_layer` (A or B)
4. Load `FitState` for current `fit_episode_id`
5. If A == B: compute `distance_from_4_candle_low_bps` and `mean_2_candle_body_to_range` from prior 4 completed candles + `target_open`. Abstain if either threshold hit. Otherwise publish the agreed direction.
6. If A != B: if `comparable_resolved_count >= 8` AND `|A_net - B_net| >= 4`, pick the current-fit leader. Otherwise use `base_selected_layer`.
7. Persist prediction + full audit snapshot.
8. On candle close, derive `actual_direction` from `actual_open`/`actual_close` (OHLC only — never trust any exported label). Update both layer counters exactly once, atomically.

New `fit_episode_id` is minted on every fit activation/retrain (even if the same artifact is reactivated). Net counters never carry over.

## Database changes (one migration)

New tables in `public`:
- `a96_fit_state` — one row per fit episode (`fit_episode_id` UUID PK, `artifact_fit_id`, activation ts, comparable_resolved_count, layer_a/b wins/losses/net, updated_at). CHECK constraints enforce `net = wins - losses`.
- `a96_predictions` — one row per target candle per fit episode. Columns match the spec's audit contract: layer directions, base_selected_layer, selected_layer, final_prediction, decision_reason, both veto/override flags, both feature values, both condition booleans, snapshot of net at prediction time, actual_open/close/direction, result_score, resolved_at. Unique `(fit_episode_id, target_candle_ts)`.
- Indexes: target_ts DESC, (fit_episode_id, target_ts), partial index on unresolved rows.
- SQL function `resolve_a96_prediction(prediction_id, actual_open, actual_close, resolved_at)` — transactional, idempotent, derives direction from OHLC, updates both layer counters counterfactually, returns full row.
- Reporting views: `a96_fit_performance`, `a96_daily_performance`.

All new tables get `GRANT SELECT, INSERT, UPDATE ON ... TO authenticated` + `GRANT ALL ... TO service_role` and are added to the realtime publication so the Stats UI updates live.

Existing AAS96 tables (`model7_aas96_shadow`, `model7_aas96_state`, `model7_aas96_fits`) stay — Layer A/B artifact + expert history live there. We keep reading them; we stop writing selector/veto columns to `model7_aas96_shadow` for the a96 pipeline.

## Code changes

New folder `src/lib/a96/`:
- `config.ts` — frozen thresholds + labels
- `types.ts` — `Direction`, `Layer`, `Candle`, `FitState`, `Decision`
- `features.ts` — `agreementFeatures()` port of the Python (contiguity check + 15m expected step, zero-range → 0 body/range, target_open>0)
- `engine.ts` — `a96Decide()` pure function returning `Decision`
- `state.ts` — `getOrCreateFitEpisode(sb, artifactFitId)`, mints new UUID whenever `artifactFitId` differs from the currently-active episode
- `orchestrator.ts` — wraps the existing AAS Layer A/B inference calls (extracted from `aas96/orchestrator.ts`), runs the base selector (last-96 counterfactual net over `model7_aas96_shadow`), calls `a96Decide`, writes `a96_predictions`, does NOT write the Cleanup Veto or Selector B Confirmation columns
- `resolve.ts` — calls `resolve_a96_prediction` RPC; still triggers `maybeTrainAas96` opportunistically so Layer A/B keeps retraining, and mints a new fit episode when a new artifact activates
- `csv.ts` — full CSV export of `a96_predictions` (all audit columns + joined `actual_open`/`close` from `predictions`)

Wiring:
- `src/lib/prediction.server.ts` — replace `runAas96Shadow(...)` call with `runA96(...)`. Replace `resolveAas96Row(...)` call in the resolution path with `resolveA96(...)`. Leave the AAS Layer A/B training triggers intact.
- `src/lib/model7/aas96/train.ts` — after `promoteFit()`, call `state.mintNewFitEpisode(newArtifactFitId)` so a96 resets net counters on retrain.
- `src/lib/model7/aas96/orchestrator.ts` — retained only as internal Layer A/B compute; the orchestrator's Selector B Confirmation V1 + Cleanup Veto V1 overlays are no longer invoked. Refactor: extract `computeLayerAB(sb, prediction) → { layerADir, layerBDir, baseSelectedLayer, diagnostics }` and let the a96 orchestrator call it.

UI (`src/routes/_authenticated/stats.tsx`):
- Rename the "AAS96" card to "a96 (a96-r1)". Show: total predictions, wins, losses, abstains, net, override count, agreement-veto count, current fit episode + `comparable_resolved_count` and `A_net`/`B_net`.
- Recent history: show `a96` decisions for the current episode.
- CSV button label → "CSV (a96)".
- All-models CSV: add a96 columns; drop AAS96 selector/veto columns (they stop being written).

Webhooks:
- **No webhook change** by default — the active outbound model is still TD1-RC per the last change. If you want a96 to be the hero/webhook source, say so and I'll swap `webhooks.server.ts` in a follow-up.

## Runtime guard

Port `reject_external_model_inputs` — the a96 orchestrator only receives `{ layerADir, layerBDir, baseSelectedLayer, priorCandles, targetOpen, targetTs }`. It runs a guard that throws if any key contains `td1`, `a2_`, `router`, `model6_prediction`, `external_final_decision`, or `opposite_model`, matching the Python contract.

## Ground truth

Resolution derives `actual_direction` from the DB row's `actual_next_candle_open` / `actual_next_candle_close` (or 15m candle OHLC when the predictions row does not carry them), never from the exported `actual_direction` on predictions.

## Verification

- Port the 8 unit tests from `tests/test_engine.py` into `src/lib/a96/__tests__/engine.test.ts` (agreement pass, agreement distance veto, agreement body-ratio veto, disagreement warmup, disagreement below-gap, disagreement override fires, override-confirms-base, missing history abstain).
- After migration is approved and code lands: monitor the a96 card on the Stats page after the next 15m boundary to confirm rows write + resolution updates counters.

## Notes for you

- The 36 AAS96 rows where the exported direction disagrees with OHLC will NOT be replayed — a96 starts fresh from the first target candle after cutover.
- First 8 resolved comparable candles will use the AAS base selector (warmup).
- Retraining Layer A/B still runs on the existing cadence; every promotion mints a new fit_episode_id and zeroes a96 net state.
- Selector B Confirmation V1 and Cleanup Veto V1 are effectively retired for the a96 pipeline. Their historical rows in `model7_aas96_shadow` remain untouched.

Ready to implement when you approve.
