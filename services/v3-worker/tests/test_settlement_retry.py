"""Offline regressions for blocked settlement batches and durable retries."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import calibration as C
import reversal as R
import v3core as V
from calibration_runtime import CalibrationRuntime, SCHEMA as CAL_SCHEMA
from reversal_runtime import RiskRuntime, SCHEMA as RISK_SCHEMA
from settlement_retry import SettlementQueue, MAX_DELAY

NOW = 1791496800  # Midweek, after all synthetic candles below have closed.


def setup(consumer, path=":memory:"):
    s = V.Store(path)
    s.db.executescript(RISK_SCHEMA + CAL_SCHEMA)
    runtime = object.__new__(RiskRuntime if consumer == "reversal" else CalibrationRuntime)
    runtime.s = s
    runtime.engine = SimpleNamespace(s=s, faults={})
    runtime.market = Mock()
    runtime.settlements = SettlementQueue(s, consumer, C.LIVE_LINEAGE if consumer == "calibration" else None)
    s.q("INSERT OR IGNORE INTO reversal_heads VALUES(?,?)", (R.week_start(NOW), "{}"))
    s.q("INSERT OR IGNORE INTO calibration_heads VALUES(?,?,?)", (C.week_start(NOW), C.LIVE_LINEAGE, "{}"))
    return runtime


def insert(rt, c, *, side=1, lineage=C.LIVE_LINEAGE):
    if rt.settlements.consumer == "reversal":
        rt.s.q("INSERT INTO reversal_rows VALUES(?,?,?,NULL,NULL,?)", (c, side, "[]", "live"))
    else:
        rt.s.q("INSERT INTO calibration_observations VALUES(?,?,?,NULL,NULL,?)",
               (c, json.dumps({"candidate": {}}), side, lineage))


def outcome(c, **changes):
    return {"ticker": V.kalshi_ticker(c), "status": "finalized", "result": "yes",
            "settlement_ts": V.iso_ms((c+900)*1000), **changes}


def http_error(code):
    request = httpx.Request("GET", "https://example.invalid/market")
    return httpx.HTTPStatusError("unavailable", request=request, response=httpx.Response(code, request=request))


def labels(rt):
    return rt.s.q(f"SELECT candle_s,label FROM {rt.settlements.table} ORDER BY candle_s")


@pytest.mark.parametrize("consumer", ["reversal", "calibration"])
@pytest.mark.parametrize("error", [404, 429, 503, "timeout"])
def test_first_failure_does_not_block_later_official_result(consumer, error):
    rt = setup(consumer)
    a, b = NOW-3600, NOW-2700
    insert(rt, a); insert(rt, b)
    failure = httpx.ReadTimeout("timeout") if error == "timeout" else http_error(error)
    rt.market.settled_market.side_effect = [failure, outcome(b, result="no")]
    rt.settle_and_refit(NOW)
    assert labels(rt) == [(a, None), (b, -1)]
    assert rt.settlements.health()["deferred"] == 1
    assert rt.settlements.last_batch["settled"] == 1
    rt.market.reset_mock()
    rt.settle_and_refit(NOW+30)
    rt.market.settled_market.assert_not_called()


@pytest.mark.parametrize("consumer", ["reversal", "calibration"])
def test_more_than_a_batch_of_missing_markets_cannot_starve_new_rows(consumer):
    rt = setup(consumer)
    candles = [NOW-900*i for i in range(30, 0, -1)]
    for c in candles:
        insert(rt, c)
    good = candles[-1]
    def lookup(ticker):
        if ticker == V.kalshi_ticker(good):
            return outcome(good)
        raise http_error(404)
    rt.market.settled_market.side_effect = lookup
    rt.settle_and_refit(NOW)
    assert rt.market.settled_market.call_count == 20
    # Even if the first batch is retry-eligible again, unattempted rows go first.
    rt.settle_and_refit(NOW+61)
    assert dict(labels(rt))[good] == 1
    assert rt.settlements.health()["deferred"] == 29


@pytest.mark.parametrize("consumer", ["reversal", "calibration"])
def test_retry_is_durable_capped_and_cleared_only_after_official_settlement(consumer, tmp_path):
    path = str(tmp_path / "store.sqlite")
    rt = setup(consumer, path)
    c = NOW-1800
    insert(rt, c)
    rt.market.settled_market.side_effect = http_error(404)
    rt.settlements.poll(rt.market, NOW)
    rt.s.db.close()
    rt = setup(consumer, path)
    rt.settlements.poll(rt.market, NOW+59)
    rt.market.settled_market.assert_not_called()
    now = NOW
    for i in range(10):
        due = rt.settlements.health()["next_retry_s"]
        assert 60 <= due-now <= MAX_DELAY
        now = due
        rt.market.settled_market.side_effect = http_error(404)
        rt.settlements.poll(rt.market, now)
    assert rt.settlements.health()["next_retry_s"]-now == MAX_DELAY
    rt.market.settled_market.side_effect = None
    rt.market.settled_market.return_value = outcome(c)
    rt.settlements.poll(rt.market, now+MAX_DELAY)
    assert labels(rt) == [(c, 1)]
    assert rt.settlements.health()["deferred"] == 0


@pytest.mark.parametrize("changes", [
    {"ticker": "KXBTC15M-WRONG"}, {"status": "closed"}, {"result": ""},
    {"settlement_ts": None}, {"settlement_ts": "broken"},
    {"settlement_ts": "2026-10-08T12:00:00"},
    {"settlement_ts": V.iso_ms((NOW+1)*1000)},
    {"settlement_ts": V.iso_ms((NOW-1801)*1000)},
])
def test_invalid_or_unfinalized_market_remains_unlabeled(changes):
    rt = setup("reversal")
    a, b = NOW-1800, NOW-900
    insert(rt, a); insert(rt, b)
    rt.market.settled_market.side_effect = [outcome(a, **changes), outcome(b)]
    rt.settle_and_refit(NOW)
    assert labels(rt) == [(a, None), (b, 1)]


def test_calibration_ignores_proxy_and_no_candidate_rows():
    rt = setup("calibration")
    insert(rt, NOW-2700, lineage=C.PROXY_LINEAGE)
    insert(rt, NOW-1800, side=0)
    insert(rt, NOW-900)
    rt.market.settled_market.return_value = outcome(NOW-900)
    rt.settle_and_refit(NOW)
    rt.market.settled_market.assert_called_once_with(V.kalshi_ticker(NOW-900))
    assert [label for _, label in labels(rt)] == [None, None, 1]


@pytest.mark.parametrize("consumer", ["reversal", "calibration"])
def test_stale_training_still_prevents_refit(consumer):
    rt = setup(consumer)
    rt.s.q("DELETE FROM reversal_heads")
    rt.s.q("DELETE FROM calibration_heads")
    if consumer == "calibration":
        insert(rt, C.week_start(NOW)-26*C.WEEK, side=0)
    insert(rt, NOW-900)
    rt.market.settled_market.side_effect = http_error(404)
    with pytest.raises((R.RiskInvalid, C.CalibrationInvalid), match="TRAINING_STALE"):
        rt.settle_and_refit(NOW)


def test_programming_errors_are_not_silently_deferred():
    rt = setup("reversal")
    insert(rt, NOW-900)
    rt.market.settled_market.side_effect = RuntimeError("unexpected")
    with pytest.raises(RuntimeError, match="unexpected"):
        rt.settle_and_refit(NOW)
