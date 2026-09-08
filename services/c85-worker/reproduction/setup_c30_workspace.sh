#!/usr/bin/env bash
# Build /dev-server/services/c85-worker/evaluation-fixtures/cache/c30root: the workspace the C30 -> phase3 -> C36 -> C37 producers
# need in order to be re-executed from source.
#
# Sources are the recovered archives already expanded at /dev-server/services/c85-worker/evaluation-fixtures/cache/upx by
# setup_workspace.sh. Nothing here is transcribed or synthesised: every module
# and every input ledger is copied verbatim out of the archive.
set -euo pipefail

UPX=${UPX:-/dev-server/services/c85-worker/evaluation-fixtures/cache/upx}
ROOT=${ROOT:-/dev-server/services/c85-worker/evaluation-fixtures/cache/c30root}
ER="$ROOT/external_research"
mkdir -p "$ER"

copy_first() {  # copy_first <filename> <destdir>
  local name="$1" dest="$2" src
  src=$(find "$UPX" -name "$name" -not -path '*__pycache__*' | head -1 || true)
  if [ -z "$src" ]; then echo "MISSING: $name" >&2; return 1; fi
  mkdir -p "$dest"; cp -f "$src" "$dest/"; echo "  $name <- $src"
}

echo "producers:"
for m in c30_c70_lab_manager_r2.py c30_c70_lab_manager_r2_phase2.py \
         c30_c70_lab_manager_r2_phase3.py c36_fee_frontier_r3.py \
         c36_timing_robustness_r1.py c36_maturation_refinement_r2.py \
         c37_balanced_maturation_r1.py evaluate_external_direction_r1.py \
         t0_t5_fee_coverage_frontier_r1.py t0_t5_win_containment_deep_dive_r1.py; do
  copy_first "$m" "$ER" || true
done

echo "input ledgers:"
for l in fee_coverage_shadow_ledger.csv fixed_floor_shadow_ledger.csv \
         selected_shadow_ledger.csv t5_hot_calibration_ledger.csv \
         t5_book_day4h_r4_1_rows.csv; do
  copy_first "$l" "$ROOT/inputs" || true
done

# Reference copies of each producer's archived output, used only for parity.
for d in c30_c70_lab_manager_r2_output c36_fee_frontier_r3_output \
         c36_timing_robustness_r1_output c37_balanced_maturation_r1_output; do
  src=$(find "$UPX" -type d -name "$d" | head -1 || true)
  [ -n "$src" ] && { mkdir -p "$ER/$d"; cp -rf "$src/." "$ER/$d/"; echo "  ref $d"; }
done
mkdir -p "$ER/c37_ref"
src=$(find "$UPX" -type d -name c37_balanced_maturation_r1_output | head -1)
cp -rf "$(dirname "$src")" "$ER/c37_ref/" 2>/dev/null || true


# Merge every expanded upstream package tree into the workspace so the
# producers' ROOT-relative input paths resolve. cp -rn never clobbers a file
# already installed above.
echo "merging package trees:"
for d in "$UPX"/upstream/vault_work/legacy_lab2/sources/*__expanded; do
  [ -d "$d" ] || continue
  cp -rn "$d/." "$ROOT/" 2>/dev/null || true
  echo "  $(basename "$d")"
done
for d in "$UPX"/upstream/vault_work/legacy_c30 "$UPX"/upstream/vault_work/legacy_c37; do
  [ -d "$d" ] && cp -rn "$d/." "$ROOT/" 2>/dev/null || true
done
mkdir -p "$ER/multivenue_r1"
mv_src=$(find "$UPX" -type d -name multivenue_r1 | head -1 || true)
[ -n "$mv_src" ] && cp -rn "$mv_src/." "$ER/multivenue_r1/" 2>/dev/null || true
# The MULTIVENUE_R1 compact package stores features/ and evaluation/ at its own
# root; the lab manager expects them under external_research/multivenue_r1/.
mvc="$UPX/upstream/vault_work/legacy_lab2/sources/T0_T5_MULTIVENUE_LAB_R1_COMPACT.zip__expanded"
[ -d "$mvc" ] && cp -rn "$mvc/." "$ER/multivenue_r1/" 2>/dev/null || true

# t0_prior_candle_output/: evaluate_external_direction_r1 reads the recovered
# T0 prior-candle rows back from the lab root. The only surviving copy lives in
# the T0_PRIOR_CANDLE_R2 research package's results/ directory.
mkdir -p "$ROOT/t0_prior_candle_output"
t0pc="$UPX/upstream/vault_work/legacy_lab2/sources/T0_PRIOR_CANDLE_R2_RESEARCH_PACKAGE.zip__expanded/T0_PRIOR_CANDLE_R2_PACKAGE/results"
for f in t0_prior_candle_r2_rows.csv t0_selected_forward_rows.csv \
         t0_selected_pre_forward_rows.csv T0_PRIOR_CANDLE_R2_FREEZE.json \
         T0_PRIOR_CANDLE_R1_FREEZE.json; do
  [ -f "$t0pc/$f" ] && cp -n "$t0pc/$f" "$ROOT/t0_prior_candle_output/" || true
done

cp -f "$(dirname "$0")/compare.py" "$ROOT/" 2>/dev/null || true

# Resolve remaining intra-archive module imports until the entrypoint imports.
for i in $(seq 1 60); do
  OUT=$(cd "$ROOT" && PYTHONPATH="$ROOT" ${PY:-python3} -c \
      "import sys;sys.path[:0]=['$ROOT','$ER'];from external_research import c30_c70_lab_manager_r2" 2>&1 || true)
  [ -z "$OUT" ] && { echo "imports resolved"; break; }
  M=$(echo "$OUT" | grep -oP "No module named '\K[^']+" | tail -1 || true)
  [ -z "$M" ] && M=$(echo "$OUT" | grep -oP "cannot import name '\K[^']+" | tail -1 || true)
  if [ -z "$M" ]; then echo "$OUT" | tail -5; break; fi
  M=${M##*.}
  copy_first "$M.py" "$ER" || { echo "unresolvable import: $M"; break; }
done

echo "workspace ready at $ROOT"
