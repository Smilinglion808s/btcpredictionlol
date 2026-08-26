// B4x4-ES1 — RETIRED 2026-08-26.
//
// The model no longer mints predictions. Its full history stays in
// `b4x4_es1_predictions` and its CSV was archived before retirement, so this
// endpoint exists only to answer any straggling caller with a clear 410.
// The pg_cron jobs that drove it (boundary, backstop, recover) are unscheduled.

import { createFileRoute } from "@tanstack/react-router";

const retired = async () =>
  Response.json(
    {
      ok: false,
      retired: true,
      model: "b4x4-es1",
      retired_at: "2026-08-26",
      message: "B4x4-ES1 is retired; no predictions are minted.",
    },
    { status: 410 },
  );

export const Route = createFileRoute("/api/public/hooks/es1-boundary-run")({
  server: {
    handlers: {
      GET: retired,
      POST: retired,
    },
  },
});
