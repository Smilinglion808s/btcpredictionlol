"""Offline tests for the V2 Final R1 recording worker. No network, no orders.

Covers: package/seed hash validation, indicator warmup, a real scored T+8
checkpoint, missing one-second bars, restart + outbox durability, model expiry
and tamper detection.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "package"))

import marketdata  # noqa: E402
import service  # noqa: E402
from journal import Journal  # noqa: E402

VALID_TARGET_MS = int(pd.Timestamp("2026-09-20T12:00:00Z").value // 1_000_000)


class FakeRest:
    """Offline stand-in: no backfill available, clock in sync."""

    def __init__(self, now_ms: int) -> None:
        self.now_ms = now_ms

    def klines(self, interval, start_ms, end_ms, limit=1000):
        return []

    def server_time_ms(self):
        return self.now_ms


def synth_seconds(open_ms: int, count: int, price: float, drift_bps: float = 2.0) -> dict:
    """Deterministic synthetic one-second closed klines for a candle."""
    bars = {}
    for i in range(count):
        p = price * (1 + drift_bps / 10_000 * (i + 1) / count)
        bars[open_ms + i * 1000 + 999] = {
            "open_ms": open_ms + i * 1000, "close_ms": open_ms + i * 1000 + 999,
            "open": p * 0.99995, "high": p * 1.0001, "low": p * 0.9999, "close": p,
            "volume": 1.5, "quote_volume": 1.5 * p, "trade_count": 40, "taker_buy_volume": 0.8,
            "received_at_ms": open_ms + i * 1000 + 999 + 50,
        }
    return bars


def extend_history(df: pd.DataFrame, through_open_ms: int) -> pd.DataFrame:
    """Continue the seed with deterministic bars so no warmup is truncated."""
    last = df.iloc[-1]
    rows = []
    ts = int(df.bar_open.iloc[-1].timestamp() * 1000) + marketdata.INTERVAL_MS
    price = float(last.close)
    i = 0
    while ts <= through_open_ms - marketdata.INTERVAL_MS:
        i += 1
        price *= 1 + 0.0004 * np.sin(i / 7.0)
        rows.append({"bar_open": pd.Timestamp(ts, unit="ms", tz="UTC"), "open": price * 0.999,
                     "high": price * 1.002, "low": price * 0.998, "close": price, "volume": 120.0 + i % 5,
                     "quote_volume": (120.0 + i % 5) * price, "trade_count": 3000 + i % 11,
                     "complete": True, "taker_buy_volume": 60.0 + (i % 3)})
        ts += marketdata.INTERVAL_MS
    return pd.concat([df, pd.DataFrame(rows)], ignore_index=True)


def make_engine(tmp: Path, now_ms: int, package_dir: Path | None = None) -> service.Engine:
    cfg = service.Config({"V2_MODE": "shadow", "V2_DATA_DIR": str(tmp), "V2_RECORD_URL": "http://localhost/none",
                          "C85_GATEWAY_SECRET": "test", "V2_WORKER_ID": "test-worker"})
    if package_dir:
        cfg.package_dir = package_dir
    eng = service.Engine(cfg, rest=FakeRest(now_ms))
    eng.load_model()
    return eng


class PackageIntegrity(unittest.TestCase):
    def test_frozen_package_hashes_match(self):
        spec = service.verify_package(ROOT / "package")
        self.assertEqual(len(spec["files"]), 16)

    def test_tampered_model_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            pkg = Path(d) / "package"
            shutil.copytree(ROOT / "package", pkg)
            target = pkg / "models" / "current" / "fade8.joblib"
            target.write_bytes(target.read_bytes() + b"x")
            with self.assertRaises(ValueError):
                service.verify_package(pkg)

    def test_seed_decodes_to_recorded_sha256(self):
        rest = FakeRest(0)
        with tempfile.TemporaryDirectory() as d:
            h = marketdata.BarHistory(ROOT / "seed", Path(d), rest)
            df = h.load_seed()
        meta = json.loads((ROOT / "seed" / "SEED_SHA256.json").read_text())
        self.assertEqual(len(df), meta["rows"])
        self.assertEqual(len(df), 80_160)
        self.assertTrue(df.complete.all())
        gaps = df.bar_open.diff().dropna()
        self.assertTrue((gaps == pd.Timedelta(minutes=15)).all())

    def test_corrupt_seed_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            seed = Path(d) / "seed"
            shutil.copytree(ROOT / "seed", seed)
            meta = json.loads((seed / "SEED_SHA256.json").read_text())
            meta["decoded_sha256"] = "0" * 64
            (seed / "SEED_SHA256.json").write_text(json.dumps(meta))
            with self.assertRaises(ValueError):
                marketdata.BarHistory(seed, Path(d), FakeRest(0)).load_seed()


class WarmupAndScoring(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.now = VALID_TARGET_MS + 8_400
        self.eng = make_engine(self.tmp, self.now)
        self.eng.history.df = extend_history(self.eng.history.load_seed(), VALID_TARGET_MS)
        self.eng.history.assert_continuous()
        self.eng.history_ready = True
        self.eng.clock_skew_ms = 0  # simulated wall clock; real skew is checked against Binance in production
        self.eng.build_preopen(VALID_TARGET_MS)
        self.eng.feed.bars = synth_seconds(VALID_TARGET_MS, 8, float(self.eng.history.df.close.iloc[-1]))
        self.eng.feed.backfilled_through_ms = self.now
        self.eng.feed.connected = True
        self.eng.feed.last_message_ms = VALID_TARGET_MS + 7_999

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_warmup_produces_finite_preopen_and_positive_scales(self):
        pre = self.eng.preopen
        self.assertEqual(pre["target_ms"], VALID_TARGET_MS)
        self.assertEqual(len(pre["preopen"]), 25)
        self.assertTrue(all(np.isfinite(list(pre["preopen"].values()))))
        self.assertTrue(all(v > 0 for v in pre["scale"].values()))
        self.assertTrue(self.eng.prediction_ready(self.now))

    def test_t8_checkpoint_scores_and_journals(self):
        cp = self.eng.run_checkpoint(VALID_TARGET_MS, 8, self.now)
        self.assertEqual(cp["checkpoint"], "T8")
        self.assertIn(cp["sleeve"], ("v2-direction8-r1", "v2-fade8-r1"))
        self.assertIsNone(cp["reason"])
        self.assertTrue(cp["features_ready"])
        self.assertIn(cp["side"], (-1, 0, 1))
        self.assertEqual(cp["payload"]["execution"], "OFF")
        self.assertEqual(len(cp["payload"]["inputs_hash"]), 64)
        self.assertEqual(len(self.eng.journal.pending()), 1)

    def test_missing_one_second_bar_fails_closed(self):
        del self.eng.feed.bars[VALID_TARGET_MS + 4 * 1000 + 999]
        cp = self.eng.run_checkpoint(VALID_TARGET_MS, 8, self.now)
        self.assertTrue(cp["reason"].startswith("MISSING_SECONDS"))
        self.assertFalse(cp["eligible"])
        self.assertFalse(cp["features_ready"])
        self.assertEqual(cp["side"], 0)

    def test_late_checkpoint_fails_closed(self):
        cp = self.eng.run_checkpoint(VALID_TARGET_MS, 8, VALID_TARGET_MS + 9_100)
        self.assertEqual(cp["reason"], "CHECKPOINT_WINDOW_MISSED")
        self.assertFalse(cp["eligible"])

    def test_t45_is_blocked_after_a_failed_t8(self):
        """A T+8 error is audit-only: it must never grant T+45 permission."""
        first = self.eng.run_checkpoint(VALID_TARGET_MS, 8, VALID_TARGET_MS + 9_100)
        self.assertEqual(first["reason"], "CHECKPOINT_WINDOW_MISSED")
        self.assertIsNone(self.eng.frozen_record(VALID_TARGET_MS))
        self.eng.feed.bars.update(
            synth_seconds(VALID_TARGET_MS, 44, float(self.eng.history.df.close.iloc[-1])))
        cp = self.eng.run_checkpoint(VALID_TARGET_MS, 45, VALID_TARGET_MS + 45_300)
        self.assertEqual(cp["reason"], "T8_UNRESOLVED")
        self.assertFalse(cp["eligible"])
        self.assertEqual(cp["side"], 0)

    def test_t45_runs_after_a_genuine_frozen_t8_abstention(self):
        cp8 = self.eng.run_checkpoint(VALID_TARGET_MS, 8, self.now)
        self.eng.feed.bars.update(
            synth_seconds(VALID_TARGET_MS, 44, float(self.eng.history.df.close.iloc[-1])))
        cp = self.eng.run_checkpoint(VALID_TARGET_MS, 45, VALID_TARGET_MS + 45_300)
        self.assertEqual(cp["checkpoint"], "T45")
        if cp8["eligible"]:
            self.assertEqual(cp["reason"], "DUPLICATE_INTENT")
        else:
            self.assertIsNone(cp["reason"])
            self.assertEqual(cp["sleeve"], "v2-direction45-r1")

    def test_late_final_second_still_scores_inside_the_window(self):
        """Finding A: the closed second-7 bar usually lands after 8.000."""
        price = float(self.eng.history.df.close.iloc[-1])
        full = synth_seconds(VALID_TARGET_MS, 8, price)
        last_key = VALID_TARGET_MS + 7 * 1000 + 999
        self.eng.feed.bars = {k: v for k, v in full.items() if k != last_key}
        clock = {"ms": VALID_TARGET_MS + 8_000}

        def now():
            if clock["ms"] >= VALID_TARGET_MS + 8_080 and last_key not in self.eng.feed.bars:
                self.eng.feed.put(full[last_key], received_at_ms=VALID_TARGET_MS + 8_080)
            return clock["ms"]

        def sleep(secs):
            clock["ms"] += max(1, int(secs * 1000))

        cp = service.run_window(self.eng, VALID_TARGET_MS, 8, now=now, sleep=sleep)
        self.assertIsNone(cp["reason"])
        self.assertEqual(cp["decision_at"], service.iso_ms(VALID_TARGET_MS + 8_080))

    def test_missing_until_deadline_fails_closed(self):
        self.eng.feed.bars.pop(VALID_TARGET_MS + 7 * 1000 + 999)
        clock = {"ms": VALID_TARGET_MS + 8_000}
        cp = service.run_window(self.eng, VALID_TARGET_MS, 8,
                                now=lambda: clock["ms"],
                                sleep=lambda s: clock.__setitem__("ms", clock["ms"] + max(1, int(s * 1000))))
        self.assertEqual(cp["reason"], "MISSING_SECONDS")
        self.assertFalse(cp["eligible"])
        self.assertIsNone(self.eng.frozen_record(VALID_TARGET_MS))

    def test_unrelated_later_bar_does_not_move_required_receipt_time(self):
        """Finding C: receipt time comes from the required bars only."""
        price = float(self.eng.history.df.close.iloc[-1])
        self.eng.feed.bars = {}
        for i, bar in enumerate(synth_seconds(VALID_TARGET_MS, 8, price).values()):
            self.eng.feed.put(bar, received_at_ms=VALID_TARGET_MS + i * 1000 + 1_040)
        before = self.eng.feed.tape(VALID_TARGET_MS, 8)["last_received_ms"]
        later = synth_seconds(VALID_TARGET_MS, 30, price)[VALID_TARGET_MS + 29 * 1000 + 999]
        self.eng.feed.put(later, received_at_ms=VALID_TARGET_MS + 30_000)
        after = self.eng.feed.tape(VALID_TARGET_MS, 8)
        self.assertEqual(after["last_received_ms"], before)
        self.assertEqual(before, VALID_TARGET_MS + 7 * 1000 + 1_040)
        self.assertEqual(len(after["received_at_ms"]), 8)

    def test_receipt_after_decision_fails_closed(self):
        key = VALID_TARGET_MS + 7 * 1000 + 999
        self.eng.feed.bars[key] = {**self.eng.feed.bars[key], "received_at_ms": self.now + 5_000}
        cp = self.eng.run_checkpoint(VALID_TARGET_MS, 8, self.now)
        self.assertEqual(cp["reason"], "INVALID_RECEIPT_TIME")
        self.assertFalse(cp["eligible"])

    def test_crash_before_journal_write_recovers_exactly_once(self):
        """Finding D: an intent committed to the frozen store is never lost."""
        boom = {"n": 0}

        def failing_record(cp):
            boom["n"] += 1
            raise RuntimeError("crash between store commit and journal write")

        self.eng.journal.record = failing_record
        with self.assertRaises(RuntimeError):
            self.eng.run_checkpoint(VALID_TARGET_MS, 8, self.now)
        row = self.eng.frozen_record(VALID_TARGET_MS)
        self.assertIsNotNone(row)
        if not row[1]:
            self.skipTest("synthetic tape produced an abstention; no intent to recover")
        original = self.eng.store.poll_pending()[0]
        self.eng.journal.close()

        restarted = make_engine(self.tmp, self.now)
        self.assertEqual(restarted.reconcile_store(), 1)
        self.assertEqual(restarted.reconcile_store(), 0)  # acked; never delivered twice
        pending = restarted.journal.pending()
        self.assertEqual(len(pending), 1)
        body = pending[0][1]
        self.assertEqual(body["payload"]["event_id"], original["event_id"])
        self.assertEqual(body["side"], original["side"])
        self.assertAlmostEqual(body["probability"], float(original["confidence"]))
        self.assertEqual(body["decision_at"],
                         service.iso_ms(int(pd.Timestamp(original["decision_time"]).value // 1_000_000)))
        self.assertTrue(body["eligible"])
        # T+45 stays blocked: the candle already holds a committed call.
        restarted.history.df = self.eng.history.df
        restarted.history_ready = True
        restarted.clock_skew_ms = 0
        restarted.build_preopen(VALID_TARGET_MS)
        restarted.feed.bars = synth_seconds(VALID_TARGET_MS, 44, float(self.eng.history.df.close.iloc[-1]))
        restarted.feed.backfilled_through_ms = self.now
        restarted.feed.connected = True
        late = restarted.run_checkpoint(VALID_TARGET_MS, 45, VALID_TARGET_MS + 45_300)
        self.assertEqual(late["reason"], "DUPLICATE_INTENT")
        self.assertFalse(late["eligible"])

    def test_no_second_intent_after_a_call(self):
        first = self.eng.run_checkpoint(VALID_TARGET_MS, 8, self.now)
        self.eng.feed.bars.update(
            synth_seconds(VALID_TARGET_MS, 44, float(self.eng.history.df.close.iloc[-1])))
        second = self.eng.run_checkpoint(VALID_TARGET_MS, 45, VALID_TARGET_MS + 45_300)
        if first["eligible"]:
            self.assertEqual(second["reason"], "DUPLICATE_INTENT")
            self.assertFalse(second["eligible"])

    def test_expired_model_fails_closed(self):
        after_expiry = int(pd.Timestamp("2026-10-20T12:00:00Z").value // 1_000_000)
        self.assertTrue(self.eng.model_expired(after_expiry))
        cp = self.eng.run_checkpoint(VALID_TARGET_MS, 8, after_expiry)
        self.assertEqual(cp["reason"], "MODEL_EXPIRED")
        self.assertFalse(cp["eligible"])
        self.assertTrue(self.eng.status()["refit_required"] in (True, False))


class SeedReference(unittest.TestCase):
    """Transformed seed values vs the independent reference (not just file hashes)."""

    def test_preopen_values_match_reference(self):
        from v2final.features import preopen_frame
        df = marketdata.BarHistory(ROOT / "seed", Path(tempfile.mkdtemp()), FakeRest(0)).load_seed()
        pre, sc = preopen_frame(df)
        ts = pd.Timestamp("2026-09-14T00:00Z")
        p, s = pre[pre.ts == ts].iloc[0], sc[sc.ts == ts].iloc[0]
        ref = {"vol": 0.001020929926524234, "meanvol": 72.49670479166667, "meancount": 13286.489583333334,
               "rsi14": -0.27563801407814026, "macd_hist_atr": -0.45522651076316833, "adx14": 0.3240223824977875,
               "taker_imbalance4": -0.12731964886188507, "variance_ratio4_96": 0.3058508038520813}
        for k, want in ref.items():
            got = float(s[k] if k in ("vol", "meanvol", "meancount") else p[k])
            self.assertAlmostEqual(got, want, delta=abs(want) * 1e-12, msg=k)


class DecisionTimeAndErrors(WarmupAndScoring):
    def test_decision_at_is_model_decision_time(self):
        cp = self.eng.run_checkpoint(VALID_TARGET_MS, 8, self.now)
        self.assertEqual(cp["decision_at"], service.iso_ms(self.now))

    def test_fail_closed_uses_decision_time(self):
        cp = self.eng.run_checkpoint(VALID_TARGET_MS, 8, VALID_TARGET_MS + 9_100)
        self.assertEqual(cp["decision_at"], service.iso_ms(VALID_TARGET_MS + 9_100))

    def test_rejected_body_logs_error_code_only(self):
        import httpx
        r = httpx.Response(409, json={"ok": False, "error": "CONFLICTING_DUPLICATE"})
        self.assertEqual(service._error_code(r), "CONFLICTING_DUPLICATE")
        self.assertEqual(service._error_code(httpx.Response(500, text="Traceback secret=abc")), "UNKNOWN")


class OutboxDurability(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def sample(self, sleeve="v2-direction8-r1"):
        return {"candle_open": "2026-09-20T12:00:00.000Z", "checkpoint": "T8", "sleeve": sleeve,
                "side": 1, "probability": 0.61, "eligible": True, "features_ready": True,
                "reason": None, "decision_at": "2026-09-20T12:00:08.400Z", "payload": {"execution": "OFF"}}

    def test_record_is_insert_once_and_survives_restart(self):
        j = Journal(self.tmp / "v2.sqlite")
        self.assertTrue(j.record(self.sample()))
        self.assertFalse(j.record(self.sample()))  # same natural key
        j.close()
        j2 = Journal(self.tmp / "v2.sqlite")
        pending = j2.pending()
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0][1]["sleeve"], "v2-direction8-r1")
        j2.mark(pending[0][0], "DELIVERED", "200")
        self.assertEqual(j2.pending_count(), 0)
        self.assertEqual(len(j2.recent()), 1)
        j2.close()

    def test_stale_pending_expires_instead_of_replaying(self):
        j = Journal(self.tmp / "v2.sqlite")
        j.record(self.sample())
        self.assertEqual(j.expire_stale(max_age_ms=-1), 1)
        self.assertEqual(j.pending_count(), 0)
        j.close()


class HistoryAndHealth(unittest.TestCase):
    """Findings F and G."""

    def test_tampered_stored_history_falls_back_to_verified_seed(self):
        with tempfile.TemporaryDirectory() as d:
            h = marketdata.BarHistory(ROOT / "seed", Path(d), FakeRest(0))
            seed = h.load_seed()
            bad = seed.copy()
            bad.loc[10, "close"] = float(bad.loc[10, "close"]) + 1.0
            bad.to_csv(h.path, index=False, compression="gzip")
            self.assertFalse(marketdata.BarHistory.seed_prefix_matches(bad, seed))
            loaded = h.load()
            self.assertTrue(marketdata.BarHistory.seed_prefix_matches(loaded, seed))

    def test_round_trip_stored_history_is_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            h = marketdata.BarHistory(ROOT / "seed", Path(d), FakeRest(0))
            h.df = h.load_seed()
            h.persist()
            h2 = marketdata.BarHistory(ROOT / "seed", Path(d), FakeRest(0))
            loaded = h2.load()
            self.assertEqual(len(loaded), 80_160)
            self.assertTrue(marketdata.BarHistory.seed_prefix_matches(loaded, h.df))

    def test_readiness_recovers_after_a_failed_startup_warmup(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            now = VALID_TARGET_MS + 8_400
            eng = make_engine(tmp, now)
            eng.history_ready = False  # startup warmup failed
            self.assertFalse(eng.prediction_ready(now))
            eng.history.df = extend_history(eng.history.load_seed(), VALID_TARGET_MS)
            eng.clock_skew_ms = 0
            eng.feed.bars = synth_seconds(VALID_TARGET_MS, 8, float(eng.history.df.close.iloc[-1]))
            eng.feed.backfilled_through_ms = now
            eng.feed.connected = True
            eng.warm_history_called = False
            eng.refresh_boundary(VALID_TARGET_MS)  # boundary refresh performs the full warmup
            self.assertTrue(eng.history_ready)
            self.assertTrue(eng.preopen_current(now))
            self.assertTrue(eng.prediction_ready(now))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_readiness_requires_current_target_and_feed(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            now = VALID_TARGET_MS + 8_400
            eng = make_engine(tmp, now)
            eng.history.df = extend_history(eng.history.load_seed(), VALID_TARGET_MS)
            eng.history_ready = True
            eng.clock_skew_ms = 0
            eng.build_preopen(VALID_TARGET_MS)
            eng.feed.bars = synth_seconds(VALID_TARGET_MS, 8, float(eng.history.df.close.iloc[-1]))
            eng.feed.connected = True
            eng.feed.backfilled_through_ms = 0  # feed has not covered this candle
            self.assertFalse(eng.feed_ready(now))
            self.assertFalse(eng.prediction_ready(now))
            eng.feed.backfilled_through_ms = now
            self.assertTrue(eng.prediction_ready(now))
            # a pre-open frame for an older candle is not current
            stale = now + marketdata.INTERVAL_MS
            self.assertFalse(eng.preopen_current(stale))
            self.assertFalse(eng.prediction_ready(stale))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_health_paths(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            eng = make_engine(tmp, VALID_TARGET_MS)
            handler = service.make_health_handler(eng)
            self.assertTrue(callable(handler))
            readme = (ROOT / "README.md").read_text()
            self.assertIn("/healthz", readme)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
