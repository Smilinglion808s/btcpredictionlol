# V1.2 execution repair — September 18, 2026

Status: implemented and tested locally; production unchanged. Source commit `260a8b5` on local branch `codex/v12-execution-recovery`.

## Changes ready for deployment

- Convert model probabilities (0–1) to the existing integer confidence percentage (0–100) when creating bet_history. U's 0.8798966037814971 becomes 88. Preserve original probability in the signal.
- Refresh a quote once after network-bound final authorization checks when it has aged beyond one second. Preserve the initial price ceiling, available budget, quantity bound, original deadlines, and pause/release checks. Persist any revised price/quantity before submitting.
- Distinguish a confirmed terminal maker and an unsubmitted fallback from a genuinely unknown submission. Keep unknown POST outcomes pending for reconciliation.
- Retry the order-status GET at most twice after a transient 404; never retry an order POST or treat 404 as cancellation.
- Reconcile the recorded r2 pre-submit failure and legacy explicit post-only rejection. Update receiver execution status after authoritative reconciliation.

Deployment targets: existing repository `Smilinglion808s/btcpredictionlol`, branch `main`; Supabase project `ruxndqfjfdbtdbkheuge`, functions `v12-v1`, `v12-t45r2`, `v12-u`, and `settle-bets`. Executor revision becomes `v12-executor-r3`.

All changes are prepared in source. No Railway/model deployment, stake changes, expanded entry windows, or price-limit changes are required. Do not replay the missed U signal or submit synthetic live signals.

## Evidence

U at 2026-09-18 07:08 UTC (01:08 Boise): prediction delivered and acknowledged. Receipt `7c26e545-b115-43e5-8476-536199820937` is NOT_SUBMITTED without bet_id. Deployed executor inserted decimal confidence into integer column. Read-only jsonb_populate_record reproduced PostgreSQL 22P02 for the original decimal and accepted 88 after conversion.

Pending entries checked at 15:07 UTC (09:07 Boise):

| Interval, Boise time | Evidence | Interpretation |
|---|---|---|
| Sep 14 00:00 and 03:45 | Legacy CLAIMING placeholders, zero contracts, no order IDs or execution trace | Old incomplete claims. Exchange outcome not established; no automatic cancellation included for these ambiguous records. |
| Sep 14 15:00 | Venue explicitly rejected maker with `invalid_order / post only cross` | Known rejection incorrectly retained as pending. Prepared reconciler closes it as cancelled. |
| Sep 18 06:45 | Maker GET confirmed canceled with zero fill; fallback has no submit marker; trace ends PRE_SUBMIT_EXPIRED | No-fill record incorrectly marked RECONCILIATION_REQUIRED. Prepared reconciler re-reads the maker before closing. |
| Sep 18 09:00 | Nine filled contracts in current 15-minute market | Legitimate pending position awaiting settlement. |

Settlement cron is active at minutes 03, 18, 33, 48, so a just-closed filled market can remain pending until the next pass and official venue result.

Likely match for the approximately 1.87x skipped opportunity: Sep 17 23:45 Boise (Sep 18 05:45 UTC). Maker at 51 cents filled zero, was confirmed cancelled; fallback quote was 54 cents (1.8519x gross), while the original allowed ceiling was 53 cents (1.8868x gross). The cap blocked the taker despite odds above the general minimum. This identity remains provisional without the user's exact timestamp. Other skipped entries had PRE_SUBMIT_EXPIRED after database/gate latency.

## Verification

- 27 targeted executor/reconciliation tests pass, including U integer storage, all six U checkpoints, maker fallback, slow authorization quote refresh, unknown POST outcome, transient/persistent order-read 404, and historical no-fill reconciliation.
- TypeScript check passes.
- Edge executor bundle rebuilt successfully.
- Live read-only database conversion check passes.

## Release block and remaining work

Deployment was explicitly approved and is complete: the three receivers are live at v4 and `settle-bets` at v68 on Supabase project `ruxndqfjfdbtdbkheuge`. Source publishing to the connected repository `Smilinglion808s/btcpredictionlol` (branch `main`) was still pending at the start of this sync and is the remaining step, performed through the connected Lovable editor of that same repository. The two unproven legacy CLAIMING entries stay unresolved until exchange evidence or original execution provenance establishes their outcome. No Railway deployment, gate change, or test signal is part of this step.

Note on scope in the connected editor: this project blocks creation of new Supabase Edge Function source directories, so `supabase/functions/settle-bets/` (`index.ts`, `entry-reconcile.ts`, `deno.json`) and the reconciliation half of `services/v12-executor/recovery.test.ts` are not carried in this repository. Those files remain in the deployed `settle-bets` v68 function and in the local branch.
