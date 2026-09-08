"""Kalshi ticker resolution, verified against real market metadata.

`main.Worker._ticker_for` formatted the ticker from the target instant while its
docstring said the stamp is the market *close*. Those two statements cannot both
be right for a 15-minute market, and guessing which one is correct would risk
publishing a decision against the neighbouring contract. So the ticker is no
longer guessed: both candidate stamps are formed and the market metadata decides.

Verification rule (fail closed):

    a candidate ticker is accepted only when the venue reports a market whose
    open/close instants are exactly [target_open, target_open + 15m).

If the API is unreachable, returns nothing, or returns a market whose window
does not match, the resolver raises and the boundary becomes an explicit MISSED
row naming the mismatch. No contract is invented for an unlisted interval.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
          "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
EASTERN = ZoneInfo("America/New_York")
INTERVAL = timedelta(minutes=15)


class TickerResolutionError(RuntimeError):
    """The target's contract could not be confirmed against market metadata."""


def format_ticker(series: str, stamp: datetime) -> str:
    """KXBTC15M-YYMMMDDHHMM in US Eastern, the venue's own convention."""
    local = stamp.astimezone(EASTERN)
    return f"{series}-{local:%y}{MONTHS[local.month - 1]}{local:%d%H%M}"


def candidates(series: str, target_open: datetime) -> dict[str, str]:
    """Both readings of the stamp, labelled by what they assume it means."""
    target_open = target_open.astimezone(timezone.utc)
    return {
        "close": format_ticker(series, target_open + INTERVAL),
        "open": format_ticker(series, target_open),
    }


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    text = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text).astimezone(timezone.utc)
    except ValueError:
        return None


def window_matches(market: dict[str, Any], target_open: datetime) -> bool:
    open_at = _parse(market.get("open_time") or market.get("open_ts"))
    close_at = _parse(market.get("close_time") or market.get("close_ts"))
    if open_at is None or close_at is None:
        return False
    return open_at == target_open.astimezone(timezone.utc) and close_at == target_open + INTERVAL


@dataclass
class StaticTickerResolver:
    """Test/replay resolver: a caller-supplied mapping, still explicit."""

    mapping: dict[str, str]

    def resolve(self, target_open: datetime) -> str:
        key = target_open.astimezone(timezone.utc).isoformat()
        if key not in self.mapping:
            raise TickerResolutionError(f"no contract supplied for {key}")
        return self.mapping[key]


class KalshiTickerResolver:
    """Resolve and verify with the venue. `fetch` returns market metadata dicts."""

    def __init__(
        self,
        series: str,
        fetch: Callable[[str], list[dict[str, Any]]],
        *,
        cache_size: int = 64,
    ) -> None:
        self.series = series
        self.fetch = fetch
        self.cache_size = cache_size
        self._cache: dict[str, str] = {}

    def resolve(self, target_open: datetime) -> str:
        target_open = target_open.astimezone(timezone.utc)
        key = target_open.isoformat()
        if key in self._cache:
            return self._cache[key]

        tried: list[str] = []
        for meaning, ticker in candidates(self.series, target_open).items():
            try:
                markets = self.fetch(ticker) or []
            except Exception as exc:  # noqa: BLE001
                raise TickerResolutionError(
                    f"market metadata lookup failed for {ticker}: {type(exc).__name__}: {exc}"
                ) from exc
            for market in markets:
                if window_matches(market, target_open):
                    if len(self._cache) >= self.cache_size:
                        self._cache.pop(next(iter(self._cache)))
                    self._cache[key] = ticker
                    return ticker
            tried.append(f"{ticker} ({meaning}-stamped)")
        raise TickerResolutionError(
            "no listed market with window "
            f"[{target_open.isoformat()}, {(target_open + INTERVAL).isoformat()}); tried "
            + ", ".join(tried)
        )
