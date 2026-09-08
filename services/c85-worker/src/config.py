"""C85 worker configuration. Every secret is read from the environment."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

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
    gateway_url: str
    ops_url: str
    gateway_secret: str
    kalshi_api_base: str
    kalshi_series: str
    heartbeat_seconds: int
    http_port: int
    allow_live_publication: bool
    lease_ttl_seconds: int


GATEWAY_PATH = "/api/public/hooks/c85-decision"
OPS_PATH = "/api/public/hooks/c85-ops"


class ConfigError(RuntimeError):
    """Startup configuration failure. Never carries a secret value."""


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def validate_endpoint_url(name: str, value: str, expected_path: str) -> None:
    """Validate a worker endpoint URL exactly as the HTTP clients consume it.

    Both BackendClient and GatewayClient POST to the configured string verbatim,
    so the string itself must be an absolute https URL whose path is the exact
    endpoint path, with no query string, fragment or credentials. Errors name the
    offending variable and echo only the URL (never C85_GATEWAY_SECRET).
    """

    # Endpoint URLs are not secrets (only C85_GATEWAY_SECRET is), so errors echo
    # the raw value to make misconfigured platform variables visible in logs.
    shown = repr(value) if len(value) <= 200 else repr(value[:200]) + "…"
    if not value or value != value.strip():
        raise ConfigError(
            f"{name} must be a non-empty URL without surrounding whitespace (raw={shown})"
        )
    parts = urlsplit(value)
    if parts.scheme not in ("https", "http"):
        raise ConfigError(
            f"{name} must start with https:// (got scheme '{parts.scheme}', raw={shown})"
        )
    if parts.scheme == "http" and parts.hostname not in ("localhost", "127.0.0.1"):
        raise ConfigError(f"{name} must use https:// for non-local hosts (raw={shown})")
    if not parts.hostname:
        raise ConfigError(f"{name} is missing a host (raw={shown})")
    if parts.username or parts.password:
        raise ConfigError(f"{name} must not embed credentials in the URL")
    if parts.query or parts.fragment:
        raise ConfigError(f"{name} must not contain a query string or fragment (raw={shown})")
    path = parts.path.rstrip("/")
    if path != expected_path:
        raise ConfigError(
            f"{name} must end with the exact path '{expected_path}' "
            f"(got '{parts.path or '/'}' on host '{parts.hostname}')"
        )


def load_settings() -> Settings:
    """Endpoint mode: the worker needs no database credentials.

    SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are deliberately NOT read. All
    persistence goes through the signed backend endpoints, authenticated with
    C85_GATEWAY_SECRET. Startup fails closed if the endpoint configuration is
    incomplete.
    """

    def req(name: str) -> str:
        value = os.environ.get(name, "")
        if not value:
            raise RuntimeError(f"missing required environment variable {name}")
        return value

    for legacy in ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"):
        if os.environ.get(legacy):
            raise RuntimeError(
                f"{legacy} must not be set on the worker: C85 runs in endpoint mode and "
                "database credentials stay inside the backend"
            )

    gateway_url = req("C85_GATEWAY_URL")
    validate_endpoint_url("C85_GATEWAY_URL", gateway_url, GATEWAY_PATH)

    explicit_ops = os.environ.get("C85_OPS_URL", "").strip()
    if explicit_ops:
        ops_url = explicit_ops
    else:
        if GATEWAY_PATH not in gateway_url:
            raise ConfigError(
                "C85_OPS_URL is not set and cannot be derived: C85_GATEWAY_URL does not "
                f"contain '{GATEWAY_PATH}'. Set C85_OPS_URL explicitly to the "
                f"'{OPS_PATH}' endpoint."
            )
        ops_url = gateway_url.replace(GATEWAY_PATH, OPS_PATH)
    validate_endpoint_url("C85_OPS_URL", ops_url, OPS_PATH)

    if _origin(gateway_url) != _origin(ops_url):
        raise ConfigError(
            "C85_GATEWAY_URL and C85_OPS_URL must share the same origin; they currently "
            f"resolve to '{_origin(gateway_url)}' and '{_origin(ops_url)}'"
        )


    return Settings(
        worker_id=os.environ.get("C85_WORKER_ID", "c85-worker-1"),
        build_sha=os.environ.get("C85_BUILD_SHA", ""),
        artifact_dir=Path(os.environ.get("C85_ARTIFACT_DIR", "/artifacts")),
        gateway_url=gateway_url,
        ops_url=ops_url,
        # .strip(): a trailing newline/space from a dashboard paste would
        # silently change every signature and surface only as a 401.
        gateway_secret=req("C85_GATEWAY_SECRET").strip(),
        kalshi_api_base=os.environ.get(
            "KALSHI_API_BASE", "https://api.elections.kalshi.com/trade-api/v2"
        ),
        kalshi_series=os.environ.get("KALSHI_SERIES_TICKER", "KXBTC15M"),
        heartbeat_seconds=int(os.environ.get("C85_HEARTBEAT_SECONDS", "15")),
        http_port=int(os.environ.get("C85_HTTP_PORT", "8080")),
        allow_live_publication=os.environ.get("C85_ALLOW_LIVE_PUBLICATION", "false").lower()
        == "true",
        lease_ttl_seconds=int(os.environ.get("C85_LEASE_TTL_SECONDS", "60")),
    )

