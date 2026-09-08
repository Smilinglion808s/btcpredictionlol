#!/usr/bin/env bash
# Point the (gitignored) worker cache at the durable documents mount.
#
# /dev-server is replaced without warning; everything under
# services/c85-worker/evaluation-fixtures/cache is derived, multi-GB and
# gitignored, so it must never physically live there. /mnt/documents is a
# cloud-object-store mount that has so far survived sandbox replacement, so the
# cache is a symlink into it. Re-run this after any sandbox reset, before
# setup_workspace.sh.
#
# SAFETY CONTRACT (this script is destructive-by-accident-proof):
#   * the durable root is validated by an actual write/read/delete probe, not
#     by "the parent directory exists";
#   * a local cache is migrated file-by-file with a byte hash verification;
#   * a destination file that exists with DIFFERENT bytes is never overwritten:
#     the local copy is preserved beside it as <name>.local-<stamp> and the
#     conflict is reported;
#   * the local cache directory is never `rm -rf`ed. It is renamed to
#     <cache>.migrated-<stamp> and left in place as a recoverable backup;
#   * every step is idempotent, so an interrupted run is fixed by re-running.
#
# Environment overrides (used by reproduction/test_link_durable_cache.sh):
#   C85_DURABLE_ROOT   durable destination root
#   C85_CACHE_LINK     the link path to create (default <repo>/evaluation-fixtures/cache)
#   C85_ALLOW_SAME_FS  set to 1 to accept a durable root on the repo filesystem
set -euo pipefail

DURABLE=${C85_DURABLE_ROOT:-/mnt/documents/.lovable/c85-cache}
REPO=$(cd "$(dirname "$0")/.." && pwd)
LINK=${C85_CACHE_LINK:-$REPO/evaluation-fixtures/cache}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

die() { echo "link_durable_cache: $*" >&2; exit 1; }
note() { echo "link_durable_cache: $*" >&2; }

# ---------------------------------------------------------------------------
# 1. validate the durable mount for real
# ---------------------------------------------------------------------------
parent=$(dirname "$DURABLE")
[ -d "$parent" ] || die "durable parent missing: $parent"
mkdir -p "$DURABLE" || die "cannot create durable root: $DURABLE"
[ -d "$DURABLE" ] || die "durable root is not a directory: $DURABLE"

probe="$DURABLE/.write-probe.$$"
if ! head -c 4096 /dev/urandom >"$probe" 2>/dev/null; then
  rm -f "$probe" 2>/dev/null || true
  die "durable root is not writable: $DURABLE"
fi
probe_hash=$(sha256sum "$probe" | cut -d' ' -f1)
readback=$(sha256sum "$probe" | cut -d' ' -f1)
rm -f "$probe"
[ "$probe_hash" = "$readback" ] || die "durable root failed a write/read probe: $DURABLE"
[ -e "$probe" ] && die "durable root cannot delete files: $DURABLE"

durable_fs=$(stat -f -c %i "$DURABLE" 2>/dev/null || echo unknown)
repo_fs=$(stat -f -c %i "$REPO" 2>/dev/null || echo unknown)
if [ "$durable_fs" = "$repo_fs" ] && [ "${C85_ALLOW_SAME_FS:-0}" != "1" ]; then
  die "durable root is on the same filesystem as the repo ($DURABLE); \
that is not durable storage. Set C85_ALLOW_SAME_FS=1 only for tests."
fi

# ---------------------------------------------------------------------------
# 2. already linked correctly? nothing to do
# ---------------------------------------------------------------------------
if [ -L "$LINK" ] && [ "$(readlink -f "$LINK")" = "$(readlink -f "$DURABLE")" ]; then
  note "already linked"
elif [ -L "$LINK" ]; then
  note "re-pointing existing symlink $(readlink -f "$LINK") -> $DURABLE"
  ln -sfn "$DURABLE" "$LINK"
elif [ -e "$LINK" ]; then
  [ -d "$LINK" ] || die "$LINK exists and is not a directory; refusing to touch it"

  # -----------------------------------------------------------------------
  # 3. verified, non-destructive migration
  # -----------------------------------------------------------------------
  note "migrating local cache into the durable store (no deletions)"
  conflicts=0 copied=0 identical=0
  while IFS= read -r -d '' src; do
    rel=${src#"$LINK"/}
    dst="$DURABLE/$rel"
    mkdir -p "$(dirname "$dst")"
    src_hash=$(sha256sum "$src" | cut -d' ' -f1)
    if [ -e "$dst" ]; then
      dst_hash=$(sha256sum "$dst" | cut -d' ' -f1)
      if [ "$src_hash" = "$dst_hash" ]; then
        identical=$((identical + 1))
        continue
      fi
      dst="$dst.local-$STAMP"
      conflicts=$((conflicts + 1))
      note "CONFLICT: $rel differs; local copy preserved as $(basename "$dst")"
      [ -e "$dst" ] && continue
    fi
    # copy to a temp name first, verify, then atomically rename: an interrupted
    # copy can never be mistaken for a complete one on the next run.
    tmp="$dst.partial-$$"
    cp -p "$src" "$tmp"
    [ "$(sha256sum "$tmp" | cut -d' ' -f1)" = "$src_hash" ] ||
      { rm -f "$tmp"; die "copy verification failed for $rel"; }
    mv -f "$tmp" "$dst"
    copied=$((copied + 1))
  done < <(find "$LINK" -type f -print0)

  # verify every source file now has a byte-identical durable counterpart
  missing=0
  while IFS= read -r -d '' src; do
    rel=${src#"$LINK"/}
    h=$(sha256sum "$src" | cut -d' ' -f1)
    ok=0
    for cand in "$DURABLE/$rel" "$DURABLE/$rel.local-$STAMP"; do
      [ -e "$cand" ] || continue
      [ "$(sha256sum "$cand" | cut -d' ' -f1)" = "$h" ] && ok=1 && break
    done
    [ "$ok" = 1 ] || { missing=$((missing + 1)); note "UNVERIFIED: $rel"; }
  done < <(find "$LINK" -type f -print0)
  [ "$missing" -eq 0 ] || die "$missing file(s) unverified; local cache left untouched"

  backup="$LINK.migrated-$STAMP"
  mv "$LINK" "$backup"
  ln -s "$DURABLE" "$LINK"
  note "copied=$copied identical=$identical conflicts=$conflicts"
  note "local cache retained at $backup (delete it yourself once satisfied)"
else
  mkdir -p "$(dirname "$LINK")"
  ln -s "$DURABLE" "$LINK"
fi

echo "cache -> $(readlink -f "$LINK")"
find "$DURABLE" -type f -printf '%s\n' |
  awk '{s+=$1} END {printf "durable cache: %d files, %.2f GB\n", NR, s/1073741824}'
