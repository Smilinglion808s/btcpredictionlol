import sys,tempfile,unittest,json
from pathlib import Path
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from refit import period_start,training_slice,load_history,fit_models
from training_capture import initialize,save_frame,record_outcome
from capture import Capture
from scorer import Scorer

ROOT=Path(__file__).resolve().parents[1]
class RefitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.data=load_history(ROOT/'artifacts')
    def test_schedule_remains_21_days_with_no_expiry_extension(self):
        self.assertEqual(str(period_start('2026-10-04T23:59:59Z')),'2026-09-14 00:00:00+00:00')
        self.assertEqual(str(period_start('2026-10-05T00:00:00Z')),'2026-10-05 00:00:00+00:00')
        self.assertRaisesRegex(ValueError,'OFF_SCHEDULE',training_slice,self.data,'2026-09-15T00:00:00Z','L')
    def test_exact_original_training_populations(self):
        for source,rows in [('L',23492),('R',47039)]:
            train=training_slice(self.data,'2026-09-14T00:00:00Z',source)
            self.assertEqual(len(train),rows);self.assertEqual(train.ticker.nunique(),7849)
            self.assertLess(train.settlement_ts.max(),pd.Timestamp('2026-09-13T00:00:00Z'))
    def test_future_unsettled_and_late_observed_labels_cannot_enter_fit(self):
        poison=self.data[self.data.ts.ge('2026-09-01')].head(3).copy()
        poison['ticker']=['UNSETTLED','FUTURE_SETTLEMENT','LATE_OBSERVED']
        poison.loc[poison.index[0],'label']=0
        poison.loc[poison.index[1],'settlement_ts']=pd.Timestamp('2026-09-13T00:00:00Z')
        poison['label_observed_at']=pd.Series(pd.NaT,index=poison.index,dtype='datetime64[ns, UTC]')
        poison.loc[poison.index[2],'label_observed_at']=pd.Timestamp('2026-09-14T00:00:00Z')
        data=pd.concat([self.data,poison],ignore_index=True)
        data['label_observed_at']=pd.to_datetime(data.label_observed_at,utc=True)
        train=training_slice(data,'2026-09-14T00:00:00Z','R')
        self.assertFalse(train.ticker.isin(poison.ticker).any())
    def test_training_capture_has_no_eligibility_filter_and_labels_are_official_only(self):
        with tempfile.TemporaryDirectory() as d:
            cap=Capture(str(Path(d)/'capture.sqlite'));initialize(cap.db)
            frame=self.data[self.data.feature_valid&self.data.quote_valid].head(1).copy();save_frame(cap.db,frame)
            row=frame.iloc[0];now=row.ts+pd.Timedelta(hours=1)
            base={'ticker':row.ticker,'status':'finalized','result':'yes','settlement_ts':(row.ts+pd.Timedelta(minutes=16)).isoformat()}
            self.assertFalse(record_outcome(cap.db,{**base,'status':'open'},now))
            self.assertFalse(record_outcome(cap.db,{**base,'settlement_ts':(now+pd.Timedelta(seconds=1)).isoformat()},now))
            self.assertTrue(record_outcome(cap.db,base,now))
            self.assertEqual(cap.db.execute('select label from training_outcomes').fetchone()[0],1)
    def test_stale_history_cannot_prepare_future_fit(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertRaisesRegex(ValueError,'RECENT_TRAINING_COVERAGE',fit_models,self.data,'2026-10-05T00:00:00Z',d)
            self.assertFalse((Path(d)/'manifest.json').exists())

if __name__=='__main__':unittest.main()
