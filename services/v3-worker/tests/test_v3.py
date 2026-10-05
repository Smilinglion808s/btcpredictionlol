"""Offline V3 tests. No network: every outbound call is mocked."""
import gzip
import json
import math
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import httpx
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
import v3core as V  # noqa: E402
from net import Sender, parse_rest_kline, parse_ws_kline  # noqa: E402

M = V.M
SEED = json.loads(gzip.decompress((V.PACKAGE / "seed.json.gz").read_bytes()))
FIX = json.loads(gzip.decompress((V.PACKAGE / "replay_fixture.json.gz").read_bytes()))
END = SEED["through_exclusive_s"]  # 2026-10-05T00:00Z


class Clock:
    def __init__(self, ms): self.ms = ms
    def __call__(self): return self.ms


def bars(c, n=30, drift=1.0, taker=0.75, quote=100.0):
    out, p = [], 60000.0
    for i in range(n):
        o, cl = p, p + drift
        out.append({"open_ms": c * 1000 + i * 1000, "close_ms": c * 1000 + i * 1000 + 999, "is_final": True,
                    "open": o, "close": cl, "high": max(o, cl) + .5, "low": min(o, cl) - .5,
                    "quote_volume": quote, "taker_buy_quote_volume": quote * taker})
        p = cl
    return out


def kalshi_meta(c):
    close = c + V.SLOT
    return {"ticker": V.kalshi_ticker(c), "event_ticker": V.kalshi_ticker(c).rsplit("-", 1)[0],
            "close_time": V.iso_ms(close * 1000).replace(".000Z", "Z")}


def seeded(tmp, clock=None, **kw):
    e = V.Engine(V.Store(Path(tmp) / "v3.sqlite"), now_ms=clock, **kw)
    e.load_seed()
    return e


class Package(unittest.TestCase):
    def test_hashes_and_corrupt_seed(self):
        V.verify_package()
        with tempfile.TemporaryDirectory() as d:
            bad = Path(d) / "seed.json.gz"
            bad.write_bytes(b"not gzip")
            with self.assertRaises(V.FailClosed):
                V.Engine(V.Store(Path(d) / "a.sqlite")).load_seed(bad)
            pkg = Path(d) / "pkg"
            shutil.copytree(V.PACKAGE, pkg)
            (pkg / "model.py").write_text((pkg / "model.py").read_text() + "\n# edit")
            with self.assertRaises(V.FailClosed):
                V.verify_package(pkg)

    def test_seed_changed_after_load_fails(self):
        with tempfile.TemporaryDirectory() as d:
            e = seeded(d)
            other = Path(d) / "s.json.gz"
            other.write_bytes(gzip.compress(json.dumps(SEED).encode(), mtime=1))
            with self.assertRaises(V.FailClosed):
                e.load_seed(other)


class Parity(unittest.TestCase):
    def test_seed_rows_refit_reproduce_oct5_heads(self):
        stamps = [r["candle_s"] for r in SEED["rows"]]
        labels = [r["label"] for r in SEED["rows"]]
        for cp in (15, 30):
            x = [[np.nan if r[n] is None else r[n] for n in M.FEATURES[cp]] for r in SEED["rows"]]
            head = M.fit_head(stamps, x, labels, END, cp)
            ref = SEED["heads"][str(cp)]
            self.assertEqual(head["training_rows"], ref["training_rows"])
            np.testing.assert_allclose(head["coefficients"], ref["coefficients"], rtol=0, atol=1e-12)
            self.assertAlmostEqual(head["intercept"], ref["intercept"], places=12)

    def test_engine_replays_fixture_exactly(self):
        rows = FIX["rows"]
        first = rows[0]["candle_s"]
        with tempfile.TemporaryDirectory() as d:
            e = V.Engine(V.Store(Path(d) / "r.sqlite"))
            for cp in (15, 30):
                for h in FIX["heads"][str(cp)]:
                    e.s.q("INSERT INTO heads VALUES(?,?,?,?)", (cp, h["valid_from_s"], json.dumps(h), "fixture"))
                for h in FIX["initial_histories"][str(cp)]:
                    e.s.q("INSERT INTO hist(checkpoint,candle_s,confidence) VALUES(?,?,?)", (cp, h["candle_s"], h["confidence"]))
                e.s.set_meta(f"hist_wm_{cp}", first - V.SLOT)
            e.s.set_meta("seed_end_s", first)
            for r in rows:
                feats = dict(zip(M.FEATURES[30], r["heads"]["30"]["features"]))
                self.assertEqual(r["heads"]["15"]["features"], r["heads"]["30"]["features"][:5])
                e.s.q("INSERT INTO rows(candle_s,feats,s15,s30,src) VALUES(?,?,'valid','valid','fixture')",
                      (r["candle_s"], json.dumps(feats)))
            for cp in (15, 30):
                self.assertEqual(e.advance_history(cp), len(rows))
            sel_counts = {0: 0, 15: 0, 30: 0}
            for r in rows:
                got = {cp: e.hist_entry(cp, r["candle_s"]) for cp in (15, 30)}
                for cp in (15, 30):
                    self.assertEqual(got[cp]["probability"], r["heads"][str(cp)]["p"])
                    self.assertEqual(got[cp]["rank"], r["heads"][str(cp)]["rank"])
                sel = M.select(got[15], got[30])
                self.assertEqual(sel["checkpoint"] if sel else 0, r["expected_checkpoint"])
                self.assertEqual(sel["direction"] if sel else 0, r["expected_direction"])
                sel_counts[r["expected_checkpoint"]] += 1
            self.assertEqual(sel_counts, {0: 509, 15: 220, 30: 39})


class FeedFields(unittest.TestCase):
    def test_ws_and_rest_keep_actual_quote_fields(self):
        rest = [1000, "1", "2", "0.5", "1.5", "9", 1999, "123.4", 7, "4", "56.7", "0"]
        ws = {"t": 1000, "T": 1999, "o": "1", "h": "2", "l": "0.5", "c": "1.5", "v": "9", "q": "123.4",
              "Q": "56.7", "V": "4", "x": True}
        self.assertEqual(parse_rest_kline(rest), parse_ws_kline(ws))
        self.assertEqual(parse_ws_kline(ws)["taker_buy_quote_volume"], 56.7)
        self.assertFalse(parse_ws_kline({**ws, "x": False})["is_final"])

    def test_prefix_ignores_later_seconds(self):
        b = bars(END)
        x15 = M.prefix_features(b[:15], 15, END * 1000)
        b[20]["quote_volume"] = 1e9
        self.assertEqual(M.prefix_features(b[:15], 15, END * 1000), x15)
        self.assertEqual(M.prefix_features(b[:30], 30, END * 1000)[:5], x15)


class Identity(unittest.TestCase):
    def test_ticker_and_interval_key_match_stored_markets(self):
        # Real tickers stored by the V1.2 pipeline for these opens.
        for open_iso, ticker in [("2026-10-05T23:00:00Z", "KXBTC15M-26OCT051915-15"),
                                 ("2026-10-05T22:45:00Z", "KXBTC15M-26OCT051900-00"),
                                 ("2026-10-05T22:30:00Z", "KXBTC15M-26OCT051845-45")]:
            from datetime import datetime
            c = int(datetime.fromisoformat(open_iso.replace("Z", "+00:00")).timestamp())
            self.assertEqual(V.kalshi_ticker(c), ticker)
            self.assertEqual(V.interval_key(c), f"v12:{ticker}:{open_iso[:-1]}.000Z")

    def test_forbidden_destinations(self):
        for u in ["https://x.supabase.co/functions/v1/v12-v1", "https://x.supabase.co/functions/v1/v12-u",
                  "https://x.supabase.co/functions/v1/v2-bet-signal/api/public/hooks/v2-bet-signal",
                  "https://x.supabase.co/functions/v1/place-trade", "http://insecure.example/v3"]:
            self.assertFalse(V.url_allowed(u), u)
            with self.assertRaises(ValueError):
                Sender(u, b"k")
        self.assertTrue(V.url_allowed("https://bettor.example/functions/v1/v3-signal"))


class Live(unittest.TestCase):
    def run_cp(self, e, clock, c, cp, b, offset_ms=200, **kw):
        clock.ms = (c + cp) * 1000 + offset_ms
        return e.checkpoint(c, cp, b[:cp] if b is not None else [], **kw)

    def test_t15_select_t30_history_still_advances(self):
        with tempfile.TemporaryDirectory() as d:
            clock = Clock(0)
            e = seeded(d, clock)
            c = END
            r15 = self.run_cp(e, clock, c, 15, bars(c, drift=40, taker=.99))
            self.assertIn(r15["status"], ("SELECTED", "AWAIT_T30"))
            r30 = self.run_cp(e, clock, c, 30, bars(c, drift=40, taker=.99))
            self.assertIsNotNone(e.hist_entry(15, c))
            self.assertIsNotNone(e.hist_entry(30, c))
            if r15["status"] == "SELECTED":
                self.assertEqual(r30["status"], "HISTORY_ONLY")
            self.assertEqual(self.run_cp(e, clock, c, 30, bars(c))["status"], "DUPLICATE")

    def test_strong_move_selects_t15_and_freezes(self):
        with tempfile.TemporaryDirectory() as d:
            clock = Clock(0)
            e = seeded(d, clock)
            c = END
            r = self.run_cp(e, clock, c, 15, bars(c, drift=-60, taker=.02))
            self.assertEqual(r, {"status": "SELECTED", "checkpoint": 15, "direction": -1})
            self.run_cp(e, clock, c, 30, bars(c, drift=60, taker=.98))
            self.assertEqual(e._decision(c), ("SELECTED", 15, -1))

    def test_late_or_missing_t15_fails_closed_no_t30_fallback(self):
        with tempfile.TemporaryDirectory() as d:
            clock = Clock(0)
            e = seeded(d, clock)
            c = END
            r = self.run_cp(e, clock, c, 15, bars(c)[:14] + [], offset_ms=300)
            self.assertEqual(r["status"], "FAIL_CLOSED")
            self.assertTrue(r["reason"].startswith("MISSING_SECONDS"))
            r30 = self.run_cp(e, clock, c, 30, bars(c, drift=-60, taker=.02))
            self.assertEqual(r30["status"], "HISTORY_ONLY")
            self.assertEqual(e._decision(c)[0], "FAIL_CLOSED")
        with tempfile.TemporaryDirectory() as d:
            clock = Clock(0)
            e = seeded(d, clock)
            self.assertEqual(self.run_cp(e, clock, END, 15, bars(END), offset_ms=1001)["reason"], "CHECKPOINT_LATE")

    def test_t30_without_t15_attempt_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            clock = Clock(0)
            e = seeded(d, clock)
            self.run_cp(e, clock, END, 30, bars(END, drift=-60, taker=.02))
            self.assertEqual(e._decision(END)[:1], ("FAIL_CLOSED",))
            self.assertEqual(e.s.q("SELECT reason FROM decisions")[0][0], "T15_NOT_ATTEMPTED")

    def test_data_invalid_t15_lets_t30_qualify(self):
        with tempfile.TemporaryDirectory() as d:
            clock = Clock(0)
            e = seeded(d, clock)
            b = bars(END, drift=-60, taker=.02)
            for i in range(5):
                b[i]["quote_volume"] = 0.0
                b[i]["taker_buy_quote_volume"] = 0.0
            r15 = self.run_cp(e, clock, END, 15, b)
            self.assertEqual(r15["status"], "AWAIT_T30")
            self.assertIsNone(e.hist_entry(15, END))
            self.assertEqual(int(e.s.meta("hist_wm_15")), END)

    def test_stale_feed_clock_and_gap(self):
        with tempfile.TemporaryDirectory() as d:
            clock = Clock(0)
            e = seeded(d, clock)
            self.assertEqual(self.run_cp(e, clock, END, 15, bars(END), feed_ok=False)["reason"], "FEED_STALE")
            c2 = END + 2 * V.SLOT  # previous candle never resolved
            self.assertEqual(self.run_cp(e, clock, c2, 15, bars(c2))["reason"], "CATCHUP_GAP")
            c3 = END + 3 * V.SLOT
            self.assertEqual(self.run_cp(e, clock, c3, 15, bars(c3), clock_ok=False)["reason"], "CLOCK_SKEW")

    def test_fit_expiry_next_day(self):
        with tempfile.TemporaryDirectory() as d:
            clock = Clock(0)
            e = seeded(d, clock)
            nxt = END + V.DAY
            e.s.set_meta("hist_wm_15", nxt - V.SLOT)
            self.assertEqual(self.run_cp(e, clock, nxt, 15, bars(nxt))["reason"], "FIT_EXPIRED")

    def test_rank_ties_and_minimum(self):
        self.assertIsNone(M.rank_before_append(.9, [.1] * 191))
        self.assertEqual(M.rank_before_append(.7, [.1] * 192), 1.0)
        self.assertEqual(M.rank_before_append(.75, [.25] * 192), 1.0)  # ties count as <=
        self.assertEqual(M.rank_before_append(.7, [.3] * 384 + [.1] * 384), 0.5)
        self.assertEqual(M.rank_before_append(.7, [.3] * 1000 + [.1] * 768), 1.0)  # last 768 only


class DailyRefit(unittest.TestCase):
    def test_refit_waits_for_closed_labels_and_respects_cutoff(self):
        with tempfile.TemporaryDirectory() as d:
            clock = Clock(0)
            e = seeded(d, clock)
            rng = np.random.default_rng(1)
            day = END + V.DAY
            self.assertFalse(e.ensure_fit(day))
            for i in range(96):
                c = END + i * V.SLOT
                e.apply_backfill(c, bars(c, drift=float(rng.normal(0, 3)), taker=float(rng.uniform(.2, .8))), final=True)
            self.assertFalse(e.ensure_fit(day))  # features but no labels yet
            e.apply_labels({END + i * V.SLOT: int(rng.choice([-1, 1])) for i in range(95)})
            self.assertFalse(e.ensure_fit(day))  # last label (closes at midnight) missing
            e.apply_labels({END + 95 * V.SLOT: 1, day: -1})  # day's own candle must never enter
            out = e.catchup_step(day + 60)
            self.assertEqual(out["fitted"], [day])
            for cp in (15, 30):
                h = e.head(cp, day)
                self.assertEqual(h["valid_until_s"], day + V.DAY)
                self.assertLessEqual(h["training_last_s"] + V.SLOT, day)
                self.assertGreaterEqual(h["training_first_s"], day - V.WINDOW_SLOTS * V.SLOT)
            self.assertEqual(int(e.s.meta("hist_wm_15")), END + 95 * V.SLOT)
            first = e.hist_entry(15, END)
            self.assertEqual(first["fit_day_s"], END)  # each day's own fit

    def test_backfill_retains_pending_until_final(self):
        with tempfile.TemporaryDirectory() as d:
            e = seeded(d)
            e.apply_backfill(END, bars(END)[:20], final=False)
            self.assertEqual(e.s.q("SELECT s15,s30 FROM rows WHERE candle_s=?", (END,))[0], ("valid", "pending"))
            e.apply_backfill(END, bars(END)[:20], final=True)
            self.assertTrue(e.s.q("SELECT s30 FROM rows WHERE candle_s=?", (END,))[0][0].startswith("invalid"))


class Outbox(unittest.TestCase):
    def selected(self, d, enabled):
        clock = Clock(0)
        e = seeded(d, clock, delivery_enabled=enabled)
        clock.ms = (END + 15) * 1000 + 200
        self.assertEqual(e.checkpoint(END, 15, bars(END, drift=-60, taker=.02)[:15])["status"], "SELECTED")
        e.record_markets([kalshi_meta(END)], V.KALSHI_SERIES)
        return e, clock

    def test_disabled_captures_but_never_delivers(self):
        with tempfile.TemporaryDirectory() as d:
            e, clock = self.selected(d, False)
            clock.ms = END * 1000 + 48_010
            e.prepare_due()
            self.assertEqual(e.s.q("SELECT status FROM outbox")[0][0], "DISABLED")
            self.assertEqual(e.deliverable(), [])

    def test_exact_bytes_hmac_retry_expiry_and_restart(self):
        with tempfile.TemporaryDirectory() as d:
            e, clock = self.selected(d, True)
            clock.ms = END * 1000 + 47_999
            self.assertEqual(e.prepare_due(), [])
            clock.ms = END * 1000 + 48_005
            [eid] = e.prepare_due()
            (eid2, raw), = e.deliverable()
            body = json.loads(raw)
            self.assertEqual(eid, eid2)
            self.assertEqual(body["event_id"], f"{body['interval_key']}:V3")
            self.assertEqual(body["model_version"], "v3-pf-e008-r1")
            self.assertEqual((body["prediction"], body["checkpoint_seconds"], body["mode"]), ("NO", 15, "shadow"))
            self.assertEqual(body["entry_at"], "2026-10-05T00:00:48.000Z")
            self.assertEqual(body["expires_at"], "2026-10-05T00:00:49.000Z")
            for k in ("stake", "size", "limit_price", "max_price", "maker", "taker", "probability"):
                self.assertNotIn(k, body)
            seen = []

            def handler(req):
                seen.append((req.content, req.headers["x-btc15m-signature"]))
                return httpx.Response(503 if len(seen) == 1 else 200)

            s = Sender("https://bettor.example/v3", b"secret", httpx.Client(transport=httpx.MockTransport(handler)))
            self.assertEqual(e.record_attempt(eid, *s.post(eid, raw)), "RETRY")
            clock.ms += 100
            # restart: a new engine on the same store never rebuilds the body
            e2 = V.Engine(e.s, now_ms=clock, delivery_enabled=True)
            e2.load_seed()
            self.assertEqual(e2.prepare_due(), [])
            (_, raw2), = e2.deliverable()
            self.assertEqual(raw2, raw)
            self.assertEqual(e2.record_attempt(eid, *s.post(eid, raw2)), "DELIVERED")
            self.assertEqual(seen[0], seen[1])
            self.assertEqual(seen[0][1], V.sign(b"secret", raw))
            self.assertEqual(e2.deliverable(), [])

    def test_expired_at_t49_and_late_restart(self):
        with tempfile.TemporaryDirectory() as d:
            e, clock = self.selected(d, True)
            clock.ms = END * 1000 + 49_000
            self.assertEqual(e.prepare_due(), [])
            self.assertEqual(e._decision(END)[0], "EXPIRED_UNSENT")
        with tempfile.TemporaryDirectory() as d:
            e, clock = self.selected(d, True)
            clock.ms = END * 1000 + 48_100
            e.prepare_due()
            clock.ms = END * 1000 + 49_000
            e.prepare_due()
            self.assertEqual(e.s.q("SELECT status FROM outbox")[0][0], "EXPIRED")
            self.assertEqual(e.deliverable(), [])

    def test_rejections_redirects_and_duplicate_events(self):
        with tempfile.TemporaryDirectory() as d:
            e, clock = self.selected(d, True)
            clock.ms = END * 1000 + 48_001
            [eid] = e.prepare_due()
            self.assertEqual(e.prepare_due(), [])  # one event per candle
            s = Sender("https://bettor.example/v3", b"k", httpx.Client(transport=httpx.MockTransport(
                lambda r: httpx.Response(302, headers={"location": "https://elsewhere"}))))
            self.assertEqual(s.post(eid, b"{}"), (400, "REDIRECT_BLOCKED"))
            self.assertEqual(e.record_attempt(eid, 400, "REDIRECT_BLOCKED"), "REJECTED")
            self.assertEqual(e.deliverable(), [])

    def test_transport_error_is_not_delivered(self):
        def boom(req):
            raise httpx.ReadTimeout("t", request=req)
        s = Sender("https://bettor.example/v3", b"k", httpx.Client(transport=httpx.MockTransport(boom)))
        self.assertEqual(s.post("e", b"{}"), (None, "ReadTimeout"))


# ------------------------------------------------------------- review regressions (ae7420a)
import threading  # noqa: E402
from unittest import mock  # noqa: E402


def fill_day(e, rng, with_backfill=True, with_labels=True):
    for i in range(96):
        c = END + i * V.SLOT
        if with_backfill:
            e.apply_backfill(c, bars(c, drift=float(rng.normal(0, 3)), taker=float(rng.uniform(.2, .8))), final=True)
    if with_labels:
        e.apply_labels({END + i * V.SLOT: int(rng.choice([-1, 1])) for i in range(96)})


class ReviewFixes(unittest.TestCase):
    def test_1_labels_without_features_do_not_fit(self):
        with tempfile.TemporaryDirectory() as d:
            e = seeded(d, Clock(0))
            fill_day(e, np.random.default_rng(2), with_backfill=False)
            self.assertFalse(e.ensure_fit(END + V.DAY))
            self.assertEqual(e.catchup_step(END + V.DAY + 60)["fitted"], [])
            self.assertIsNone(e.head(15, END + V.DAY))
            # a single pending head anywhere in the window still blocks
            e.apply_backfill(END, bars(END)[:20], final=False)  # s15 valid, s30 pending
            for i in range(1, 96):
                c = END + i * V.SLOT
                e.apply_backfill(c, bars(c), final=True)
            self.assertFalse(e.ensure_fit(END + V.DAY))
            e.apply_backfill(END, bars(END)[:20], final=True)  # finalised data-invalid is terminal
            self.assertTrue(e.ensure_fit(END + V.DAY))

    def test_2_partial_daily_fit_recovers_after_restart(self):
        with tempfile.TemporaryDirectory() as d:
            e = seeded(d, Clock(0))
            fill_day(e, np.random.default_rng(3))
            real = M.fit_head
            day = END + V.DAY

            def flaky(stamps, x, labels, day_s, cp):
                if cp == 30:
                    raise ValueError("injected_t30")
                return real(stamps, x, labels, day_s, cp)
            with mock.patch.object(M, "fit_head", flaky):
                out = e.catchup_step(day + 60)
            self.assertEqual(out["fitted"], [])
            self.assertIsNone(e.head(15, day))  # atomic: no half-persisted day
            self.assertIn("injected_t30", e.faults["fit"])
            # legacy partial state (one head persisted) is retried too
            e.s.q("INSERT INTO heads VALUES(15,?,?,'refit')", (day, json.dumps(e.head(15, END) | {"valid_from_s": day})))
            e2 = V.Engine(e.s, now_ms=Clock(0))  # restart on same store
            e2.faults = dict(e.faults)
            out = e2.catchup_step(day + 120)
            self.assertEqual(out["fitted"], [day])
            self.assertIsNotNone(e2.head(30, day))
            self.assertNotIn("fit", e2.faults)
            self.assertEqual(e2.first_unfitted_day(), day + V.DAY)

    def test_3_concurrent_history_advance_no_duplicate(self):
        with tempfile.TemporaryDirectory() as d:
            e = seeded(d, Clock(0))
            e.apply_backfill(END, bars(END), True)
            barrier, real, errs = threading.Barrier(2), V.predict_exact, []

            def slow(head, x, c):
                try:
                    barrier.wait(timeout=0.5)  # would align both threads if they could both read the watermark
                except threading.BrokenBarrierError:
                    pass
                return real(head, x, c)

            def run():
                try:
                    e.advance_history(15, END)
                except Exception as ex:  # noqa: BLE001
                    errs.append(ex)
            with mock.patch.object(V, "predict_exact", slow):
                ts = [threading.Thread(target=run) for _ in range(2)]
                [t.start() for t in ts]
                [t.join() for t in ts]
            self.assertEqual(errs, [])
            self.assertEqual(e.s.q("SELECT COUNT(*) FROM hist WHERE checkpoint=15 AND candle_s=?", (END,))[0][0], 1)
            self.assertEqual(int(e.s.meta("hist_wm_15")), END)

    def test_3_concurrent_catchup_and_live_scoring_exactly_once(self):
        for _ in range(5):
            with tempfile.TemporaryDirectory() as d:
                clock = Clock((END + 15) * 1000 + 200)
                e = seeded(d, clock)
                stop, errs = threading.Event(), []

                def bg():
                    while not stop.is_set():
                        try:
                            e.catchup_step(END + 60)
                        except Exception as ex:  # noqa: BLE001
                            errs.append(ex)
                t = threading.Thread(target=bg)
                t.start()
                r = e.checkpoint(END, 15, bars(END, drift=-60, taker=.02)[:15])
                stop.set()
                t.join()
                self.assertEqual(errs, [])
                self.assertEqual(r["status"], "SELECTED")
                self.assertEqual(e._decision(END), ("SELECTED", 15, -1))
                self.assertEqual(e.s.q("SELECT COUNT(*) FROM hist WHERE checkpoint=15 AND candle_s=?", (END,))[0][0], 1)

    def test_3_crash_between_history_and_decision_rolls_back(self):
        with tempfile.TemporaryDirectory() as d:
            clock = Clock((END + 15) * 1000 + 200)
            e = seeded(d, clock)
            with mock.patch.object(V.Engine, "_set_decision", side_effect=RuntimeError("crash")):
                with self.assertRaises(RuntimeError):
                    e.checkpoint(END, 15, bars(END, drift=-60, taker=.02)[:15])
            self.assertIsNone(e.hist_entry(15, END))
            self.assertEqual(int(e.s.meta("hist_wm_15")), END - V.SLOT)
            self.assertEqual(e.s.q("SELECT COUNT(*) FROM rows WHERE candle_s=?", (END,))[0][0], 0)
            e2 = V.Engine(e.s, now_ms=clock)  # restart
            self.assertEqual(e2.checkpoint(END, 15, bars(END, drift=-60, taker=.02)[:15])["status"], "SELECTED")
            self.assertEqual(e2.s.q("SELECT COUNT(*) FROM hist WHERE checkpoint=15")[0][0], 769)

    def test_4_no_verified_market_means_no_send(self):
        with tempfile.TemporaryDirectory() as d:
            clock = Clock((END + 15) * 1000 + 200)
            e = seeded(d, clock, delivery_enabled=True)
            self.assertEqual(e.checkpoint(END, 15, bars(END, drift=-60, taker=.02)[:15])["status"], "SELECTED")
            clock.ms = END * 1000 + 48_010
            self.assertEqual(e.prepare_due(), [])
            # wrong series / mismatched ticker / non-boundary close are all rejected
            self.assertEqual(e.record_markets([kalshi_meta(END)], "KXBTCD"), 0)
            bad = kalshi_meta(END) | {"ticker": "KXBTC15M-26OCT042030-30"}
            self.assertEqual(e.record_markets([bad], V.KALSHI_SERIES), 0)
            self.assertEqual(e.record_markets([kalshi_meta(END) | {"close_time": "2026-10-05T00:15:07Z"}],
                                              V.KALSHI_SERIES), 0)
            self.assertEqual(e.prepare_due(), [])
            clock.ms = END * 1000 + 49_000
            e.prepare_due()
            self.assertEqual(e._decision(END)[0], "EXPIRED_UNSENT")
            self.assertIn("NO_VERIFIED_MARKET", e.s.q("SELECT audit FROM decisions")[0][0])
            self.assertEqual(e.s.q("SELECT COUNT(*) FROM outbox")[0][0], 0)

    def test_4_verified_market_used_and_key_format_unchanged(self):
        with tempfile.TemporaryDirectory() as d:
            clock = Clock((END + 15) * 1000 + 200)
            e = seeded(d, clock)
            e.checkpoint(END, 15, bars(END, drift=-60, taker=.02)[:15])
            e.record_markets([kalshi_meta(END)], V.KALSHI_SERIES)
            clock.ms = END * 1000 + 48_010
            e.prepare_due()
            body = json.loads(e.s.q("SELECT body FROM outbox")[0][0])
            self.assertEqual(body["market"], V.kalshi_ticker(END))
            self.assertEqual(body["interval_key"], f"v12:{V.kalshi_ticker(END)}:2026-10-05T00:00:00.000Z")

    def test_5_health_with_invalid_package_and_no_seed(self):
        import service
        with tempfile.TemporaryDirectory() as d, mock.patch.dict("os.environ", {"V3_DATA_DIR": d}), \
                mock.patch.object(service, "verify_package", side_effect=V.FailClosed("PACKAGE_MANIFEST_INVALID")):
            rt = service.Runtime()
            h = rt.health()
            self.assertFalse(h["prediction_ready"])
            self.assertIn("PACKAGE_INVALID", h["not_ready_reasons"])
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "SHA256.json").write_text("{not json")
            with self.assertRaises(V.FailClosed) as cm:
                V.verify_package(Path(d))
            self.assertEqual(str(cm.exception), "PACKAGE_MANIFEST_INVALID")
            (Path(d) / "SHA256.json").unlink()
            with self.assertRaises(V.FailClosed):
                V.verify_package(Path(d))

    def test_7_expiry_rechecked_before_post_and_timeout_capped(self):
        calls = []

        def handler(req):
            calls.append(req.extensions.get("timeout"))
            return httpx.Response(200)
        clock = Clock(END * 1000 + 48_900)
        s = Sender("https://bettor.example/v3", b"k", httpx.Client(transport=httpx.MockTransport(handler)), now_ms=clock)
        exp = END * 1000 + 49_000
        self.assertEqual(s.post("e", b"{}", exp), (200, None))
        self.assertLessEqual(calls[0]["read"], 0.1 + 1e-9)
        clock.ms = exp
        self.assertEqual(s.post("e", b"{}", exp), (None, "EXPIRED_BEFORE_SEND"))
        self.assertEqual(len(calls), 1)
        with tempfile.TemporaryDirectory() as d:
            e, c2 = Outbox().selected(d, True)
            c2.ms = END * 1000 + 48_100
            [eid] = e.prepare_due()
            listed = e.deliverable()  # fetched before T49
            c2.ms = exp + 5
            s2 = Sender("https://bettor.example/v3", b"k", httpx.Client(transport=httpx.MockTransport(handler)), now_ms=c2)
            for ev, raw in listed:
                self.assertEqual(e.record_attempt(ev, *s2.post(ev, raw, e.expires_ms(ev))), "EXPIRED")
            self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
