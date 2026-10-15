"""Privilege-dropping entrypoint. Started as root ONLY to prepare DATA_DIR/events on a
Railway volume (mounted root-owned), then permanently drops to the unprivileged worker uid
before importing/running the collector. Never chmods 777, never follows symlinks, never
touches any other path on the volume (lost+found, metadata, existing files untouched)."""
import os, stat, sys
from pathlib import Path

from alt.core import EVENTS_SUBDIR

RUN_UID = int(os.getenv('ALT_RUN_UID', '10002'))
RUN_GID = int(os.getenv('ALT_RUN_GID', '10002'))


def prepare_events_dir(data_dir, uid, gid, sub=EVENTS_SUBDIR):
    """Create/own only DATA_DIR/events (mode 0700). Fails closed on symlinks/non-dirs."""
    root = Path(data_dir)
    if root.is_symlink():
        raise ValueError('ALT_DIR_SYMLINK')
    root.mkdir(mode=0o755, parents=True, exist_ok=True)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('ALT_DIR_UNSAFE')
    ev = root / sub
    if ev.is_symlink():
        raise ValueError('ALT_DIR_SYMLINK')
    try:
        ev.mkdir(mode=0o700)
    except FileExistsError:
        pass
    st = ev.lstat()
    if not stat.S_ISDIR(st.st_mode):
        raise ValueError('ALT_DIR_UNSAFE')
    if st.st_uid != uid or st.st_gid != gid:
        os.chown(ev, uid, gid, follow_symlinks=False)
    if stat.S_IMODE(st.st_mode) != 0o700:
        os.chmod(ev, 0o700)
    return ev


def drop_privileges(uid, gid):
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)
    if os.getuid() != uid or os.geteuid() != uid:
        raise RuntimeError('ALT_PRIV_DROP_FAILED')
    try:
        os.setuid(0)
    except PermissionError:
        return
    raise RuntimeError('ALT_PRIV_DROP_FAILED')


def run():
    if os.geteuid() == 0:
        prepare_events_dir(os.getenv('DATA_DIR', './data/dot-alt'), RUN_UID, RUN_GID)
        prepare_events_dir(os.getenv('DATA_DIR', './data/dot-alt'), RUN_UID, RUN_GID, 'ledger')
        drop_privileges(RUN_UID, RUN_GID)
    import asyncio
    from alt.main import amain
    asyncio.run(amain())


if __name__ == '__main__':
    try:
        run()
    except Exception as e:
        print(f'ALT_STARTUP_FAILED {type(e).__name__}: {e}', file=sys.stderr)
        sys.exit(1)
