import { createFileRoute } from "@tanstack/react-router";
import { LiteACard } from "@/components/litea-card";

export const Route = createFileRoute("/litea-preview")({
  component: Preview,
});

function Preview() {
  const stats = {
    model_version: "lite-a-floor4-top10-r1",
    phase: "LIVE_SHADOW",
    phase_detail:
      "Predicting at the start of each 15-minute interval, from that interval's first 5 seconds. No money is at stake.",
    execution_enabled: false,
    connected: true,
    heartbeat_age_s: 12,
    worker_id: "c85-worker-amsterdam-1",
    scoring_ready: true,
    head_cutoff_utc: "2026-09-11",
    head_current: true,
    latest: {
      target_open_utc: "2026-09-11T01:45:00.000Z",
      run_mode: "LIVE",
      status: "ORDINARY_CALL",
      engine_reason: "MODEL_CALL",
      gate_reasons: ["MODEL_CALL"],
      final_side: 1,
      probability_yes: 0.61,
      admission_rank: 0.65,
      scored: true,
      age_s: 120,
    },
    latest_is_live: true,
    latest_scored_age_s: 120,
    research_rows: 0,
    live: {
      opportunities: 24,
      scored: 24,
      calls: 8,
      ordinary_calls: 6,
      exception_calls: 2,
      floor_holds: 4,
      confidence_abstains: 10,
      unavailable: 2,
      wins: 5,
      losses: 3,
      pending: 0,
      win_rate: 0.625,
      net_units: 1.35,
      coverage: 0.3333,
    },
    today: {
      date: "2026-09-11",
      calls: 3,
      wins: 2,
      losses: 1,
      pending: 0,
      win_rate: 0.6667,
      net_units: 0.74,
    },
    daily: [
      { date: "2026-09-11", calls: 3, wins: 2, losses: 1, pending: 0, win_rate: 0.6667, net_units: 0.74 },
      { date: "2026-09-10", calls: 5, wins: 3, losses: 2, pending: 0, win_rate: 0.6, net_units: 0.61 },
    ],
  };
  return (
    <div className="p-6 max-w-md">
      <LiteACard stats={stats} />
    </div>
  );
}
