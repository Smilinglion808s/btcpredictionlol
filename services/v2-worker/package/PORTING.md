# Port V2 Final R1 into the existing worker

The intended integration boundary is **feature snapshot → V2 decision → existing durable sender → existing betting bot**. Keep the current scheduler, signing, credentials, receiver and reconciliation code. No new public endpoint or replacement betting service is needed.

The package has not inspected the current deployed receiver schema. Its returned event is an **internal decision contract**, not a claim of wire compatibility. Map it through the existing webhook serializer and register the new model IDs before shadow testing. The code never sends HTTP requests or enables betting.

## Required data

Use the lab's Binance spot BTCUSDT measurement stream. Completed 15-minute bars need `bar_open` (UTC), `open`, `high`, `low`, `close`, base `volume`, `quote_volume`, `trade_count`, `taker_buy_volume`, and `complete=true`. Opening one-second bars need `open`, `high`, `low`, `close`, `volume`, `count`, and `taker_buy_volume`, with exact UTC close times at millisecond 999. Aggregate trades into the same bins as the lab. Missing seconds must not be silently compressed or replaced with later data.

Before each boundary, compute/cache `preopen_frame(bars)`, taking the row whose `ts` equals the upcoming target. Preserve the same continuous history or identically seeded indicator state across restarts. Recursive indicators use SMA seeds; recomputing them from a short arbitrary tail can change values. Do this work before T+0, not inside the deadline. The raw-feature parity test uses the original continuous bar history starting 1 June 2024. Future history can append normally.

At T+8 send exactly seconds 0–7. The predictors use seconds 0–6, and Fade8's final price gate uses second 7 only. At T+45 send exactly seconds 0–43. Evaluate as soon as those inputs and the checkpoint are ready; do not wait for another arbitrary scheduler slot. The runtime rejects evaluations outside [T+8,T+9) or [T+45,T+46); the backtest's nominal times are T+8 and T+45, so actual within-window delay still needs measurement.

## Minimal integration

```python
from v2final.runtime import V2Final, DecisionStore

model = V2Final("models/current")
state = DecisionStore("/persistent/v2_final.sqlite", model)

# The existing collector builds request from observed data; no future tape.
event = state.evaluate(request)
# Hand pending records to the existing durable webhook sender in shadow mode.
for event in state.poll_pending():
    payload = existing_serializer(event)  # explicit field mapping described below
    # existing_sender(payload); do not enable here as part of the research port
    # state.ack(event["event_id"]) only after durable downstream acceptance
```

Do not create a new SQLite file per candle. Put it on persistent storage or reproduce its transaction/outbox contract in the existing database. T+45 requires the recorded T+8 abstention; a missing early callback fails closed. A prior call prevents later sleeves and returns `should_emit=false` on duplicates. A pending decision survives restart. Sender retries may redeliver the same event, so the receiver must deduplicate `event_id`; this is at-least-once delivery, not an unsupported exactly-once promise. Once a decision intent is committed, quote rejection does not activate another sleeve in the candle.

## Request contract

```json
{
  "feed": "binance-spot-btcusdt",
  "target_open": "2026-09-29T00:00:00+00:00",
  "decision_time": "2026-09-29T00:00:08.001+00:00",
  "decision_second": 8,
  "preopen_asof": "2026-09-28T23:59:59.999+00:00",
  "last_input_received_at": "2026-09-29T00:00:08.000+00:00",
  "close_time_ms": ["eight actual millisecond timestamps, seconds 0–7"],
  "preopen": {"all 25 keys from PRE + TECH": "finite numeric values"},
  "scale": {"vol": 0.001, "meanvol": 100, "meancount": 10000},
  "tape": {"open": [], "high": [], "low": [], "close": [], "volume": [], "count": [], "taker_buy_volume": []}
}
```

The JSON above documents the fields, not fabricated tradable inputs. Complete numeric historical fixtures are in the full research package's `tests/runtime_fixtures.json`; they need their associated block 101 model bundles, not the current block 105 models.

`preopen` has 25 source measurements: the 15 prior/clock fields plus 10 technical fields. Those generate 25 directional and 33 reversal model inputs after adding/transforming the opening tape. The normalizers are the preceding 96-bar close-return population volatility (floor 1e-8), mean base volume and mean trade count. Opening activity is scaled by elapsed seconds/900. Technical fields carry the lab's centering/scaling and float32 conversion.

## Output / serializer mapping

| Internal field | Meaning / action |
|---|---|
| `parent_model_id` | `v2-final-r1` |
| `model_id` | `v2-direction8-r1`, `v2-fade8-r1`, or `v2-direction45-r1` |
| `target_ms`, `target_open` | Same candle identifier used by collector and receiver |
| `direction`, `side` | GREEN/+1, RED/−1, ABSTAIN/0. Map through the existing direction convention. |
| `decision_second` | 8 or 45, for traceability |
| `confidence` | Selected side's calibrated model estimate; not a verified success probability |
| `model_eligible` | True only when that sleeve qualifies |
| `event_id` | Stable parent-model + target id. Preserve for deduplication. |
| `assumed_effective_odds` | Research metadata, never a substitute for an executable quote |
| `execution_enabled`, `quote_verified` | Both false in this research adapter |

Only eligible decisions go to the sender. Do not map ABSTAIN to a bet. Receiver registration must explicitly recognize the new IDs; do not reuse V1, T45 or U aliases that inherit their existing sizing/P2 settings. For the requested replication, the betting simulation risks exactly $2 per trade regardless of sleeve. Production sizing remains a separate user-controlled execution setting; this task did not change it.

## Refit / promotion boundary

Current bundles were fitted at 14 September 2026 and expire 12 October 2026 UTC. For each next scheduled boundary, append the causal data, rebuild feature tables, and run `refit.py --cutoff <boundary> --data <prepared-root> --output <new-model-dir>`. The script rejects incomplete training coverage and writes to a new directory. Switch all three bundles and manifest atomically at a boundary, preserving the decision store. Never reuse one fit forever or refit using unresolved labels.

Before enabling actual sends, verify collector feature parity on the deployed feed, new-ID receiver mapping, persistent outbox/deduplication, current model validity, and measured data-receipt-to-webhook latency. The local runtime test took about 9 ms median and 11 ms at p95 for fixture cycles (some include both checkpoints); those numbers exclude collection, network and exchange execution.
