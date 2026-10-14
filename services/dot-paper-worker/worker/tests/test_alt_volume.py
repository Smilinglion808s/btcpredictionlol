import os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from worker import bootstrap as b, altcoin as a


class AltVolumeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.p = Path(self.tmp.name)
        self.ids = dict(root_uid=os.getuid(), uid=os.getuid(), gid=os.getgid())
    def tearDown(self): self.tmp.cleanup()
    def init(self, alt=True): b.prepare_volume(self.p, alt=alt, **self.ids)

    def test_disabled_creates_nothing(self):
        self.init(alt=False); self.assertFalse((self.p / b.ALT_DIR).exists())
    def test_enabled_creates_private_child_and_restarts(self):
        self.init(); d = self.p / b.ALT_DIR
        self.assertEqual(d.stat().st_mode & 0o777, 0o700)
        (d / 'SOLUSDT.jsonl').touch(mode=0o600); self.init(); self.init(alt=False)
    def test_hostile_dir_symlink_refused(self):
        self.init(alt=False); (self.p / b.ALT_DIR).symlink_to('/tmp', target_is_directory=True)
        with self.assertRaises(b.BootstrapError): self.init()
    def test_hostile_file_symlink_refused(self):
        self.init(); (self.p / b.ALT_DIR / 'SOLUSDT.jsonl').symlink_to('/etc/passwd')
        with self.assertRaises(b.BootstrapError): self.init()
    def test_unexpected_file_refused(self):
        self.init(); (self.p / b.ALT_DIR / '../x').resolve()
        (self.p / b.ALT_DIR / 'evil.sh').touch(mode=0o600)
        with self.assertRaises(b.BootstrapError): self.init()
    def test_world_readable_or_wrong_mode_refused(self):
        self.init(); (self.p / b.ALT_DIR / 'DOGEUSDT.jsonl').touch(mode=0o644)
        with self.assertRaises(b.BootstrapError): self.init()
        (self.p / b.ALT_DIR / 'DOGEUSDT.jsonl').unlink(); (self.p / b.ALT_DIR).chmod(0o755)
        with self.assertRaises(b.BootstrapError): self.init()
    def test_ledger_rules_unchanged(self):
        self.init(); (self.p / 'other').mkdir()
        with self.assertRaises(b.BootstrapError): self.init()
        (self.p / 'other').rmdir(); (self.p / 'ledger' / 'SOLUSDT.jsonl').touch(mode=0o600)
        with self.assertRaises(b.BootstrapError): self.init()

    def test_recorder_fails_closed(self):
        d = self.p / 'logs'; d.mkdir(); (d / 'notes.txt').touch()
        with self.assertRaises(ValueError): a.Recorder(d)
        link = self.p / 'link'; link.symlink_to(self.p, target_is_directory=True)
        with self.assertRaises(ValueError): a.Recorder(link)
        e = self.p / 'e'; e.mkdir(); r = a.Recorder(e)
        (e / 'SOLUSDT.jsonl').symlink_to('/etc/passwd')
        from worker.tests.test_altcoin import bt
        with self.assertRaises(ValueError): r.write(a.parse(bt(), 1000))
    def test_default_dir_only_when_enabled(self):
        with patch.dict(os.environ, {}, clear=True): self.assertIsNone(a.default_dir())
        with patch.dict(os.environ, {'DOT_ALT_ENABLED': 'true'}, clear=True):
            self.assertEqual(a.default_dir(), '/data/dot-paper/altcoin-logs')

if __name__ == '__main__': unittest.main()
