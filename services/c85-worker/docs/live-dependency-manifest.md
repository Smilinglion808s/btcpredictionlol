# C85 reconstruction — live dependency manifest

Status of every input the boundary path needs, as measured on 2026-09-09.
Columns mean: **implemented** (live producer code exists), **wired** (reachable
from `LivePacketSource.build`), **fitted** (a current fitted state applies),
**fresh** (received real data in a bounded probe today).

Model identity for everything below is `c85-reconstruction-r1`. It is a
separately identified baseline; archived C85 performance does not transfer to it.

## Market data feeds

| Feed | Implemented | Wired | Fresh | Transport measured | Source |
|---|---|---|---|---|---|
| binance_spot aggTrades (BTCUSDT) | yes | yes | yes (910 trades / 55s) | websocket | `src/feeds.py` |
| binance_um aggTrades (BTCUSDT) | yes | yes | yes (1,559 / 55s) | **rest fallback** | `src/feeds.py` |
| binance_cm aggTrades (BTCUSD_PERP) | yes | yes | yes (1,013 / 55s) | rest fallback | `src/feeds.py` |
| binance_usdc aggTrades (BTCUSDC) | yes | yes | yes (171 / 55s) | websocket | `src/feeds.py` |
| binance_1m klines (BTCUSDT) | yes | yes | yes (10 minutes) | websocket | `src/feeds.py` |
| binance_index 1m klines (BTCUSDT) | yes | yes | yes (10 minutes) | rest fallback | `src/feeds.py` |
| binance_usdc_1m klines | yes | yes | yes (10 minutes) | websocket | `src/feeds.py` |
| binance_cm_1m klines | yes | yes | yes (10 minutes) | websocket | `src/feeds.py` |
| kalshi `[T, T+5s)` target window | yes | yes | yes (73 eligible trades, `market_q1=true`, `floor_strike=79046.59` on `KXBTC15M-26SEP091030-30`) | rest | `src/feeds.py` |

Transport note: the USD-M `fstream` websocket completes its handshake in this
environment and then delivers zero frames, while `fapi` REST returns 200. Feeds
that go silent past their grace window promote themselves to REST polling of the
same endpoint family, keep the identical `aggTrades` payload schema, and report
`transport: "rest"` so the degradation is visible rather than silent. REST
receipt times are genuinely later and are recorded as received, never backdated.

## Packet assembly (`src/packets.py`)

| Input | Implemented | Wired | Notes |
|---|---|---|---|
| spot/UM t0+t5 window features | yes | yes | `underlying_n = l - f + 1` from the aggTrade ids, `signed = -1` when the buyer is the maker |
| `spot_t0_price` | yes | yes | open of the candle beginning at T = first received spot trade at/after T; never interpolated |
| `floor_strike`, `market_q1`, `last_yes_price` | yes | yes | from the target market's own `[T, T+5s)` window |
| USDC quote minute (T-1) | yes | yes | exact key lookup, no forward fill |
| index / spot prior minute | yes | yes | exact `open_ms == T-60000`, `close_ms == T-1` checks |
| COIN-M 16-minute context | yes | yes | requires all 16 completed minutes; never padded |
| direction matrix (60 inputs) | yes | yes | `base_anchor_fields` → `quote_fields` → `index_fields` → `build_direction_features` |
| meta features, auxiliary outputs, `c54_prediction` | **no live producer** | fails closed | see below |

## Leaf experts (`src/experts/leaf.py`, 11 required outputs)

| Output | Live producer | Fitted state | Recovered batch source |
|---|---|---|---|
| external_direction | interface wired | **missing fitted long-context head** | `long_context.py`, `direction_contract.py` |
| external_rank | interface wired | depends on the above | `direction_contract.py` |
| c30_prediction, c36_prediction, c37_prediction | no | no | `continuation/stage_c30.py` (batch) |
| r4_prediction, r4_probability_correct, r4_directional_rank | no | no | `continuation/stage_r4.py` (batch) |
| expansion_selected_prediction, opportunity, mean_135_rank | no | no | `continuation/stages.py` (batch) |

The continuation stages are historical batch producers over recovered archives.
They are real and verified, but they are NOT live per-target producers, and this
manifest does not count them as such.

## Consequence

The boundary path now assembles every market-derived input from received data
and stops at a named list of missing leaf producers instead of a generic
"assembly incomplete". A boundary today produces a MISSED row naming exactly:

```
C85_LEAF_OUTPUT_MISSING: meta_features_without_aux / auxiliary_outputs / c54_prediction
```

plus any feed gap. Execution dispatch is hard-suppressed in code
(`allow_dispatch=False`, `dispatch_status() == "SUPPRESSED"`), independent of
configuration. T45 is untouched.

## Remaining prerequisites for forward prediction logging

1. A fitted long-context head + its causal warmup state (external direction/rank).
2. Live per-target producers for the C30/C36/C37/R4/expansion leaf outputs.
3. The auxiliary LONG/RECENT heads and the C54 live prediction.
4. Railway deployment credentials — none are present in this environment, so no
   deployment SHA can be reported.
