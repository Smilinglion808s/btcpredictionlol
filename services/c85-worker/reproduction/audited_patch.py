"""Audited module-constant patching for recovered producers.

The recovered research scripts hard-code their frozen research boundary and the
frozen forward-bridge export filenames.  Extending the reconstruction past
August requires changing exactly those literals and nothing else, so every
change is recorded: the original file SHA-256, the exact replaced line, the
replacement line, and the patched SHA-256.

The patcher refuses to run when a named constant does not appear exactly once
as a module-level assignment, so a rename or a duplicated definition fails
closed instead of silently editing the wrong statement.
"""
from __future__ import annotations

import hashlib
import importlib.util
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from types import ModuleType


@dataclass(frozen=True)
class ConstantPatch:
    name: str
    original_line: str
    patched_line: str

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class PatchedModule:
    module: ModuleType
    producer: str
    original_sha256: str
    patched_sha256: str
    patches: list[ConstantPatch]

    def audit(self) -> dict:
        return {
            "producer": self.producer,
            "original_sha256": self.original_sha256,
            "patched_sha256": self.patched_sha256,
            "patches": [p.as_dict() for p in self.patches],
        }


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def patch_source(path: Path, replacements: dict[str, str]) -> tuple[str, str, str, list[ConstantPatch]]:
    original = path.read_text()
    patched = original
    records: list[ConstantPatch] = []
    for name, literal in replacements.items():
        pattern = re.compile(rf"^{re.escape(name)}\s*=\s*.+$", re.M)
        matches = list(pattern.finditer(patched))
        if len(matches) != 1:
            raise RuntimeError(
                f"{path.name}: expected exactly one module-level '{name} = ...' "
                f"assignment, found {len(matches)}; refusing to patch"
            )
        match = matches[0]
        new_line = f"{name} = {literal}"
        records.append(ConstantPatch(name, match.group(0), new_line))
        patched = patched[: match.start()] + new_line + patched[match.end() :]
    return original, patched, _sha(original), records


def load_patched(
    path: Path,
    module_name: str,
    replacements: dict[str, str],
    *,
    register: bool = True,
) -> PatchedModule:
    """Import `path` as `module_name` with only `replacements` changed."""
    original, patched, original_sha, records = patch_source(path, replacements)
    spec = importlib.util.spec_from_loader(module_name, loader=None, origin=str(path))
    if spec is None:  # pragma: no cover - defensive
        raise RuntimeError(f"cannot build import spec for {path}")
    module = importlib.util.module_from_spec(spec)
    module.__file__ = str(path)
    if register:
        sys.modules[module_name] = module
    exec(compile(patched, str(path), "exec"), module.__dict__)
    return PatchedModule(
        module=module,
        producer=str(path),
        original_sha256=original_sha,
        patched_sha256=_sha(patched),
        patches=records,
    )
