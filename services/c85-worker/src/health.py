"""Health and readiness endpoints for the C85 worker.

  GET /healthz   process liveness only
  GET /readyz    200 only when C85 can actually publish a faithful decision
  GET /status    full operator view: stage, progress, feeds, artifacts, blockers

/readyz fails closed. It never returns ready because the process is up.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import FastAPI
from fastapi.responses import JSONResponse


def create_app(snapshot: Callable[[], dict[str, Any]]) -> FastAPI:
    app = FastAPI(title="C85 worker", version="c85-multi-meta-r1")

    @app.get("/healthz")
    def healthz() -> dict[str, Any]:
        return {"ok": True, "at": datetime.now(timezone.utc).isoformat()}

    @app.get("/readyz")
    def readyz() -> JSONResponse:
        state = snapshot()
        ready = state.get("readiness") == "READY"
        return JSONResponse(
            status_code=200 if ready else 503,
            content={
                "ready": ready,
                "readiness": state.get("readiness"),
                "stage": state.get("stage"),
                "blocking_reason": state.get("blocking_reason"),
                "next_target_utc": state.get("next_target_utc"),
            },
        )

    @app.get("/status")
    def status() -> dict[str, Any]:
        return snapshot()

    return app
