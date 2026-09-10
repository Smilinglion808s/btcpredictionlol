"""The rolling training frame for Version 1.

One chronological table, one row per recorded opportunity:

    ts, ticker, input_valid, label, settlement_ts, <the 60 direction columns>

It is the ONLY thing the daily fit reads. Rows are appended as targets are
decided and labels arrive; nothing is ever rewritten, and a row's features are
the ones that were actually frozen at that target's own T+5 cutoff.

The frame is persisted as a Parquet file under a version-scoped private key, so
a fresh container restores it instead of rebuilding history.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import pandas as pd

from ..features import DIRECTION_ORDER

COLUMNS = ["ts", "ticker", "input_valid", "label", "settlement_ts", *DIRECTION_ORDER]


def _normalise(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame.copy()
    out["ts"] = pd.to_datetime(out["ts"], utc=True)
    out["settlement_ts"] = pd.to_datetime(out["settlement_ts"], utc=True)
    out["input_valid"] = out["input_valid"].astype(bool)
    out["label"] = pd.to_numeric(out["label"], errors="coerce")
    for name in DIRECTION_ORDER:
        out[name] = pd.to_numeric(out[name], errors="coerce").astype(float)
    out = out[COLUMNS]
    out = out.sort_values("ts", kind="stable")
    out = out.drop_duplicates(subset="ts", keep="last").reset_index(drop=True)
    if not out.ts.is_monotonic_increasing or not out.ts.is_unique:
        raise ValueError("LITEA_TRAINING_NOT_CHRONOLOGICAL")
    return out


class TrainingFrame:
    def __init__(self, frame: pd.DataFrame) -> None:
        self.frame = _normalise(frame)

    # -- construction ----------------------------------------------------------
    @classmethod
    def empty(cls) -> "TrainingFrame":
        return cls(pd.DataFrame(columns=COLUMNS))

    @classmethod
    def load(cls, path: str | Path) -> "TrainingFrame":
        return cls(pd.read_parquet(path))

    def save(self, path: str | Path) -> str:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        self.frame.to_parquet(temporary, index=False)
        temporary.replace(path)
        return self.sha256

    # -- identity --------------------------------------------------------------
    @property
    def sha256(self) -> str:
        """Content hash of the frame itself, independent of file encoding."""
        digest = hashlib.sha256()
        for name in COLUMNS:
            column = self.frame[name]
            if name in ("ts", "settlement_ts"):
                values = column.astype("int64").to_numpy()
            elif name == "ticker":
                digest.update("\u0000".join(column.astype(str)).encode())
                continue
            else:
                values = pd.to_numeric(column, errors="coerce").to_numpy(float)
            digest.update(values.tobytes())
        return digest.hexdigest()

    @property
    def rows(self) -> int:
        return len(self.frame)

    @property
    def last_target(self) -> str | None:
        return None if self.frame.empty else self.frame.ts.iloc[-1].isoformat()

    # -- mutation --------------------------------------------------------------
    def append(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        self.frame = _normalise(pd.concat([self.frame, pd.DataFrame(rows)], ignore_index=True))

    def apply_label(self, ts: Any, label: int, settlement_ts: Any) -> bool:
        """Attach an official settled label to an existing recorded row."""
        moment = pd.to_datetime(ts, utc=True)
        hit = self.frame.index[self.frame.ts == moment]
        if len(hit) != 1:
            return False
        self.frame.loc[hit[0], "label"] = int(label)
        self.frame.loc[hit[0], "settlement_ts"] = pd.to_datetime(settlement_ts, utc=True)
        return True

    # -- fitting support -------------------------------------------------------
    def features(self) -> pd.DataFrame:
        return self.frame[list(DIRECTION_ORDER)]

    def midnight_positions(self, after: str | None = None) -> list[int]:
        """Row positions at a UTC-midnight target, in order.

        A daily fit happens at an AVAILABLE UTC-midnight target, which is the
        supplied protocol's own rule; a missing midnight target means that day
        has no fit and the previous head expires unreplaced.
        """
        ts = self.frame.ts
        mask = (ts == ts.dt.normalize()).to_numpy()
        positions = [int(i) for i in range(len(ts)) if mask[i]]
        if after is not None:
            bound = pd.to_datetime(after, utc=True)
            positions = [i for i in positions if ts.iloc[i] > bound]
        return positions
