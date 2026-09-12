# Version 1.1 — architecture check and implementation plan

Read-only inspection of commit `49e45e24`. No edits, no database writes, no sends were made.

## 1. Version 1 today: where it decides, and where the floor snapshot lives

- Decision is made by the Railway worker: `services/c85-worker/src/litea/engine.py` (rank/confidence) then `guard.py` `DailyFloor.decide()` (daily floor + 0.90 exception).
- The engine's low-confidence outcome is already a literal reason string `CONFIDENCE_ABSTAIN` (`engine.py:168`); `RANK_WARMUP` is the separate not-ready case.
- There is no field named `ordinary_floor_open`. The equivalent boolean is `ordinary_floor_allows` (`guard.py:65,74`), and it is **already persisted** on every row inside `c85_targets.features.daily_floor` (`store.py:105`). The engine reason is at `features.lite_a.reason`, the merged list in the `gate_reasons` column, and the headline in `status`.
- Consequence: the trigger condition Version 1.1 needs (a committed, valid V1 row with `status = CONFIDENCE_ABSTAIN` and `features.daily_floor.ordinary_floor_allows = true`) is **readable today with no schema change and no worker change**.
- Sender path: `src/lib/c85/ops.server.ts` (`decision.commit`) writes durably via `c85_commit_decision`, then `src/lib/litea/dispatch.server.ts` runs the gate order (kill switch, allowlist, identity, LIVE, admitted side, input/head validity, target identity, timing, atomic claim, re-check, deliver, settle) and `src/lib/webhooks.server.ts` performs the single HTTP attempt. Dedupe key: `lite-a-floor4-top10-r1:<ticker>:<isoZ>`. Pre-send latency instrumentation (`attempt_started_at`, `attempt_start_offset_ms`) stays untouched.

## 2. The improved T45 R2 does not exist in this repo — this is the blocker

- `CONTEXT69_NORM_38_prediction` / `CONTEXT69_NORM_38_rank` appear nowhere in code, migrations, docs or database column names (zero hits).
- What exists is legacy: **T45 Balanced** `t45-balanced-q375-r1`, 32 features (19 price + 9 flow + 4 R2), RobustScaler(10,90), rank window 768 / min 192, threshold 0.625, walk-forward refit every 96 rows over 8640, cutoff T+45s, deadline T+60s. Its frozen R2 prior key is `THREE::P0.35::TECH0.18::STUMP_MIXED_FAST::Q0.08::INDEPENDENT`, and `src/lib/t45/r2Prior.server.ts` **fails closed** for new candles because no live generator for that prior exists. Legacy T45 cannot produce forward decisions today.
- The other sibling, **T45 PriceFlow** `t45-price-flow-q375-r1`, is 28 price/flow features with R2 explicitly forbidden. It is not the improved R2 model either.
- Neither may be substituted. Version 1.1's second leg therefore waits on your private upload (R2 research code, frozen heads, parity ledger). Until it lands, the leg is implemented as an interface with no scorer behind it.

## 3. Smallest safe T+45 hook

`src/routes/api/public/hooks/t45-boundary-run.ts` already fires at the T+45s cutoff, is HMAC-signed, and is triggered by the always-on collector the moment the offset-44 bar is stored (cron is only a late watchdog). Version 1.1 adds one isolated step at the end of that handler, after the existing PriceFlow and legacy T45 work, in its own try/catch. This cannot delay the V1 T+5 path (different process, different instant) and does not revive any legacy standalone T45 send, which stays blocked by the empty `WEBHOOK_ALLOWED_MODELS`.

## 4. Immutability and one-bet-per-interval

- V1 keeps absolute priority: the T+45 step reads the committed V1 row and runs only when it is LIVE, valid, `final_side = 0`, `status = CONFIDENCE_ABSTAIN`, and `ordinary_floor_allows = true`. Guard-blocked, missing-input, warmup, floor-abstain and no-model rows are excluded.
- Duplicate prevention reuses the existing atomic claim with a Version 1.1 key `lite-a-floor4-top10-r1+t45r2:<ticker>:<isoZ>`, so one interval can never yield two bets even with concurrent workers or retries.
- The combined decision row is written once and never rewritten; late official strikes/labels are appended as audit fields only.
- T45 never touches V1 guard state, never settles into the daily floor ledger, and never advances V1 pending counts.

## 5. Files and schema

New (shadow only):
- `src/lib/v11/config.ts` — identity `version-1.1-original__confidence_rank80_4`, rank floor 0.80, 4% stake note, deadlines.
- `src/lib/v11/eligibility.server.ts` — reads the committed V1 row, applies the trigger test above, returns a typed verdict.
- `src/lib/v11/r2Adapter.server.ts` — the single seam where the uploaded improved R2 scorer plugs in; returns `UNAVAILABLE` until then.
- `src/lib/v11/decide.server.ts` — combines legs, writes the immutable combined row, no dispatch.
- `src/lib/v11/__tests__/` — isolated eligibility, duplicate-claim and rank-threshold tests.

Changed (minimal):
- `src/routes/api/public/hooks/t45-boundary-run.ts` — one appended isolated call.

Schema: one new table `v11_decisions` (interval identity, both legs, rank, source of the call, claim/dedupe key, immutability constraint, RLS + grants). No change to `c85_targets`, `c85_outbox`, `webhook_deliveries` or any T45 table.

## 6. Freshness and linkage

Railway remains sole writer for V1; the worker commits through the signed `c85-ops` / `c85-decision` routes into the same backend the site reads. T45 inputs arrive from the external always-on collector over the signed ingest route. Live health of that collector and current pg_cron registration were not verified in this read-only pass and will be confirmed before any activation step.

## 7. Conflicting work

Working tree is clean at `49e45e24`; the pre-send latency work (`336f58cf`, `49e45e24`) is committed and will be preserved verbatim. No other in-flight task touches these files. T45 sending stays off; new Version 1.1 dispatch ships off.

## Proposed order of work

1. Schema + shadow decision path + eligibility, with the R2 adapter returning `UNAVAILABLE`.
2. Focused isolated tests (eligibility, priority, single-bet claim, no guard mutation).
3. On receipt of your R2 upload: verify heads against your parity ledger, wire the adapter, replay the Apr 13 – Aug 30 window and reconcile against 4,003 V1 + 746 T45 calls.
4. Only after parity matches: propose the human activation step for real dispatch, as a separate approval.
