#!/usr/bin/env bash
# Tests for link_durable_cache.sh. Every case runs in a throwaway temp tree and
# NEVER touches a real cache: C85_DURABLE_ROOT and C85_CACHE_LINK are always
# overridden, and the script is invoked with C85_ALLOW_SAME_FS=1 because the
# temp tree lives on the sandbox filesystem.
set -uo pipefail

SCRIPT=$(cd "$(dirname "$0")" && pwd)/link_durable_cache.sh
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3' got '$2')"; fi; }

newtree() {
  T=$(mktemp -d)
  DUR="$T/durable"; LINK="$T/repo/evaluation-fixtures/cache"
  mkdir -p "$DUR" "$(dirname "$LINK")"
}
run() {
  C85_ALLOW_SAME_FS=1 C85_DURABLE_ROOT="$DUR" C85_CACHE_LINK="$LINK" \
    bash "$SCRIPT" >"$T/out" 2>"$T/err"
  echo $?
}

echo "1. fresh link when no local cache exists"
newtree
rc=$(run); check "exit 0" "$rc" 0
check "symlink created" "$(readlink -f "$LINK")" "$(readlink -f "$DUR")"

echo "2. repeated invocation is a no-op"
rc=$(run); check "exit 0" "$rc" 0
check "still linked" "$(readlink -f "$LINK")" "$(readlink -f "$DUR")"
grep -q "already linked" "$T/err" && ok "reports already linked" || bad "no already-linked note"

echo "3. migration of a local cache, with a conflicting filename"
newtree
mkdir -p "$LINK/sub" "$DUR/sub"
printf 'LOCAL-ONLY' >"$LINK/only-local.txt"
printf 'SAME'       >"$LINK/sub/same.txt"
printf 'SAME'       >"$DUR/sub/same.txt"
printf 'LOCAL'      >"$LINK/sub/conflict.txt"
printf 'DURABLE'    >"$DUR/sub/conflict.txt"
rc=$(run); check "exit 0" "$rc" 0
check "durable copy of local-only file" "$(cat "$DUR/only-local.txt")" "LOCAL-ONLY"
check "identical file untouched"        "$(cat "$DUR/sub/same.txt")"   "SAME"
check "durable conflict NOT overwritten" "$(cat "$DUR/sub/conflict.txt")" "DURABLE"
side=$(ls "$DUR/sub"/conflict.txt.local-* 2>/dev/null | head -1)
if [ -n "$side" ] && [ "$(cat "$side")" = "LOCAL" ]; then
  ok "local conflicting bytes preserved beside it"
else
  bad "local conflicting bytes lost"
fi
grep -q "CONFLICT" "$T/err" && ok "conflict reported" || bad "conflict not reported"
backup=$(ls -d "$LINK".migrated-* 2>/dev/null | head -1)
if [ -n "$backup" ] && [ "$(cat "$backup/sub/conflict.txt")" = "LOCAL" ]; then
  ok "source cache retained as a recoverable backup"
else
  bad "source cache backup missing"
fi
check "link now points at durable" "$(readlink -f "$LINK")" "$(readlink -f "$DUR")"

echo "4. interrupted migration: partial/garbage leftovers do not lose data"
newtree
mkdir -p "$LINK"
printf 'A-CONTENT' >"$LINK/a.txt"
printf 'B-CONTENT' >"$LINK/b.txt"
# simulate a previous run killed mid-copy: a.txt fully copied, b.txt left as a
# .partial temp file with truncated bytes.
cp "$LINK/a.txt" "$DUR/a.txt"
printf 'B-CONT'    >"$DUR/b.txt.partial-999"
rc=$(run); check "exit 0" "$rc" 0
check "already-copied file kept once" "$(cat "$DUR/a.txt")" "A-CONTENT"
check "interrupted file completed"    "$(cat "$DUR/b.txt")" "B-CONTENT"
if [ -z "$(ls "$DUR"/b.txt.local-* 2>/dev/null)" ]; then
  ok "no spurious conflict copy for the truncated temp file"
else
  bad "truncated temp file was treated as a real conflict"
fi

echo "5. migration is repeatable after it already ran"
rc=$(run); check "exit 0 on rerun" "$rc" 0
check "still linked" "$(readlink -f "$LINK")" "$(readlink -f "$DUR")"

echo "6. unusable durable root fails closed and touches nothing"
newtree
mkdir -p "$LINK"; printf 'KEEP' >"$LINK/keep.txt"
# a plain file where the durable root should be: the mount is not usable.
# (chmod is not used here: the sandbox runs as root, which bypasses mode bits.)
rmdir "$DUR"; printf 'not-a-mount' >"$DUR"
rc=$(run); [ "$rc" != 0 ] && ok "unusable durable root refused" || bad "accepted an unusable root"
check "local cache untouched" "$(cat "$LINK/keep.txt")" "KEEP"

newtree
mkdir -p "$LINK"; printf 'KEEP' >"$LINK/keep.txt"
DUR="$T/no/such/parent/durable"
rc=$(run); [ "$rc" != 0 ] && ok "missing durable parent refused" || bad "accepted a missing parent"
LINKDIR="$T/repo/evaluation-fixtures/cache"
check "local cache untouched" "$(cat "$LINKDIR/keep.txt")" "KEEP"

echo "7. same-filesystem durable root is refused without the explicit override"
newtree
rc=$(C85_DURABLE_ROOT="$DUR" C85_CACHE_LINK="$LINK" bash "$SCRIPT" >/dev/null 2>&1; echo $?)
[ "$rc" != 0 ] && ok "same-filesystem root refused" || bad "same-filesystem root accepted"

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
