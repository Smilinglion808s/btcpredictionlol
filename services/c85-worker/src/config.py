"""C85 worker configuration. Every secret is read from the environment."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

MODEL_VERSION = os.environ.get("C85_MODEL_VERSION", "c85-multi-meta-r1")
DISPLAY_NAME = "C85"
RESEARCH_CANDIDATE = "MULTI_META"
MARKET = "BTC 15-minute Kalshi"

# Invariants. These are model identity, not tunables.
AUTHORITY_SHA256 = "5216419766e0221d19945eee1cea0734904c578d5f5fa38fa0edf3679625a3a3"
PUBLICATION_DEADLINE_MS = int(os.environ.get("C85_PUBLICATION_DEADLINE_MS", "5000"))
COMPUTE_BUDGET_MS = int(os.environ.get("C85_COMPUTE_BUDGET_MS", "1200"))
TARGET_INTERVAL_MS = 15 * 60 * 1000

# Policy constants, taken from the original source. Do not tune.
RANK_HISTORY = 768
RANK_MINIMUM = 96
YES_ADMISSION_RANK = 0.50
NO_ADMISSION_RANK = 0.70
EXTENSION_MIN_DISTANCE = 0.03
FILTER_RANK_FLOOR = 0.40
DETERIORATION_INIT = 0.60
DETERIORATION_SPANS = (16, 32, 64, 128)
DETERIORATION_MINIMUM = 128
DETERIORATION_ODDS = 1.8  # legacy model rule; the 1.87 display odds never enter here
DETERIORATION_GAP = 0.08

# Walk-forward recipe (frozen).
TRAIN_WINDOW_ROWS = 8640
TRAIN_MINIMUM_ROWS = 672
LOGISTIC_C = 0.003
LOGISTIC_SOLVER = "lbfgs"
LOGISTIC_MAX_ITER = 5000
LOGISTIC_RANDOM_STATE = 57
ROBUST_QUANTILE_RANGE = (10, 90)

# Monthly auxiliary recipe (frozen).
AUX_MIN_ROWS = 5000
AUX_RECENT_DAYS = 90
AUX_PARAMS = dict(
    max_iter=100,
    learning_rate=0.04,
    max_leaf_nodes=7,
    min_samples_leaf=256,
    l2_regularization=10,
    max_bins=64,
    random_state=85,
    early_stopping=False,
)

# Bankroll display convention (presentation only, never a model threshold).
BANKROLL_INITIAL_USD = 500
BANKROLL_BASIS_POINTS = 400
BANKROLL_WIN_PROFIT_PCT = 87
BANKROLL_RESET = "daily"
DISPLAY_TIMEZONE = "America/Boise"

# Variants that are explicitly not this model.
EXCLUDED_VARIANTS = ("LONG_META", "LONG_BOTH", "MULTI_BOTH", "C81", "T45", "PF2", "PF8")


@dataclass(frozen=True)
class Settings:
    worker_id: str
    build_sha: str
    artifact_dir: Path
    supabase_url: str
    supabase_service_key: str
    gateway_url: str
    gateway_secret: str
    kalshi_api_base: str
    kalshi_series: str
    heartbeat_seconds: int
    http_port: int
    allow_live_publication: bool


def load_settings() -> Settings:
    def req(name: str) -> str:
        value = os.environ.get(name, "")
        if not value:
            raise RuntimeError(f"missing required environment variable {name}")
        return value

    return Settings(
        worker_id=os.environ.get("C85_WORKER_ID", "c85-worker-1"),
        build_sha=os.environ.get("C85_BUILD_SHA", ""),
        artifact_dir=Path(os.environ.get("C85_ARTIFACT_DIR", "/artifacts")),
        supabase_url=req("SUPABASE_URL"),
        supabase_service_key=req("SUPABASE_SERVICE_ROLE_KEY"),
        gateway_url=req("C85_GATEWAY_URL"),
        gateway_secret=req("C85_GATEWAY_SECRET"),
        kalshi_api_base=os.environ.get(
            "KALSHI_API_BASE", "https://api.elections.kalshi.com/trade-api/v2"
        ),
        kalshi_series=os.environ.get("KALSHI_SERIES_TICKER", "KXBTC15M"),
        heartbeat_seconds=int(os.environ.get("C85_HEARTBEAT_SECONDS", "15")),
        http_port=int(os.environ.get("C85_HTTP_PORT", "8080")),
        allow_live_publication=os.environ.get("C85_ALLOW_LIVE_PUBLICATION", "false").lower()
        == "true",
    )
