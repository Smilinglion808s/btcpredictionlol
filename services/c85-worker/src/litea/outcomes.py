"""Version 1's official-outcome producer.

Nothing else in this process writes settlements. `settlement_loop` only READS
`settlements.pending`, and the feeds and ticker resolver never record an
outcome, so without this module a recorded opportunity would stay unlabelled
forever: the guard's open exposure would never close, the rolling training
frame would never gain a label, and no daily fit could ever become eligible.

What it does, and only this:

  * collects the opportunities Version 1 itself recorded and still has no
    official label for — unlabelled rows in the rolling training frame, plus
    every ticker the daily floor is still holding open (a restored pending call
    is included even when its row predates this container);
  * asks the venue for that contract's own market record;
  * writes a signed `settlements.record` with the OFFICIAL result, the venue's
    own settlement instant, and — separately — the instant this worker first
    observed it. The two are never conflated;
  * leaves application to `LiteAWorker.apply_settlements`, which is idempotent
    on `ticker@target_open_utc`, so a replayed poll cannot credit a day twice.

There is no price-proxy label anywhere: a market with no `result` yet simply
produces no settlement record. No prediction row of any other model is touched.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

from .identity import MODEL_ID
from .reconstruct import kalshi_market_record

SOURCE = "kalshi_official"
#: A 15-minute market cannot be settled before its own close.
SETTLE_AFTER = timedelta(minutes=15, seconds=30)
#: One poll asks about at most this many contracts, oldest first.
MAX_PER_POLL = 32


class OfficialOutcomes:
    def __init__(self, service: Any, max_per_poll: int = MAX_PER_POLL) -> None:
        self.service = service
        self.max_per_poll = max_per_poll
        #: tickers whose market answered "no result yet"; retried next poll.
        self.last_report: dict[str, Any] = {"status": "NOT_RUN"}

    # -- what is still open ----------------------------------------------------
    def unresolved(self, now: datetime | None = None) -> list[tuple[pd.Timestamp, str]]:
        now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        due = pd.Timestamp(now) - SETTLE_AFTER
        frame = self.service.training.frame
        consumed = set(self.service.state.cursors.consumed_settlements)

        out: dict[str, tuple[pd.Timestamp, str]] = {}

        def add(ts: Any, ticker: Any) -> None:
            if not ticker or str(ticker).startswith("UNVERIFIED-"):
                return
            stamp = pd.Timestamp(ts)
            if f"{ticker}@{stamp.isoformat()}" in consumed:
                return
            out[f"{ticker}@{stamp.isoformat()}"] = (stamp, str(ticker))

        if not frame.empty:
            unlabelled = frame[frame.label.isna() & (frame.ts <= due)]
            for row in unlabelled.tail(self.max_per_poll * 4).itertuples():
                add(row.ts, row.ticker)

            # Every call the daily floor is still holding open, even one
            # restored from a checkpoint older than this training snapshot.
            by_ticker = frame.set_index("ticker").ts
            for ticker in self.service.state.guard.pending:
                if ticker in by_ticker.index:
                    stamp = by_ticker.loc[ticker]
                    add(stamp.iloc[-1] if hasattr(stamp, "iloc") else stamp, ticker)

        ordered = sorted(out.values(), key=lambda item: item[0])
        return ordered[: self.max_per_poll]

    # -- the poll --------------------------------------------------------------
    def poll(self, now: datetime | None = None) -> dict[str, Any]:
        now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        pending = self.unresolved(now)
        settlements: list[dict[str, Any]] = []
        errors: list[str] = []

        for stamp, ticker in pending:
            market = kalshi_market_record(ticker)
            if market.get("error"):
                errors.append(f"{ticker}: {market['error']}")
                continue
            label = market.get("label")
            if label not in (1, -1) or not market.get("settlement_ts"):
                continue  # not settled yet; asked again next poll
            settlements.append(
                {
                    "ticker": ticker,
                    "target_open_utc": stamp.tz_convert("UTC").isoformat(),
                    "settlement_source": SOURCE,
                    "official_result": market.get("result"),
                    "label": int(label),
                    "settlement_ts": str(market["settlement_ts"]),
                    "raw_payload": {
                        "model_id": MODEL_ID,
                        # The venue's own settlement instant and OUR first
                        # observation of it are different measurements.
                        "first_observed_utc": now.isoformat(),
                        "floor_strike": market.get("floor_strike"),
                        "market_ticker": market.get("ticker"),
                    },
                }
            )

        recorded = 0
        if settlements:
            try:
                result = self.service.store.record_settlements(settlements)
                recorded = int(result.get("recorded") or 0)
            except Exception as exc:  # noqa: BLE001 — retried on the next poll
                errors.append(f"record: {type(exc).__name__}: {exc}")

        self.last_report = {
            "status": "POLLED",
            "at": now.isoformat(),
            "unresolved": len(pending),
            "settled": len(settlements),
            "recorded": recorded,
            "errors": errors[:5],
        }
        return self.last_report
