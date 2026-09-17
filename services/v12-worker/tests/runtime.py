import sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from capture import Capture
from service import payload,score_checkpoint,Service,Adapter,BACKEND_ADAPTER,WEBSITE_ADAPTER

class RuntimeTests(unittest.TestCase):
    def test_adapter_destinations_are_exact_and_owner_controlled(self):
        for url in (BACKEND_ADAPTER,WEBSITE_ADAPTER):
            with patch.dict('os.environ',{'V12_SHADOW_ADAPTER_URL':url}):self.assertEqual(Adapter().url,url)
        for url in ('https://other.invalid/api/public/hooks/v12-shadow',BACKEND_ADAPTER+'?redirect=other',BACKEND_ADAPTER+'/'):
            with patch.dict('os.environ',{'V12_SHADOW_ADAPTER_URL':url}):self.assertRaisesRegex(ValueError,'INVALID_RECORDING_ADAPTER_URL',Adapter)
    def test_quotes_cannot_backfill_or_cross_the_boundary(self):
        with tempfile.TemporaryDirectory() as d:
            c=Capture(str(Path(d)/'capture.sqlite'))
            c.db.executemany('insert into quotes values(?,?,?,?)',[('M',1000,.5,.52),('M',3001,.6,.62)]);c.db.commit()
            self.assertEqual(c.boundary_quote('M',3000),(1000,.5,.52))
            self.assertRaises(ValueError,c.boundary_quote,'M',6000)
            self.assertRaises(ValueError,c.boundary_quote,'M',999)
    def test_complete_bars_keep_first_receipt_and_mask_late_data(self):
        with tempfile.TemporaryDirectory() as d:
            c=Capture(str(Path(d)/'capture.sqlite'))
            bar=[0,'1','1','1','1','10',59999,'10',1,'5','5',0]
            with patch('capture.get',return_value=[bar]),patch('capture.time.time',return_value=61):c.fetch_bars('spot',0,60000)
            with patch('capture.get',return_value=[bar]),patch('capture.time.time',return_value=70):c.fetch_bars('spot',0,60000)
            self.assertEqual(len(c.frame('spot',0,60000,61000)),1)
            self.assertEqual(len(c.frame('spot',0,60000,60999)),0)
    def test_distinct_models_share_one_interval_identity(self):
        context={'open':'2026-09-17T19:00:00Z','ticker':'KXBTC15M-26SEP171515-15'}
        with patch('service.millis',return_value=1789671721000):
            requests=[payload(k,context,1789671720000) for k in ('V1','T45R2','U')]
        self.assertEqual(len({p['model_version'] for p in requests}),3)
        self.assertEqual(len({p['interval_key'] for p in requests}),1)
        self.assertTrue(all(p['mode']=='shadow' for p in requests))
    def test_live_mode_and_late_checkpoint_are_refused(self):
        with patch.dict('os.environ',{'V12_MODE':'live'}):self.assertRaises(ValueError,Service)
        self.assertRaisesRegex(ValueError,'CHECKPOINT_EXPIRED',score_checkpoint,None,None,
          {'open':'2026-09-17T19:00:00Z'}, {},120,int(pd.Timestamp('2026-09-17T19:02:06Z').timestamp()*1000))

if __name__=='__main__':unittest.main()
