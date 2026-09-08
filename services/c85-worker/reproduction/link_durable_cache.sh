#!/usr/bin/env bash
# Point the (gitignored) worker cache at the durable documents mount.
#
# /dev-server is replaced without warning; everything under
# services/c85-worker/evaluation-fixtures/cache is derived, multi-GB and
# gitignored, so it must never physically live there. /mnt/documents is a
# cloud-object-store mount that has survived every sandbox replacement so far
# (files written in July 2026 are still readable byte-identical), so the cache
# is a symlink into it. Re-run this after any sandbox reset, before
# setup_workspace.sh.
set -euo pipefail
DURABLE=${C85_DURABLE_ROOT:-/mnt/documents/.lovable/c85-cache}
REPO=$(cd "$(dirname "$0")/.." && pwd)
LINK="$REPO/evaluation-fixtures/cache"

[ -d "$(dirname "$DURABLE")" ] || { echo "durable mount missing: $DURABLE" >&2; exit 1; }
mkdir -p "$DURABLE"
if [ -e "$LINK" ] && [ ! -L "$LINK" ]; then
  echo "moving existing local cache into the durable store" >&2
  cp -rn "$LINK/." "$DURABLE/" && rm -rf "$LINK"
fi
ln -sfn "$DURABLE" "$LINK"
echo "cache -> $(readlink -f "$LINK")"
find "$DURABLE" -type f -printf '%s\n' |
  awk '{s+=$1} END {printf "durable cache: %d files, %.2f GB\n", NR, s/1073741824}'
