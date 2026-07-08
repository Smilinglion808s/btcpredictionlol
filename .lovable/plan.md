## 1. Relabel pre-engine rows (data migration)

Run a one-shot UPDATE against `predictions` (and `predictions_archive` for safety) so the `model_version='6.0'` label only ever means "produced by the deterministic engine."

```sql
UPDATE public.predictions
SET model_version = '5.1-mislabeled'
WHERE model_version = '6.0'
  AND engine_version_hash IS NULL;

UPDATE public.predictions_archive
SET model_version = '5.1-mislabeled'
WHERE model_version = '6.0'
  AND engine_version_hash IS NULL;
```

After this, the canonical Model 6 filter everywhere in the app becomes:

```
model_version = '6.0' AND engine_version_hash IS NOT NULL
```

I'll also add a short comment in `src/lib/model6/engine.ts` noting the invariant so nobody reintroduces a code path that inserts `6.0` rows without an `engine_version_hash`.

No UI changes — the mislabeled rows will still appear in History under their new label; they simply stop polluting 6.0 stats queries.

## 2. Golden tests for the deterministic engine

Add a Vitest suite covering 25 hand-built scenarios that lock down every branch of the engine. Pure functions only — no DB, no network, no OpenAI (narrator is skipped; we assert on `decisionEngine` + `scoringEngine` + `sizingEngine` outputs directly).

**File**: `src/lib/model6/__tests__/golden.test.ts`

**Fixture shape**: each scenario is a `{ name, features, recentCtx, expected }` object where `expected` pins:
- `scores.bull`, `scores.bear`, `scores.margin`, `scores.dominant`
- Per-module points for any module the scenario is exercising
- `decision.prediction`, `decision.confidence`, `decision.setup_type`
- `decision.guards_applied`, `decision.caps_applied`
- `decision.partial_veto_active`, `decision.partial_hard_override_fired`, `decision.agreement_gate_applied`
- `sizing.units`, `sizing.conviction_active`, `sizing.conviction_direction`, `sizing.conviction_aligned`

**Coverage matrix (25 cases)**:

Setup / base direction (6)
1. Clean bullish trend expansion → YES, high confidence, `trend_continuation`
2. Clean bearish trend expansion → NO, high confidence, `trend_continuation`
3. VWAP reclaim from below → YES, `vwap_reclaim`
4. VWAP loss from above → NO, `vwap_loss`
5. True-mid Fib chop, low margin → NCE, `no_clear_edge`
6. Compressed ATR, no direction → NCE, `low_confidence`

Guards (5)
7. `last2_losses=2` cooldown guard → confidence capped
8. `same_direction_loss_streak>=2` → base direction flipped/blocked
9. `last5_losses>=3` → forced NCE
10. Prev was fallback + weak margin → NCE
11. Recent push doesn't trigger cooldown

Caps (3)
12. Strong-expansion cap on max confidence
13. Compressed-state cap
14. Fib mid-zone cap

Partial-candle module (5)
15. Partial confirms base → bull/bear points added, no veto
16. Partial contradicts base, tier-1 → `partial_veto_active=true`, prediction downgraded
17. Partial hard override fires → `partial_hard_override_fired=true`, direction flipped
18. Partial degraded_mode → module points zeroed, no veto
19. Partial not present → module 0/0

Agreement gate + NCE (3)
20. Agreement gate blocks marginal call → `agreement_gate_applied=true`, NCE
21. Margin below NCE floor → NCE, confidence 0
22. Margin at exact NCE boundary → NCE (inclusive floor)

Sizing / conviction (3)
23. Base YES + all conviction conditions aligned → `units=2, conviction_active=true, conviction_aligned=true`
24. Base NO + conviction conditions aligned bullish → `units=1, conviction_active=true, conviction_aligned=false`
25. No conviction conditions met → `units=1, conviction_active=false`

**How fixtures are built**: I'll construct `Features` objects directly (typed literal), not by feeding synthetic candles through `computeFeatures`. This keeps tests focused on scoring/decision/sizing logic — `computeFeatures` gets separate lightweight coverage via 2 sanity tests that feed known candle arrays and check a handful of derived fields (atr_state, above_vwap, fib_zone).

**Snapshot policy**: no `toMatchSnapshot()`. Every expected value is written inline so a diff shows exactly what changed. If the engine intentionally changes behavior, the failing test values are updated in the same PR — that IS the review signal.

**Runner**: `bunx vitest run src/lib/model6/__tests__/golden.test.ts`. No config changes required; Vitest is already wired.

## 3. Measurement clock (documentation only)

Add a short comment block at the top of `src/lib/model6/engine.ts` recording the rule so it survives future context loss:

```
// Measurement clock: the 7-day evaluation window starts at the timestamp of
// the first predictions row with engine_version_hash IS NOT NULL under
// model_version='6.0'. Flat-stake discipline = flat *base* units, with the
// sizingEngine's 1/2-unit conviction rule applied mechanically. Track net
// units alongside net wins.
```

No stats-page UI changes in this plan — that's a follow-up once we have ≥7 days of clean engine rows.

## Order of operations

1. Migration to relabel rows (approval-gated).
2. Add golden test file + 2 feature-engine sanity tests.
3. Add comment blocks in `engine.ts`.
4. Run `bunx vitest run` and confirm all 27 tests pass.

## Out of scope

- No UI changes to History/Stats filters (they already read `model_version`; relabeled rows drop out of 6.0 views automatically).
- No changes to scoring/decision/sizing logic — tests lock down current behavior as the baseline.
- No changes to the narrator or OpenAI call path.
