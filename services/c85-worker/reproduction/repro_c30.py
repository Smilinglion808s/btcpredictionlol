import sys, pathlib, pandas as pd
sys.path.insert(0,'/tmp/c30root')
from external_research import c30_c70_lab_manager_r2 as c30
out = pathlib.Path('/tmp/c30root/c30_repro_out'); out.mkdir(parents=True, exist_ok=True)
c30.OUT = out
c30.main()
from compare import compare
new = pd.read_csv(out/'selected_shadow_ledger.csv', parse_dates=['ts'])
compare('selected_shadow_ledger__c30_c70_lab_manager_r2_output.parquet', new)
