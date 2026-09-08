"""Load a recovered producer with only its research END constant overridden.

Requirements this satisfies:
  * feature definitions, fitting schedules, source venues and model rules are
    untouched — the loader refuses to run if it would change more than the
    single `END = pd.Timestamp("...")` assignment;
  * every patch is auditable — the original file SHA-256, the replaced line and
    the replacement line are recorded and stored in the stage checkpoint;
  * historical-prefix parity — with C85_RESEARCH_END pinned to the frozen end
    the patched source is byte-identical to the original.
"""
from __future__ import annotations

import hashlib
import importlib.util
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from types import ModuleType

import pandas as pd

END_NAMES = r"END|END_EXCLUSIVE|FORMAL_END_EXCLUSIVE"

PATTERNS = {
    "pd": re.compile(
        rf'^(?P<name>{END_NAMES})\s*=\s*pd\.Timestamp\(\s*"[^"]+"\s*\)\s*$', re.M),
    "datetime": re.compile(
        rf'^(?P<name>{END_NAMES})\s*=\s*datetime\([^)\n]*\)\s*$', re.M),
}


@dataclass(frozen=True)
class PatchRecord:
    producer: str
    original_sha256: str
    patched_sha256: str
    original_line: str
    patched_line: str

    def as_dict(self) -> dict:
        return asdict(self)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _find(original: str) -> tuple[re.Match, str]:
    for kind, pattern in PATTERNS.items():
        matches = list(pattern.finditer(original))
        if len(matches) == 1:
            return matches[0], kind
        if len(matches) > 1:
            raise RuntimeError(f"ambiguous research-end constant ({len(matches)} matches)")
    raise RuntimeError("no research-end constant found; refusing to patch")


def patch_source(path: Path, end: pd.Timestamp) -> tuple[str, PatchRecord]:
    original = Path(path).read_text()
    match, kind = _find(original)
    name = match.group("name")
    if kind == "pd":
        literal = f'pd.Timestamp("{end.isoformat().replace("+00:00", "Z")}")'
    else:
        literal = (f"datetime({end.year}, {end.month}, {end.day}, {end.hour}, "
                   f"{end.minute}, tzinfo=timezone.utc)")
    replacement = f"{name} = {literal}"
    patched = original[: match.start()] + replacement + original[match.end():]
    if original.replace(match.group(0), replacement, 1) != patched:
        raise RuntimeError(f"{path}: patch touched more than the research-end constant")
    return patched, PatchRecord(
        producer=str(path),
        original_sha256=_sha(original),
        patched_sha256=_sha(patched),
        original_line=match.group(0),
        patched_line=replacement,
    )


def load_producer(path: Path, end: pd.Timestamp, name: str | None = None
                  ) -> tuple[ModuleType, PatchRecord]:
    path = Path(path)
    patched, record = patch_source(path, end)
    module_name = name or f"c85_producer_{record.patched_sha256[:12]}"
    spec = importlib.util.spec_from_loader(module_name, loader=None, origin=str(path))
    module = importlib.util.module_from_spec(spec)
    module.__file__ = str(path)
    sys.modules[module_name] = module
    exec(compile(patched, str(path), "exec"), module.__dict__)
    name = record.patched_line.split("=")[0].strip()
    if pd.Timestamp(getattr(module, name)) != end:
        raise RuntimeError(f"{path}: {name} override did not take effect")
    return module, record
