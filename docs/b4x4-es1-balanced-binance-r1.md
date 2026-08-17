# B4x4-ES1 Balanced Binance 3-of-4 R1

Active revision of B4x4-ES1. Replaces the legacy 11-step ES1 chain as the
**publishing** decision; the legacy chain still runs and is stored per candle as
a scored counterfactual.

## Frozen identity

| Field | Value |
| --- | --- |
| model_name | `B4x4-ES1` |
| model_version (published) | `b4x4-es1-balanced-binance-r1` |
| variant | `es1-binance-3of4-balanced` |
| decision_policy_version | `ES1_BINANCE_3OF4_BALANCED_R1` |
| prospective_test_id | `B4X4_ES1_BINANCE_3OF4_BALANCED_R1` |
| feature_schema | `es1-price-spot-depth-spot-ofi60-perp-fade-votes-r1` |
| implementation_revision | `b4x4-es1-live-balanced-binance-r1` |

Row storage keeps `model_version = b4x4-es1-aligned-r1` on
`b4x4_es1_predictions` so the certified fit binding, replay determinism and the
full historical series remain intact. The balanced identity is persisted on the
same row in `balanced_model_version`, `balanced_policy_version`,
`balanced_prospective_test_id`, `balanced_feature_schema`,
`balanced_implementation_revision` and `balanced_config_hash`, and it is the
identity emitted on the outbound webhook.

## Decision

Four equally weighted votes, each `+1` (GREEN) or `-1` (RED):

1. `ES1` — certified ES1 price-head direction
2. `SPOT_DEPTH` — Binance Global SPOT `final_imbalance_10bps` (follow)
3. `SPOT_OFI60` — Binance Global SPOT `normalized_ofi_60s` (follow)
4. `PERP_FADE` — Binance Global USD-M PERP `final_imbalance_10bps` (**faded**)

- 4-of-4 → publish, `agreement_tier = UNANIMOUS_4_OF_4`
- 3-of-4 → publish, `agreement_tier = MAJORITY_3_OF_4`
- 2-2 → abstain, `ABSTAIN_BALANCED_VOTE_TIE_2_2`

No magnitudes, percentiles, thresholds, outcomes, running state, time-of-day,
A2, B4 grid or brake logic participate. A zero or non-finite input is never a
vote — it fails the boundary closed.

## Fail-closed readiness (first match wins)

1. ES1 not parity certified → `ABSTAIN_ES1_NOT_PARITY_CERTIFIED`
2. ES1 direction missing → `ABSTAIN_ES1_DIRECTION_INVALID`
3. Either book sequence-invalid / resync-discontinuous / generation-split →
   `ABSTAIN_BINANCE_SEQUENCE_NOT_CONTINUOUS`
4. SPOT gate failure → `ABSTAIN_BINANCE_SPOT_NOT_READY`
5. PERP gate failure → `ABSTAIN_BINANCE_PERP_NOT_READY`
6. Zero / non-finite voted feature → `ABSTAIN_BINANCE_FEATURE_INVALID`

Per-market gates: exact `target_ts`, venue `BINANCE_GLOBAL`, symbol `BTCUSDT`,
matching feature/collector version, matching config and feature-schema hash,
`capture_status = FRESH`, `ready = true`, `sequence_ok = true`,
`book_complete_10bps = true`, `resync_continuous = true`, single resync
generation, a final observation present, final target age in `[2000, 5000] ms`,
and at least 50 of the 59 expected 1s observations. Percentile history
(`history_ready`) is **not** required — this revision uses no percentiles.

## Ordering contract

Per boundary run (`/api/public/hooks/es1-boundary-run`):

```text
source candle ingest → legacy ES1 chain (persisted, counterfactual)
  → Binance exact-target feature finalization + readiness gates
  → ACTIVE balanced 4-vote decision
  → webhook (balanced direction only)
```

Binance feature loading now happens **before** the active decision, never after
the webhook.

## Activation

`b4x4_es1_activation` is the single authoritative record.
`balanced_activation_target_ts` is committed exactly once — on the first target
where ES1 is parity certified and **both** books pass every gate — and is set to
the next clean 15-minute boundary. Before it, every row is recorded with
`ABSTAIN_BALANCED_ACTIVATION_NOT_REACHED` and no webhook is sent.

## Shadow policies

Nine rows per candle in `b4x4_es1_balanced_shadows` (one per policy, including
abstentions, unique on `target_ts, policy_name`):

`ES1_PRICE_HEAD_ALL_R1`, `BINANCE_SPOT_DEPTH_FOLLOW_R1`,
`ES1_SPOT_DEPTH_CONFIRM_R1`, `BINANCE_SPOT_DEPTH_OFI60_CONFIRM_R1`,
`BINANCE_SPOT_PERP_FADE_AGREE_R1`, `BINANCE_OB_UNANIMOUS_3OF3_R1`,
`ES1_BINANCE_UNANIMOUS_4OF4_R1`, `ES1_BINANCE_3OF4_BALANCED_R1` (the only row
with `is_active_policy = true`), `LEGACY_B4X4_ES1_POLICY`.

Scoring truth stays OKX `BTC-USDT 15m` confirmed. `balanced_incremental_value`
is the balanced score minus the legacy score for the same candle.

## Timing rule revision — 250 ms window-start lead tolerance

`WINDOW_START_LEAD_TOLERANCE_MS = 250` (`src/lib/b4x4es1/binanceOb/timing.ts`)
and the matching database constraint `binance_ob_sample_window` are an
**intentional** revision, not a workaround. The collector emits its T-60s sample
from a timer that can fire up to a quarter second before the nominal window
start; without the tolerance that first sample was rejected and every boundary
capped at 58/59 observations. Rows arriving more than 250 ms before the window
start, or after the T-2s cutoff, are still rejected. The tolerance affects
ingest admission only — it never widens the feature cutoff, the target-age band
or any readiness gate.
