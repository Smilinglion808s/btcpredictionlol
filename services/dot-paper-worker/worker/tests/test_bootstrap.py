"""No real elevation/mount/UID transition occurs in these tests."""
import json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,call
from worker import bootstrap as b

class BootstrapTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dot-bootstrap-TEST-');self.path=Path(self.tmp.name)
        self.uid=os.getuid();self.gid=os.getgid()
    def tearDown(self):self.tmp.cleanup()
    def init(self):b.prepare_volume(self.path,root_uid=self.uid,uid=self.uid,gid=self.gid)
    def test_new_child_and_marker_only_then_restart(self):
        self.init();self.assertEqual(set(p.name for p in self.path.iterdir()),{'ledger',b.MARKER})
        self.assertEqual((self.path/'ledger').stat().st_mode&0o777,0o700)
        self.assertEqual(json.loads((self.path/b.MARKER).read_text()),b.IDENTITY);self.init()
    def test_refuse_foreign_mount_contents(self):
        (self.path/'legacy.sqlite3').write_text('do not touch')
        with self.assertRaises(b.BootstrapError):self.init()
        self.assertEqual((self.path/'legacy.sqlite3').read_text(),'do not touch')
    def test_refuse_mount_symlink(self):
        link=self.path/'link';link.symlink_to(self.path,target_is_directory=True)
        with self.assertRaises(OSError):b.prepare_volume(link,root_uid=self.uid,uid=self.uid,gid=self.gid)
    def test_refuse_child_symlink_no_follow(self):
        (self.path/'ledger').symlink_to('/tmp',target_is_directory=True)
        with self.assertRaises(OSError):self.init()
    def test_refuse_marker_symlink_no_follow(self):
        (self.path/b.MARKER).symlink_to('/etc/passwd')
        with self.assertRaises(OSError):self.init()
    def test_refuse_existing_child_wrong_permissions(self):
        (self.path/'ledger').mkdir(mode=0o755)
        with self.assertRaises(b.BootstrapError):self.init()
    def test_refuse_existing_unmarked_data(self):
        (self.path/'ledger').mkdir(mode=0o700);(self.path/'ledger'/'paper.sqlite3').touch(mode=0o600)
        with self.assertRaises(b.BootstrapError):self.init()
    def test_refuse_wrong_marker(self):
        self.init();(self.path/b.MARKER).write_text('{"service":"other"}')
        with self.assertRaises(b.BootstrapError):self.init()
    def test_refuse_ledger_link_and_world_readable_file(self):
        self.init();p=self.path/'ledger'/'paper.sqlite3';p.symlink_to('/etc/passwd')
        with self.assertRaises(b.BootstrapError):self.init()
        p.unlink();p.touch(mode=0o644)
        with self.assertRaises(b.BootstrapError):self.init()
    def test_wrong_root_or_child_owner_refused_without_chown(self):
        with self.assertRaises(b.BootstrapError):b.prepare_volume(self.path,root_uid=self.uid+1,uid=self.uid,gid=self.gid)
        (self.path/'ledger').mkdir(mode=0o700)
        with patch('worker.bootstrap.os.fchown') as chown:
            with self.assertRaises(b.BootstrapError):b.prepare_volume(self.path,root_uid=self.uid,uid=self.uid+1,gid=self.gid)
            chown.assert_not_called()
    def test_target_env_rejected_before_any_filesystem(self):
        with patch('worker.bootstrap.Path.lstat') as st:
            with self.assertRaises(b.BootstrapError):b.verify_runtime({})
            st.assert_not_called()
    def test_drop_identity_order_and_saved_ids(self):
        seen=[]
        with patch.object(b,'no_new_privileges',side_effect=lambda:seen.append('nnp')),patch.object(b.os,'setgroups',side_effect=lambda x:seen.append(('groups',x))),patch.object(b.os,'setgid',side_effect=lambda x:seen.append(('gid',x))),patch.object(b.os,'setuid',side_effect=lambda x:seen.append(('uid',x))),patch.object(b.os,'getresuid',return_value=(10001,)*3),patch.object(b.os,'getresgid',return_value=(10001,)*3),patch.object(b.os,'getgroups',return_value=[]):
            b.drop_identity()
        self.assertEqual(seen,['nnp',('groups',[]),('gid',10001),('uid',10001)])
    def test_failed_identity_drop_refuses(self):
        with patch.object(b,'no_new_privileges'),patch.object(b.os,'setgroups'),patch.object(b.os,'setgid'),patch.object(b.os,'setuid'),patch.object(b.os,'getresuid',return_value=(0,0,0)):
            with self.assertRaises(b.BootstrapError):b.drop_identity()

if __name__=='__main__':unittest.main()
