#!/usr/bin/env bash
# Stage the workspace the COVERAGE -> C30 serving path needs, and nothing else.
#
# The recovered research package T0_T5_CONTINUOUS_COVERAGE_LAB_CHECKPOINT_R1 is
# a flat directory; `t0_t5_coverage_bridge_audit_r1.py` resolves its inputs from
# `Path(__file__).resolve().parents[1]`, so the module has to sit one level down
# (external_research/) inside a root that also carries t5_precision_lab.py,
# lab_t5/ and upload/.
#
# Nothing is transcribed here: every module and ledger is copied verbatim out of
# the durable recovery cache, and the two September continuation inputs are
# downloaded from the verified private project bucket.
#
# The staging root is disposable (/tmp). Durable state stays in
# /mnt/documents/.lovable/c85-cache and in the c85-artifacts bucket.
set -euo pipefail

CACHE=${CACHE:-/mnt/documents/.lovable/c85-cache}
PKG="$CACHE/upx/upstream/vault_work/legacy_lab2/sources/T0_T5_CONTINUOUS_COVERAGE_LAB_CHECKPOINT_R1.zip__expanded"
ROOT=${ROOT:-/tmp/c85stage/covroot}
ER="$ROOT/external_research"
PY=${PY:-/tmp/c85py/bin/python}

[ -d "$PKG" ] || { echo "missing recovered coverage package: $PKG" >&2; exit 1; }

mkdir -p "$ER" "$ROOT/upload" \
         "$ER/t5_second_path_challenger_r1_output" \
         "$ER/net_monthly_r1_output"

# 1. verbatim recovered code
cp -f "$PKG/t5_precision_lab.py" "$ROOT/"
for m in t0_t5_coverage_bridge_audit_r1.py net_monthly_waterfall_r1.py \
         net_monthly_final_stress.py; do
  cp -f "$PKG/$m" "$ER/"
done
touch "$ER/__init__.py"

# 2. frozen reference outputs, kept read-only for comparison only
mkdir -p "$ROOT/reference"
for f in continuous_coverage_ledger.csv coverage_bridge_performance.csv \
         T0_T5_COVERAGE_BRIDGE_AUDIT_R1.json; do
  cp -f "$PKG/$f" "$ROOT/reference/"
  chmod a-w "$ROOT/reference/$f"
done

# 3. frozen lab inputs
cp -rf "$CACHE/c85root/lab_t5" "$ROOT/"
for f in t10-bridge-r1-2026-08-31.csv t45-priceflow-q375-2026-08-31.csv; do
  cp -f "$CACHE/c85root/upload/$f" "$ROOT/upload/"
done

# 4. September continuation inputs from the verified private bucket
"$PY" - "$ER" <<'PY'
import hashlib, os, sys, urllib.request
from pathlib import Path

er = Path(sys.argv[1])
base = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
prefix = "datasets/c85-reconstruction-r1/september_c30_inputs_2026-09"
targets = {
    "t5_second_path_features.csv": er / "t5_second_path_challenger_r1_output",
    "t0_long_context_full_predictions.csv": er / "net_monthly_r1_output",
}
for name, dest in targets.items():
    url = f"{base}/storage/v1/object/c85-artifacts/{prefix}/{name}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    data = urllib.request.urlopen(req).read()
    (dest / name).write_bytes(data)
    print(f"  {name} {len(data)} bytes sha256={hashlib.sha256(data).hexdigest()}")
PY

echo "coverage/C30 workspace ready at $ROOT"
