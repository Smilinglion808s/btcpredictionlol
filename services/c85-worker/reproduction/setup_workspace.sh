#!/usr/bin/env bash
# Rebuild the ephemeral reproduction workspace (/dev-server/services/c85-worker/evaluation-fixtures/cache/c85root) from the
# persistent recovery archives. The sandbox /tmp is wiped periodically, so this
# script is idempotent and cheap to re-run. Heavy derived inputs are cached in
# the persistent (gitignored) evaluation-fixtures/cache directory and symlinked
# back in rather than rebuilt.
set -euo pipefail

UPLOADS=${UPLOADS:-/mnt/user-uploads}
UPX=${UPX:-/dev-server/services/c85-worker/evaluation-fixtures/cache/upx}
ROOT=${ROOT:-/dev-server/services/c85-worker/evaluation-fixtures/cache/c85root}
REPO=${REPO:-/dev-server/services/c85-worker}
CACHE="$REPO/evaluation-fixtures/cache"
mkdir -p "$CACHE"

# 1. unpack the recovery archives (once per sandbox lifetime)
if [ ! -d "$UPX/upstream" ]; then
  mkdir -p "$UPX"
  for z in C85_Upstream_Recovery C85_Ancestor_Recovery; do
    d="$UPX/$(echo "$z" | sed 's/C85_//; s/_Recovery//' | tr 'A-Z' 'a-z')"
    mkdir -p "$d"; unzip -qo "$UPLOADS/$z.zip" -d "$d"
  done
  python3 - "$UPX" <<'PY'
import pathlib, sys, zipfile
root = sys.argv[1]
while True:
    pending = [p for p in pathlib.Path(root).rglob('*.zip')
               if not pathlib.Path(str(p) + '__expanded').exists()]
    if not pending:
        break
    for z in pending:
        out = pathlib.Path(str(z) + '__expanded')
        out.mkdir(parents=True, exist_ok=True)
        try:
            zipfile.ZipFile(z).extractall(out)
        except Exception as error:  # non-archive payloads
            print('skip', z, error)
PY
fi

SRC="$UPX/upstream/vault_work/legacy_lab2/sources"

# 2. lab root: T5 baseline freeze package, filled in from the R3 package
rm -rf "$ROOT"; mkdir -p "$ROOT"
cp -r "$SRC/T5_BASELINE_R4_1_FREEZE_PACKAGE.zip__expanded/." "$ROOT/"
cp -rn "$SRC/HTF_STRUCTURE_R3_PACKAGE.zip__expanded/external_research/." \
       "$ROOT/external_research/" 2>/dev/null || true

# 3. sibling lab modules the producers import
copy_module() {
  local name=$1 dest=$2
  local hit
  hit=$(find "$UPX/upstream" -name "$name" | head -1)
  [ -n "$hit" ] && cp -n "$hit" "$dest" || echo "missing module: $name" >&2
}
copy_module t0_prior_candle_lab.py "$ROOT/"
copy_module t5_preopen_technical_challenger.py "$ROOT/"
copy_module long_context_model.py "$ROOT/external_research/"

# 4. upstream stage outputs the producers read back
mkdir -p "$ROOT/t5_precision_output"
cp -rn "$SRC/T0_T5_FEE_COVERAGE_FRONTIER_R1_PACKAGE.zip__expanded/t5_precision_output/." \
      "$ROOT/t5_precision_output/" 2>/dev/null || true

TEXP="$SRC/T0_T5_TECHNICAL_EXPANSION_R2_PACKAGE.zip__expanded/T0_T5_TECHNICAL_EXPANSION_R2"
cp -rn "$TEXP/t5_precision_output/." "$ROOT/t5_precision_output/" 2>/dev/null || true
# Every python module the R2 package shipped: the R3/R4 refine chain imports
# several of them transitively (e.g. technical_expansion_r2_audit).
cp -n "$TEXP/external_research/"*.py "$ROOT/external_research/" 2>/dev/null || true
cp -n "$TEXP/external_research/build_technical_expansion_r2.py" \
      "$TEXP/external_research/build_long_context_features.py" \
      "$TEXP/external_research/download_binance_context_2026.py" \
      "$TEXP/external_research/download_cross_asset_1m.py" \
      "$TEXP/external_research/technical_expansion_r2_feature_audit.json" \
      "$TEXP/external_research/metrics_timestamp_daily_audit.csv" \
      "$ROOT/external_research/" 2>/dev/null || true

# T0 external-resource modules: build_long_context_features imports
# build_t0_external_features from this package.
T0EXT="$SRC/T0_EXTERNAL_RESOURCE_HUNT_R1_PACKAGE.zip__expanded/T0_EXTERNAL_RESOURCE_HUNT_R1/external_research"
cp -n "$T0EXT/"*.py "$ROOT/external_research/" 2>/dev/null || true

# lab_t5 inputs the R2 technical-expansion build reads (t45_features.csv lives
# in the R2 reliability package's own bundled T45 balanced lab package).
mkdir -p "$ROOT/lab_t5"
T45LAB="$SRC/T5_RELIABILITY_R2_LAB_PACKAGE.zip__expanded/T5_R2_PACKAGE/source_packages/R2_T45_BALANCED_R1_LAB_PACKAGE.zip__expanded"
cp -n "$T45LAB/"*.csv "$ROOT/lab_t5/" 2>/dev/null || true

# uploaded forward inputs the R2 build reads from ROOT/upload
mkdir -p "$ROOT/upload"
cp -n "$SRC/"*.csv "$ROOT/upload/" 2>/dev/null || true

# T0 prior-candle R2 results the R4 refine chain joins against
mkdir -p "$ROOT/t0_prior_candle_output"
cp -n "$SRC/T0_PRIOR_CANDLE_R2_RESEARCH_PACKAGE.zip__expanded/T0_PRIOR_CANDLE_R2_PACKAGE/results/"* \
      "$ROOT/t0_prior_candle_output/" 2>/dev/null || true

cp "$REPO/reproduction/compare.py" "$ROOT/"
cp "$REPO/reproduction/sitecustomize.py" "$ROOT/external_research/" 2>/dev/null || true

# 5. cached heavy inputs (raw Binance archives, rebuilt feature matrices)
for item in binance_context_2026 binance_cross_asset_2026 \
            long_context_features.pkl technical_expansion_r2.pkl; do
  if [ -e "$CACHE/$item" ]; then
    rm -rf "${ROOT:?}/external_research/$item"
    ln -s "$CACHE/$item" "$ROOT/external_research/$item"
  fi
done

# 6. Binance SPOT 1s daily archives (needed by r4_2_final_audit's boundary build).
#    Kept in the cache; downloaded once from data.binance.vision, checksum-verified
#    by Binance's own per-file digests at download time.
ARCH="$CACHE/binance_spot_1s_archives"
mkdir -p "$ARCH"
BASE=https://data.binance.vision/data/spot/daily/klines/BTCUSDT/1s
D=2026-01-01
while [ "$D" != 2026-09-01 ]; do
  F="BTCUSDT-1s-$D.zip"
  [ -s "$ARCH/$F" ] || curl -sf -o "$ARCH/$F" "$BASE/$F" || echo "missing $F"
  D=$(date -I -d "$D + 1 day")
done
mkdir -p "$ROOT/external_research/binance_spot_1s"
rm -rf "$ROOT/external_research/binance_spot_1s/archives"
ln -s "$ARCH" "$ROOT/external_research/binance_spot_1s/archives"

# 7. parity fixtures (gitignored) for the worker test suite
python3 "$REPO/reproduction/restore_upstream_fixtures.py" || true

echo "workspace ready at $ROOT"
