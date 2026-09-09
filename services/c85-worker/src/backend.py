"""Signed backend client. The worker holds no database credentials.

Every persistence operation goes to the application's C85 operations endpoint,
authenticated with the shared C85_GATEWAY_SECRET using the same scheme as the
decision gateway: HMAC-SHA256 over "<timestamp>.<exact request bytes>".

Each request carries a single-use nonce, so a captured request cannot be
replayed inside the freshness window. Retries mint a fresh nonce; every
operation is idempotent on its natural key, so a retried commit cannot
duplicate a decision, a settlement or an outbox record.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from typing import Any

import httpx


class BackendError(RuntimeError):
    def __init__(self, status: int, body: Any) -> None:
        super().__init__(f"c85 backend {status}: {body}")
        self.status = status
        self.body = body


class BackendClient:
    """Narrow RPC client for the enumerated C85 operations."""

    def __init__(
        self,
        ops_url: str,
        secret: str,
        worker_id: str,
        *,
        model_version: str | None = None,
        timeout_s: float = 4.0,
        retries: int = 2,
    ) -> None:
        self.ops_url = ops_url
        self.secret = secret.encode()
        self.worker_id = worker_id
        # Every signed request carries the identity its rows belong to, so a
        # reconstruction write can never land on an archived model_version.
        from .reconstruction import logging_model_version

        self.model_version = model_version or logging_model_version()
        self.timeout_s = timeout_s
        self.retries = retries
        self._client = httpx.Client(timeout=timeout_s)

    # -- transport -------------------------------------------------------------
    def _headers(self, body: str) -> dict[str, str]:
        ts = str(int(time.time() * 1000))
        signature = hmac.new(self.secret, f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
        return {
            "content-type": "application/json",
            "x-c85-timestamp": ts,
            "x-c85-signature": signature,
        }

    def call(self, op: str, **payload: Any) -> dict[str, Any]:
        # A nested decision/checkpoint carrying a different model_version than
        # the envelope would let an archived-identity row be written under a
        # reconstruction envelope (or the reverse). Stamping is not enough:
        # any disagreement is refused before the request is signed.
        for key in ("decision", "checkpoint", "prediction", "target"):
            nested = payload.get(key)
            if isinstance(nested, dict):
                nested_version = nested.get("model_version")
                if nested_version is not None and nested_version != self.model_version:
                    raise BackendError(
                        0,
                        f"C85_MODEL_VERSION_CONFLICT: {key}.model_version={nested_version!r} "
                        f"disagrees with the request identity {self.model_version!r}",
                    )
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            envelope = {
                "op": op,
                "worker_id": self.worker_id,
                "nonce": uuid.uuid4().hex,
                "model_version": self.model_version,
                **payload,
            }
            body = json.dumps(envelope, separators=(",", ":"), allow_nan=False, default=str)

            try:
                response = self._client.post(self.ops_url, content=body, headers=self._headers(body))
            except httpx.HTTPError as exc:  # transport failure — safe to retry
                last = exc
                time.sleep(0.2 * (attempt + 1))
                continue
            if response.is_success:
                return response.json()
            if response.status_code >= 500 and attempt < self.retries:
                last = BackendError(response.status_code, response.text[:400])
                time.sleep(0.2 * (attempt + 1))
                continue
            raise BackendError(response.status_code, response.text[:400])
        raise BackendError(0, str(last))

    def close(self) -> None:
        self._client.close()
