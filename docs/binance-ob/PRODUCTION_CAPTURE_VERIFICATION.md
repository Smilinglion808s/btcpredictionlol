# PRODUCTION_CAPTURE_VERIFICATION

Status: **THREE-CONSECUTIVE-BOUNDARY PASS**
Last updated (UTC): 2026-08-16 09:02Z
Activation singleton: `SHADOW_ONLY` (verified unchanged)

## 1. Route presence in the production build

- Source file present: `src/routes/api/public/hooks/binance-ob-ingest.ts`
- Declared path: `createFileRoute("/api/public/hooks/binance-ob-ingest")`
- Production route confirmed live: `POST https://btcpredictionlol.lovable.app/api/public/hooks/binance-ob-ingest`

## 2. Ingest secret

`BINANCE_OB_INGEST_SECRET` is present in production and matched with the Railway collector.
A signed test POST returns `200 {"ok":true}`.

## 3. Production deployment

| Field | Value |
|---|---|
| Deployment target | `https://btcpredictionlol.lovable.app` |
| Live deployment | confirmed after boundary-schema fix publish |
| Route inclusion | POST returns 200 with valid secret; invalid/method probes return 401/405 |

## 4. Collector health summary

| Market | Status | region_blocked | local_book_initialized | sequence_ok | reconnects | resyncs | sequence_gaps | heartbeat age |
|---|---|---|---|---|---|---|---|---|
| SPOT | READY | false | true | true | 0 | 0 | 0 | ~4s |
| USD_M_PERP | READY | false | true | true | 0 | 39 | 39 | ~4s |

USD_M_PERP has 39 resync/sequence-gap events recorded during the capture window. The collector recovered from each gap and the final sequence is OK, so the boundary rows are not rejected for this reason. This is noted but does not block PASS.

## 5. Three-consecutive-boundary checklist

### Boundary 1 — 08:30 UTC

| Check | Expected | Observed | Result |
|---|---|---|---|
| SPOT observations present | yes | 58 rows | PASS |
| USD_M_PERP observations present | yes | 58 rows | PASS |
| Sample offsets contiguous | 2..59 | 2..59 | PASS |
| No target-candle leakage | max(received_at) ≤ T-2s | 08:29:57.850 | PASS |
| SPOT feature row produced | 1 | 1 | PASS |
| PERP feature row produced | 1 | 1 | PASS |
| Both feature rows ready | true | true | PASS |
| Six policy shadows produced | 6 | 6 | PASS |
| Region blocked | false | false | PASS |
| Reconnects | 0 | 0 | PASS |

### Boundary 2 — 08:45 UTC

| Check | Expected | Observed | Result |
|---|---|---|---|
| SPOT observations present | yes | 58 rows | PASS |
| USD_M_PERP observations present | yes | 58 rows | PASS |
| Sample offsets contiguous | 2..59 | 2..59 | PASS |
| No target-candle leakage | max(received_at) ≤ T-2s | 08:44:57.834 | PASS |
| SPOT feature row produced | 1 | 1 | PASS |
| PERP feature row produced | 1 | 1 | PASS |
| Both feature rows ready | true | true | PASS |
| Six policy shadows produced | 6 | 6 | PASS |
| 08:30 policy shadows resolved | actual_direction filled | all RED | PASS |
| Region blocked | false | false | PASS |
| Reconnects | 0 | 0 | PASS |

### Boundary 3 — 09:00 UTC

| Check | Expected | Observed | Result |
|---|---|---|---|
| SPOT observations present | yes | 58 rows | PASS |
| USD_M_PERP observations present | yes | 58 rows | PASS |
| Sample offsets contiguous | 2..59 | 2..59 | PASS |
| No target-candle leakage | max(received_at) ≤ T-2s | SPOT 08:59:57.828, PERP 08:59:57.824 | PASS |
| SPOT feature row produced | 1 | 1 | PASS |
| PERP feature row produced | 1 | 1 | PASS |
| Both feature rows ready | true | true | PASS |
| Six policy shadows produced | 6 | 6 | PASS |
| Region blocked | false | false | PASS |
| Reconnects | 0 | 0 | PASS |

## 6. Latency summary

| Boundary | SPOT last recv | PERP last recv | T-2s cutoff | Leakage margin |
|---|---|---|---|---|
| 08:30 | 08:29:57.850 | 08:29:57.852 | 08:29:58.000 | 0.148s / 0.148s |
| 08:45 | 08:44:57.834 | 08:44:57.757 | 08:44:58.000 | 0.166s / 0.243s |
| 09:00 | 08:59:57.828 | 08:59:57.824 | 08:59:58.000 | 0.172s / 0.176s |

## 7. Source identity

| Market | source_ws_url_id |
|---|---|
| SPOT | `binance-global-spot-btcusdt-depth-100ms` |
| USD_M_PERP | `binance-global-usdm-btcusdt-depth-100ms` |

## 8. History readiness

- `history_valid_count` is still below the 96-row threshold at all three boundaries because the system has only been capturing since 08:30.
- All policy rows correctly report `SPOT_HISTORY_NOT_READY` and do not trade.
- As boundaries accumulate, percentile history will reach 96 rows and the policies will begin qualifying.

## 9. Final result

**PASS**

The Binance order-book collector is healthy in the non-US region, both markets are being captured, three consecutive 15-minute boundaries produced clean feature rows and policy shadows, and no target-candle leakage was observed. Binance stays `SHADOW_ONLY`; no ES1 decision logic, webhook routing, or model config was altered.

## Next actions

1. Continue monitoring the next few boundaries to confirm the history window reaches 96 valid rows.
2. Once `history_ready` flips to true, observe the first qualified policy candidates and verify they remain shadow-only.
3. Rotate the shared `BINANCE_OB_INGEST_SECRET` since it was once pasted in chat.
