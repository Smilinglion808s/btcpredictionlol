import sys, numpy as np, pandas as pd
sys.path.insert(0,'/tmp/c85root/external_research'); sys.path.insert(0,'/tmp/c30root'); sys.path.insert(0,'/tmp/c85root')
import htf_structure_r3_models as htf
import htf_structure_r4_stress as stress
import technical_expansion_r2_models as r2
from pathlib import Path
from compare import compare
OUT = Path('/tmp/c85root/external_research/htf_structure_r3_output')

frame = htf.load_t5()
masks = stress.split_masks(frame)
base, _, feature_map = stress.prepare_features(frame)
raw = [*r2.feature_groups()["BOOK_SHAPE"], "vwap_utc_day_distance_bps", "vwap_active_4h_distance_bps"]
features = stress.features_for(base, feature_map, raw)
probability, candidate, rank, active_threshold, trailing, fits, first_fit = stress.fit_policy(
    frame, features, c_value=0.003, window=5_760, minimum=1_536, refit_every=96)
control = frame.prediction.fillna(0).to_numpy(np.int8)
full_rows = pd.read_csv(OUT/"t5_book_anchored_r4_rows.csv", parse_dates=["ts"])
print("frame rows", len(frame), "full_rows", len(full_rows), "fits", fits, "first_fit", first_fit)
n = min(len(frame), len(full_rows))
aligned = bool((frame.ts.to_numpy()[:n] == full_rows.ts.to_numpy()[:n]).all())
print("ts aligned over overlap:", aligned)
full_r4 = full_rows.candidate_prediction.to_numpy(np.int8)

expected = pd.read_csv(OUT/"t5_book_anchored_r4_feature_parameter_grid.csv")
expected = expected.loc[expected.identity == "BOOK_DAY_4H"].iloc[0]
rep = stress.compact_score(frame.iloc[:n], candidate[:n], masks["later_known"][:n])
print("stress-grid check trades", rep["trades"], "vs", int(expected.later_known_trades),
      "| win_rate", rep["win_rate"], "vs", float(expected.later_known_win_rate))

ledger = pd.DataFrame({
    "ts": frame.ts, "label": frame.label, "base_direction": frame.base_direction,
    "probability_correct": probability, "directional_rank": rank,
    "active_threshold": active_threshold, "trailing_coverage": trailing,
    "prediction": candidate, "frozen_t5_r2_prediction": control,
    "full_r4_prediction": np.concatenate([full_r4, np.zeros(max(0,len(frame)-len(full_r4)), np.int8)])[:len(frame)],
})
ledger.to_csv('/tmp/c85root/r4_repro_rows.csv', index=False)
ref = pd.read_parquet('/dev-server/services/c85-worker/evaluation-fixtures/upstream/t5_book_day4h_r4_1_rows.parquet')
ref['ts'] = pd.to_datetime(ref.ts, utc=True)
led = ledger.copy(); led['ts'] = pd.to_datetime(led.ts, utc=True)
led = led[led.ts.isin(set(ref.ts))].reset_index(drop=True)
print("fixture rows", len(ref), "overlap rows", len(led))
compare('t5_book_day4h_r4_1_rows.parquet', led)
