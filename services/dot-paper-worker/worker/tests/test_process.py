"""Production-default EMPTY process smoke test. No fixture market input."""
import json,os,socket,subprocess,sys,tempfile,time,unittest,urllib.request,urllib.error
from pathlib import Path

class ProcessTest(unittest.TestCase):
    def test_empty_default_process_restart_no_market_network(self):
        with tempfile.TemporaryDirectory(prefix='dot-paper-empty-smoke-') as directory:
            s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
            env=dict(os.environ,PORT=str(port),DOT_PAPER_DATA_DIR=directory,DOT_PAPER_BIND='127.0.0.1',DOT_PAPER_FEED_ENABLED='false',DOT_PAPER_FEED_RIGHTS_APPROVED='false',DOT_PAPER_CONTROLS_ENABLED='false')
            run=None
            for _ in range(2):
                p=subprocess.Popen([sys.executable,'-m','worker.main'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
                try:
                    for n in range(100):
                        try:
                            with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=1) as r:health=json.load(r)
                            break
                        except Exception:
                            if p.poll() is not None:self.fail(p.stderr.read().decode())
                            time.sleep(.05)
                    else:self.fail('HTTP process did not start')
                    self.assertFalse(health['live_feed_enabled']);self.assertFalse(health['real_orders_supported'])
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/v1/snapshot') as r:body=json.load(r)
                    self.assertEqual(body['provenance'],'FORWARD');self.assertEqual(body['state'],'EMPTY')
                    self.assertEqual(body['trades']['items'],[]);self.assertEqual(body['calls']['items'],[]);self.assertEqual(body['equity']['items'],[])
                    self.assertIsNone(body['account']['equity_micros']);self.assertIsNone(body['feed']['bid_micros'])
                    if run:self.assertEqual(body['run_id'],run)
                    run=body['run_id']
                    rss=int(Path(f'/proc/{p.pid}/status').read_text().split('VmRSS:')[1].split()[0])
                    print(f'EMPTY PROCESS RSS: {rss} KiB')
                finally:
                    p.terminate();p.wait(timeout=5);p.stderr.close()

if __name__=='__main__':unittest.main()
