import hashlib, json, shutil, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import promote  # noqa: E402

class PrepareRelease(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.cand = self.tmp / "cand"; shutil.copytree(promote.PACKAGE / "models" / "current", self.cand)
        m = json.loads((self.cand / "manifest.json").read_text())
        m["valid_from"], m["valid_until"] = "2026-10-12T00:00:00+00:00", "2026-11-09T00:00:00+00:00"
        for r in m["models"].values(): r["fit_end"] = m["valid_from"]; r["cal_last_settlement"] = "2026-10-11T23:45:00+00:00"
        self.m = m; self.write()
        self.before = hashlib.sha256((promote.PACKAGE / "CONTENT_HASHES.json").read_bytes()).hexdigest()
    def tearDown(self):
        shutil.rmtree(self.tmp)
        self.assertEqual(self.before, hashlib.sha256((promote.PACKAGE / "CONTENT_HASHES.json").read_bytes()).hexdigest())
    def write(self): (self.cand / "manifest.json").write_text(json.dumps(self.m))
    def bad(self, msg):
        with self.assertRaisesRegex(ValueError, msg): promote.prepare(self.cand, self.tmp / "out", load_models=False)
        self.assertFalse((self.tmp / "out").exists())

    def test_prepares_complete_verified_release(self):
        r = promote.prepare(self.cand, self.tmp / "out", load_models=False)
        out = Path(r["release_dir"]); spec = json.loads((out / "CONTENT_HASHES.json").read_text())
        for rel, h in spec["files"].items(): self.assertEqual(hashlib.sha256((out / rel).read_bytes()).hexdigest(), h)
        self.assertEqual(spec["files"]["models/current/manifest.json"], hashlib.sha256((self.cand / "manifest.json").read_bytes()).hexdigest())
    def test_requires_exactly_three_sleeves(self):
        del self.m["models"]["fade8"]; self.write(); self.bad("exactly three")
    def test_requires_four_week_utc_window(self):
        self.m["valid_until"] = "2026-11-10T00:00:00+00:00"; self.write(); self.bad("4 weeks")
    def test_rejects_non_utc(self):
        self.m["valid_from"] = "2026-10-12T00:00:00-06:00"; self.write(); self.bad("UTC")
    def test_rejects_feed_change(self):
        self.m["feed"] = "coinbase"; self.write(); self.bad("feed identity")
    def test_rejects_feature_order_change(self):
        f = self.m["models"]["direction8"]["features"]; f[0], f[1] = f[1], f[0]; self.write(); self.bad("feature order")
    def test_rejects_same_window(self):
        m = json.loads((promote.PACKAGE / "models/current/manifest.json").read_text()); (self.cand / "manifest.json").write_text(json.dumps(m)); self.bad("new window")
    def test_rejects_model_hash_mismatch(self):
        (self.cand / "fade8.joblib").write_bytes(b"x"); self.bad("sha256 mismatch")

if __name__ == "__main__": unittest.main()
