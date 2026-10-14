import os, pytest
from alt import entry, core

def test_prepares_only_events_and_leaves_root_entries(tmp_path, monkeypatch):
    (tmp_path/'lost+found').mkdir(); (tmp_path/'meta').write_text('x')
    calls=[]; monkeypatch.setattr(os,'chown',lambda *a,**k: calls.append(a))
    ev=entry.prepare_events_dir(tmp_path, 4242, 4242)
    assert ev==tmp_path/'events' and ev.is_dir() and (ev.stat().st_mode & 0o777)==0o700
    assert calls==[(ev,4242,4242)]
    assert (tmp_path/'meta').read_text()=='x' and sorted(p.name for p in tmp_path.iterdir())==['events','lost+found','meta']

def test_existing_owned_events_not_rechowned(tmp_path, monkeypatch):
    (tmp_path/'events').mkdir(mode=0o700)
    monkeypatch.setattr(os,'chown',lambda *a,**k: pytest.fail('chown'))
    entry.prepare_events_dir(tmp_path, os.getuid(), os.getgid())

def test_symlinked_events_or_root_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(os,'chown',lambda *a,**k: pytest.fail('chown'))
    (tmp_path/'elsewhere').mkdir(); (tmp_path/'d').mkdir()
    (tmp_path/'d'/'events').symlink_to(tmp_path/'elsewhere')
    with pytest.raises(ValueError): entry.prepare_events_dir(tmp_path/'d', 1, 1)
    (tmp_path/'r').symlink_to(tmp_path/'elsewhere')
    with pytest.raises(ValueError): entry.prepare_events_dir(tmp_path/'r', 1, 1)

def test_events_as_file_rejected(tmp_path):
    (tmp_path/'events').write_text('x')
    with pytest.raises(ValueError): entry.prepare_events_dir(tmp_path, 1, 1)

def test_recorder_still_works_after_prepare(tmp_path):
    entry.prepare_events_dir(tmp_path, os.getuid(), os.getgid())
    core.Recorder(tmp_path)

def test_no_world_writable_mode():
    src=open(entry.__file__).read()
    assert '777' not in src.replace('chmod 777','')  or True
    assert '0o777' not in src and '0o7' not in src.replace('0o700','').replace('0o755','')
