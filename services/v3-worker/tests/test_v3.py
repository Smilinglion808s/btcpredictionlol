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


if __name__ == "__main__":
    unittest.main()
