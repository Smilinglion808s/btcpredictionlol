"""Daily UTC-midnight refitting for Version 1.

The numerical protocol lives entirely in the supplied `fit.fit_daily` and is
not restated or altered here: prior 8,640 recorded opportunities, only rows
that were `input_valid`, carry a +/-1 official label and settled STRICTLY
before the cutoff, minimum 672 with both classes present, median imputation,
RobustScaler(10, 90), equal total weight per represented UTC day, logistic
C=.003 / lbfgs / max_iter 5000 / random_state 57.

This module only decides WHEN a fit is due and WHERE the head lands. Fitting is
off the timed score path.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .fit import fit_daily
from .heads import DailyHeadStore
from .training import TrainingFrame


@dataclass
class FitResult:
    cutoff: str
    fitted: bool
    reason: str | None = None
    head_id: str | None = None
    train_rows: int | None = None
    valid_until_exclusive: str | None = None


def run_due_fits(
    training: TrainingFrame,
    heads: DailyHeadStore,
    *,
    after: str | None = None,
) -> list[FitResult]:
    """Fit every UTC-midnight target after `after`, chronologically.

    A day whose eligible-label count is short returns `fitted=False` with the
    protocol's own reason. No head is invented for it, and the previous head
    still expires: the model abstains on that day rather than scoring stale.
    """
    frame = training.frame
    features = training.features()
    results: list[FitResult] = []
    for position in training.midnight_positions(after=after):
        cutoff = frame.ts.iloc[position]
        payload: dict[str, Any] | None = fit_daily(frame, features, position)
        if payload is None:
            results.append(
                FitResult(
                    cutoff=cutoff.isoformat(),
                    fitted=False,
                    reason=(
                        "LITEA_FIT_INELIGIBLE: fewer than 672 prior rows that were "
                        "input_valid, labelled +/-1 and settled strictly before the "
                        "cutoff, or only one class present"
                    ),
                )
            )
            continue
        _, head_id = heads.save(payload)
        results.append(
            FitResult(
                cutoff=cutoff.isoformat(),
                fitted=True,
                head_id=head_id,
                train_rows=payload.get("train_rows"),
                valid_until_exclusive=payload.get("valid_until_exclusive"),
            )
        )
    return results
