"""Narrow root bootstrap for the ONE approved new Railway volume.

No networking, engine, auth, API, secrets or legacy paths are imported/accessed.
All path/identity constants are pinned. Never recursively chown or broaden modes.
"""
import ctypes
import json
import os
from pathlib import Path
import stat
import sys

PROJECT='5f99de1c-2821-4e3e-b218-745f0385fbee'
ENVIRONMENT='7ad75c03-b76a-4506-978b-4baddde54884'
SERVICE='c3826ca1-2aaf-4d09-95ce-3bbd63623c1a'
VOLUME='eef95868-4ca5-4ed7-8ed9-38e62fca06ce'
VOLUME_NAME='dot-paper-data'
MOUNT='/data/dot-paper'
DATA=MOUNT+'/ledger'
UID=10001
GID=10001
MARKER='.dot-paper-volume.json'
IDENTITY={'schema':1,'project':PROJECT,'environment':ENVIRONMENT,'service':SERVICE,'volume':VOLUME,'child':'ledger'}
FILES={'paper.sqlite3','paper.sqlite3-wal','paper.sqlite3-shm','paper.sqlite3.lock'}
class BootstrapError(RuntimeError):pass


def verify_runtime(env):
    expected={'RAILWAY_PROJECT_ID':PROJECT,'RAILWAY_ENVIRONMENT_ID':ENVIRONMENT,'RAILWAY_SERVICE_ID':SERVICE,
              'RAILWAY_VOLUME_NAME':VOLUME_NAME,'RAILWAY_VOLUME_MOUNT_PATH':MOUNT,'DOT_PAPER_DATA_DIR':DATA}
    if any(env.get(k)!=v for k,v in expected.items()):raise BootstrapError('BOOTSTRAP_TARGET_MISMATCH')
    for p in [Path('/data'),Path(MOUNT)]:
        st=p.lstat()
        if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or stat.S_IMODE(st.st_mode)&0o022:
            raise BootstrapError('BOOTSTRAP_UNSAFE_MOUNT_PATH')
    # Unlike os.path.ismount, mountinfo also recognizes same-filesystem bind mounts.
    mounts=Path('/proc/self/mountinfo').read_text().splitlines()
    if not any(len(parts:=line.split())>5 and parts[4]==MOUNT and 'rw' in parts[5].split(',') for line in mounts):
        raise BootstrapError('BOOTSTRAP_MOUNT_NOT_VERIFIED')


def prepare_volume(mount,root_uid=0,uid=UID,gid=GID):
    """FD-relative initialization. Parameterized only for local unit tests;
    bootstrap() always calls this with pinned MOUNT and constant IDs.
    """
    flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
    fd=os.open(mount,flags)
    try:
        root=os.fstat(fd)
        if root.st_uid!=root_uid or stat.S_IMODE(root.st_mode)&0o022:raise BootstrapError('BOOTSTRAP_ROOT_OWNER_OR_MODE')
        names=set(os.listdir(fd))
        if names-{'ledger','lost+found',MARKER}:raise BootstrapError('BOOTSTRAP_UNEXPECTED_MOUNT_CONTENT')
        if 'lost+found' in names:
            info=os.stat('lost+found',dir_fd=fd,follow_symlinks=False)
            if not stat.S_ISDIR(info.st_mode) or info.st_uid!=root_uid:raise BootstrapError('BOOTSTRAP_UNSAFE_FILESYSTEM_DIR')
            # Do not traverse, chown, delete, or reinterpret filesystem recovery data.
        marker_exists=MARKER in names
        if marker_exists:
            mfd=os.open(MARKER,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
            try:
                st=os.fstat(mfd)
                if not stat.S_ISREG(st.st_mode) or st.st_uid!=root_uid or st.st_nlink!=1 or stat.S_IMODE(st.st_mode)!=0o600 or st.st_size>2048:
                    raise BootstrapError('BOOTSTRAP_UNSAFE_MARKER')
                if json.loads(os.read(mfd,2048))!=IDENTITY:raise BootstrapError('BOOTSTRAP_WRONG_VOLUME_MARKER')
            finally:os.close(mfd)
        made=False
        if 'ledger' not in names:
            if marker_exists:raise BootstrapError('BOOTSTRAP_MISSING_LEDGER')
            os.mkdir('ledger',0o700,dir_fd=fd);made=True
        child=os.open('ledger',flags,dir_fd=fd)
        try:
            st=os.fstat(child)
            if made:
                # Exactly the new empty child directory, never mount root/descendants.
                if os.listdir(child):raise BootstrapError('BOOTSTRAP_NEW_CHILD_NOT_EMPTY')
                os.fchown(child,uid,gid)
            st=os.fstat(child)
            if st.st_uid!=uid or st.st_gid!=gid or stat.S_IMODE(st.st_mode)!=0o700:raise BootstrapError('BOOTSTRAP_CHILD_OWNER_OR_MODE')
            child_names=set(os.listdir(child))
            if child_names-FILES:raise BootstrapError('BOOTSTRAP_UNEXPECTED_LEDGER_CONTENT')
            if not marker_exists and child_names:raise BootstrapError('BOOTSTRAP_UNMARKED_EXISTING_DATA')
            for name in child_names:
                st=os.stat(name,dir_fd=child,follow_symlinks=False)
                if not stat.S_ISREG(st.st_mode) or st.st_uid!=uid or st.st_gid!=gid or st.st_nlink!=1 or stat.S_IMODE(st.st_mode)&0o077:
                    raise BootstrapError('BOOTSTRAP_UNSAFE_LEDGER_FILE')
        finally:os.close(child)
        if not marker_exists:
            mfd=os.open(MARKER,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
            try:
                data=json.dumps(IDENTITY,sort_keys=True).encode()
                if os.write(mfd,data)!=len(data):raise BootstrapError('BOOTSTRAP_SHORT_MARKER_WRITE')
                os.fsync(mfd)
            finally:os.close(mfd)
            os.fsync(fd)
    finally:os.close(fd)


def no_new_privileges():
    libc=ctypes.CDLL(None,use_errno=True)
    if libc.prctl(38,1,0,0,0)!=0:raise BootstrapError('BOOTSTRAP_CANNOT_SET_NO_NEW_PRIVS')


def drop_identity():
    no_new_privileges()
    os.setgroups([])
    os.setgid(GID)
    os.setuid(UID)
    if os.getresuid()!=(UID,UID,UID) or os.getresgid()!=(GID,GID,GID) or os.getgroups():
        raise BootstrapError('BOOTSTRAP_IDENTITY_DROP_FAILED')


def bootstrap():
    if os.geteuid()!=0:raise BootstrapError('BOOTSTRAP_REQUIRES_INITIAL_ROOT')
    os.umask(0o077)
    verify_runtime(os.environ)
    prepare_volume(MOUNT)
    drop_identity()
    # API/feed imports happen ONLY in the replacement unprivileged process.
    print('DOT_PAPER_BOOTSTRAP_UID=10001 GID=10001',flush=True)
    os.chdir('/app')
    os.execve(sys.executable,[sys.executable,'-B','-E','-m','worker.main'],dict(os.environ))

if __name__=='__main__':
    try:bootstrap()
    except Exception as exc:
        # No external exception payload, paths, secrets or stack trace are logged.
        reason=str(exc) if isinstance(exc,BootstrapError) else 'BOOTSTRAP_REFUSED'
        print(reason,file=sys.stderr)
        raise SystemExit(78)
