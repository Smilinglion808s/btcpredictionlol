"""Signed client for the app's authenticated C85 gateway.

The worker never talks to the bot directly. It posts the decision to the
application, which owns the existing webhook endpoint contract, the execution
enablement setting and the outbox. Requests are HMAC-SHA256 signed over
"<timestamp>.<body>" with the shared C85_GATEWAY_SECRET.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import httpx


class GatewayClient:
    def __init__(self, url: str, secret: str, timeout_s: float = 3.0) -> None:
        self.url = url
        self.secret = secret.encode()
        self.timeout_s = timeout_s

    def _headers(self, body: str) -> dict[str, str]:
        ts = str(int(time.time() * 1000))
        signature = hmac.new(self.secret, f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
        return {
            "content-type": "application/json",
            "x-c85-timestamp": ts,
            "x-c85-signature": signature,
        }

    async def publish(self, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload, separators=(",", ":"), allow_nan=False)
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            response = await client.post(self.url, content=body, headers=self._headers(body))
            text = response.text[:1000]
            return {"status": response.status_code, "ok": response.is_success, "body": text}
