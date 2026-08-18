// Regression coverage for the B4x4-ES1 Dual-Venue Adaptive R1 readiness
// handoff. Rows mirror the persisted exact-target Binance boundary features
// for 2026-08-18 00:45Z .. 01:45Z (activation 2026-08-18T00:45:00Z).

import { describe, expect, it } from "vitest";
import {
  BINANCE_OB_COLLECTOR_VERSION,
  BINANCE_OB_SYMBOL,
  BINANCE_OB_VENUE,
  BINANCE_OB_VERSION,
  binanceObConfigHash,
  binanceObFeatureSchemaHash,
} from "../binanceOb/config";
import { marketReadinessFrom } from "../balanced";
import { decideDualAdaptive } from "../dualAdaptive";

const ACTIVATION_TS = "2026-08-18T00:45:00.000Z";

/** A healthy persisted boundary-feature row: FRESH, 59/59, sequence-valid. */
function featureRow(
  targetTs: string,
  marketKind: "SPOT" | "USD_M_PERP",
  finalImbalance: number,
  mean60: number,
  ageMs = 2286,
): Record<string, unknown> {
  const gen = marketKind === "SPOT" ? 24 : 9;
  return {
    id: `${targetTs}-${marketKind}`,
    target_ts: targetTs,
    market_kind: marketKind,
    venue: BINANCE_OB_VENUE,
    symbol: BINANCE_OB_SYMBOL,
    feature_version: BINANCE_OB_VERSION,
    collector_version: BINANCE_OB_COLLECTOR_VERSION,
    implementation_revision: "binance-ob-r1-repair1",
    config_hash: binanceObConfigHash(),
    feature_schema_hash: binanceObFeatureSchemaHash(),
    capture_status: "FRESH",
    ready: true,
    ready_reason: "READY",
    sequence_ok: true,
    book_complete_10bps: true,
    resync_continuous: true,
    resync_generation_min: gen,
    resync_generation_max: gen,
    observation_count_60s: 59,
    final_received_at: targetTs,
    final_exchange_event_ts: targetTs,
    final_target_age_ms: ageMs,
    final_imbalance_10bps: finalImbalance,
    mean_imbalance_10bps_60s: mean60,
    history_ready: true,
  };
}

interface Boundary {
  targetTs: string;
  spot: [number, number];
  perp: [number, number];
  spotDirection: "RED" | "GREEN";
  perpDirection: "RED" | "GREEN";
  publish: "RED" | "GREEN" | null;
}

const BOUNDARIES: Boundary[] = [
  {
    targetTs: "2026-08-18T00:45:00.000Z",
    spot: [0.104859229485161, 0.0112260913169335],
    perp: [0.0367136496804999, 0.0691985229437502],
    spotDirection: "RED",
    perpDirection: "RED",
    publish: "RED",
  },
  {
    targetTs: "2026-08-18T01:00:00.000Z",
    spot: [0.0474907223283022, 0.07719571370793],
    perp: [0.0263890806044315, -0.0794934085480944],
    spotDirection: "RED",
    perpDirection: "GREEN",
    publish: null,
  },
  {
    targetTs: "2026-08-18T01:15:00.000Z",
    spot: [0.000407743801092651, -0.0142393550841662],
    perp: [-0.0746755568439873, -0.0507405427100888],
    spotDirection: "GREEN",
    perpDirection: "GREEN",
    publish: "GREEN",
  },
  {
    targetTs: "2026-08-18T01:30:00.000Z",
    spot: [0.0888694177191879, 0.0478802349811014],
    perp: [-0.0480273389199534, 0.0378772521969314],
    spotDirection: "RED",
    perpDirection: "RED",
    publish: "RED",
  },
  {
    targetTs: "2026-08-18T01:45:00.000Z",
    spot: [0.041296008986653, 0.110591259136871],
    perp: [0.203233446447013, -0.0166755680311317],
    spotDirection: "RED",
    perpDirection: "GREEN",
    publish: null,
  },
];

function decide(b: Boundary) {
  const spotRow = featureRow(b.targetTs, "SPOT", b.spot[0], b.spot[1]);
  const perpRow = featureRow(b.targetTs, "USD_M_PERP", b.perp[0], b.perp[1]);
  const spot = marketReadinessFrom(spotRow, { targetTs: b.targetTs });
  const perp = marketReadinessFrom(perpRow, { targetTs: b.targetTs });
  return {
    spot,
    perp,
    decision: decideDualAdaptive({
      targetTs: b.targetTs,
      spot,
      perp,
      activationTargetTs: ACTIVATION_TS,
    }),
  };
}

describe("dual-adaptive readiness handoff", () => {
  it("maps healthy persisted boundary rows to a passing gate", () => {
    for (const b of BOUNDARIES) {
      const { spot, perp } = decide(b);
      expect(spot.gateReason, `${b.targetTs} spot`).toBeNull();
      expect(perp.gateReason, `${b.targetTs} perp`).toBeNull();
      expect(spot.ready).toBe(true);
      expect(perp.ready).toBe(true);
    }
  });

  it("accepts the existing OB source identity (binance-ob-r1 / repair1)", () => {
    const b = BOUNDARIES[0]!;
    const row = featureRow(b.targetTs, "SPOT", b.spot[0], b.spot[1]);
    expect(row.feature_version).toBe("binance-ob-r1");
    expect(row.implementation_revision).toBe("binance-ob-r1-repair1");
    expect(marketReadinessFrom(row, { targetTs: b.targetTs }).gateReason).toBeNull();
  });

  it("replays the frozen five boundaries: 3 publishes, 2 disagreement abstains", () => {
    const results = BOUNDARIES.map((b) => ({ b, ...decide(b) }));
    for (const { b, decision } of results) {
      expect(decision.spot.direction, `${b.targetTs} spot dir`).toBe(b.spotDirection);
      expect(decision.perp.direction, `${b.targetTs} perp dir`).toBe(b.perpDirection);
      expect(decision.finalPrediction, `${b.targetTs} publish`).toBe(b.publish);
      expect(decision.wouldTrade).toBe(b.publish != null);
      expect(decision.decisionReason).toBe(
        b.publish
          ? "PUBLISH_DUAL_ADAPTIVE_SPOT_PERP_AGREE"
          : "ABSTAIN_DUAL_ADAPTIVE_VENUE_DECISIONS_DISAGREE",
      );
    }
    expect(results.filter((r) => r.decision.wouldTrade)).toHaveLength(3);
    expect(results.filter((r) => !r.decision.wouldTrade)).toHaveLength(2);
  });

  it("never reports NO_MARKET_READINESS for a present, healthy market", () => {
    for (const b of BOUNDARIES) {
      const { decision } = decide(b);
      expect(decision.spot.gateReason).toBeNull();
      expect(decision.perp.gateReason).toBeNull();
      expect(decision.detailedReason ?? "").not.toContain("NO_MARKET_READINESS");
    }
  });

  it("abstains before activation and keeps every readiness gate enforced", () => {
    const b = BOUNDARIES[0]!;
    const spot = marketReadinessFrom(featureRow(b.targetTs, "SPOT", b.spot[0], b.spot[1]), {
      targetTs: b.targetTs,
    });
    const perp = marketReadinessFrom(featureRow(b.targetTs, "USD_M_PERP", b.perp[0], b.perp[1]), {
      targetTs: b.targetTs,
    });
    expect(
      decideDualAdaptive({ targetTs: b.targetTs, spot, perp, activationTargetTs: null })
        .decisionReason,
    ).toBe("ABSTAIN_DUAL_ADAPTIVE_ACTIVATION_NOT_REACHED");

    const cases: [Record<string, unknown>, string][] = [
      [{ capture_status: "STALE" }, "CAPTURE_NOT_FRESH"],
      [{ ready: false, ready_reason: "X" }, "NOT_READY_X"],
      [{ sequence_ok: false }, "SEQUENCE_NOT_OK"],
      [{ book_complete_10bps: false }, "BOOK_INCOMPLETE_10BPS"],
      [{ resync_continuous: false }, "RESYNC_NOT_CONTINUOUS"],
      [{ resync_generation_max: 99 }, "RESYNC_GENERATION_SPLIT"],
      [{ observation_count_60s: 10 }, "INSUFFICIENT_OBSERVATIONS"],
      [{ final_target_age_ms: 50_000 }, "TARGET_AGE_OUT_OF_RANGE"],
      [{ final_received_at: null }, "NO_FINAL_OBSERVATION"],
      [{ target_ts: "2026-08-18T02:00:00.000Z" }, "TARGET_TS_MISMATCH"],
      [{ config_hash: "deadbeef" }, "CONFIG_HASH_MISMATCH"],
    ];
    for (const [patch, reason] of cases) {
      const row = { ...featureRow(b.targetTs, "SPOT", b.spot[0], b.spot[1]), ...patch };
      expect(marketReadinessFrom(row, { targetTs: b.targetTs }).gateReason, reason).toBe(reason);
    }
  });
});
