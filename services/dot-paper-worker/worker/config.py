from __future__ import annotations
from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)

def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def artifact_hash():
    files = sorted(p for p in ROOT.rglob('*') if p.suffix in {'.py', '.json'} and 'tests' not in p.parts and '__pycache__' not in p.parts)
    return digest({str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files})

@dataclass(frozen=True)
class Config:
    mode: str = 'PAPER'
    symbol: str = 'BTCUSD'
    quote_currency: str = 'USD'
    execution_enabled: bool = False
    initial_equity_micros: int = 10_000_000_000
    risk_bps: int = 8
    max_exposure_bps: int = 1000
    daily_loss_limit_bps: int = 100
    taker_fee_bps: int = 80
    slippage_bps: float = 1.5
    entry_latency_ms: int = 1_000
    exit_latency_ms: int = 250
    entry_timeout_ms: int = 5_000
    max_quote_age_ms: int = 2_000
    max_spread_bps: int = 10
    future_tolerance_ms: int = 500
    max_bar_delay_ms: int = 10_000
    lease_ms: int = 10_000
    max_depth_participation_bps: int = 1000
    signal_exit_latency_ms: int = 1_000
    drawdown_halt_bps: int = 500
    cooldown_ms: int = 60_000
    min_stop_bps: int = 10
    max_stop_bps: int = 500
    feed_enabled: bool = False
    feed_rights_approved: bool = False
    feed_source: str = 'KRAKEN_SPOT'
    ledger_kind: str = 'FORWARD'

    def __post_init__(self):
        if self.mode != 'PAPER' or self.symbol not in {'BTCUSDT','BTCUSD'}:
            raise ValueError('Only BTCUSDT PAPER is supported')
        if self.ledger_kind not in {'FORWARD','TEST'}:
            raise ValueError('Unknown ledger kind')
        integers = [v for v in asdict(self).values() if type(v) is int]
        if any(v < 0 or v > 10**15 for v in integers):
            raise ValueError('Configuration outside safe bounds')
        if not 0 < self.risk_bps <= 100 or not 0 < self.max_exposure_bps <= 1000:
            raise ValueError('Risk/exposure exceed hard paper limits')
        if not 0 < self.daily_loss_limit_bps <= 500:
            raise ValueError('Daily loss limit invalid')
        if not 1 <= self.taker_fee_bps <= 100 or not 1 <= self.slippage_bps <= 100:
            raise ValueError('Nonzero adverse fee/slippage required')
        if self.entry_latency_ms < 1_000 or self.exit_latency_ms < 250:
            raise ValueError('Latency below approved modeling assumptions')
        if self.entry_timeout_ms <= self.entry_latency_ms or self.max_quote_age_ms > 5000:
            raise ValueError('Invalid freshness/expiry bounds')
        if self.feed_source not in {'KRAKEN_SPOT','TEST_FIXTURE'}:
            raise ValueError('No live market-data provider approved for this build')
        if self.ledger_kind != 'TEST' and (self.symbol != 'BTCUSD' or self.quote_currency != 'USD' or self.feed_source != 'KRAKEN_SPOT'):
            raise ValueError('Only eligible Kraken USD observer supported')
        if self.execution_enabled and self.ledger_kind != 'TEST':
            raise ValueError('Strategy venue/cost parity unresolved; forward simulation entry activation blocked')
        if self.feed_enabled and not self.feed_rights_approved:
            raise ValueError('Data rights approval is required before enabling feed')

    def dict(self): return asdict(self)


def from_env():
    # No arbitrary config overrides, secrets, or real mode. Preserve frozen execution defaults.
    if os.getenv('DOT_PAPER_MODE', 'PAPER') != 'PAPER':
        raise ValueError('Real trading is not implemented')
    return Config(feed_enabled=os.getenv('DOT_PAPER_FEED_ENABLED') == 'true',
                  feed_rights_approved=os.getenv('DOT_PAPER_FEED_RIGHTS_APPROVED') == 'true')
