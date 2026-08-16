// B4x4-ES1 Binance Order-Book R1 — deterministic test suite.
// Synthetic streams only; no network, no database, no clock dependence.

import { describe, expect, it } from "vitest";
import {
  BINANCE_OB_POLICIES,
  EXPECTED_OBSERVATIONS,
  HISTORY_WINDOW,
  MIN_READY_OBSERVATIONS,
  OBS_END_OFFSET_S,
  POLICY_DEFINITIONS,
} from "../config";
import { evaluateObservationTiming, featureCutoffTs, partitionByTiming } from "../timing";
import {
  computeBoundaryFeatures,
  empiricalRank,
  olsSlope,
  signChangeCount,
  signPersistence,
} from "../features";
import type { ObservationRow } from "../types";
import { evaluateAllPolicies, evaluatePolicy, mapDirection, scorePolicy } from "../policies";
import { classifyMissingBoundary } from "../watchdog.server";
import { observationKey, processIngest, type IngestDeps, type IngestObservation } from "../ingest";
import { buildCombinedRows, combinedColumns, rowsToCsv } from "../exports";
import { CollectorRuntime, COLLECTOR_EVENTS } from "../../../../../services/binance-ob-collector/src/runtimeEvents.js";
import { isCollectorReportableEvent } from "../audit";

const TARGET = "2026-01-05T18:00:00.000Z";
const TARGET_MS = Date.parse(TARGET);
const CUTOFF_MS = TARGET_MS - 2000;

function obs(offset: number, over: Record<string, unknown> = {}) {
  const sample = TARGET_MS - offset * 1000;
  return {
    target_ts: TARGET,
    market_kind: "SPOT" as const,
    sample_offset_seconds: offset,
    sample_ts: new Date(sample).toISOString(),
    feature_cutoff_ts: featureCutoffTs(TARGET),
    received_at: new Date(sample).toISOString(),
    exchange_event_ts: new Date(sample - 40).toISOString(),
    exchange_to_receive_ms: 40,
    target_age_ms: offset * 1000,
    last_update_id: 1000 + (60 - offset),
    sequence_ok: true,
    local_book_initialized: true,
    book_complete_10bps: true,
    resync_generation: 0,
    best_bid: 100000,
    best_ask: 100000.5,
    mid_price: 100000.25,
    spread_bps: 0.05,
    microprice_displacement_bps: 0.01,
    bid_depth_btc_10bps: 12,
    ask_depth_btc_10bps: 8,
    total_depth_btc_10bps: 20,
    total_depth_usd_10bps: 2_000_000,
    imbalance_1bps: 0.1,
    imbalance_2bps: 0.15,
    imbalance_5bps: 0.18,
    imbalance_10bps: 0.2,
    normalized_ofi_1s: 0.05,
    bid_added_btc_1s: 1,
    ask_added_btc_1s: 0.5,
    collector_version: "binance-ob-collector-r1",
    ...over,
  } as unknown as ObservationRow & IngestObservation;
}

const fullStream = () =>
  Array.from({ length: EXPECTED_OBSERVATIONS }, (_, i) => obs(OBS_END_OFFSET_S + i));

const history = (n = HISTORY_WINDOW) => ({
  absImbalance: Array.from({ length: n }, (_, i) => i / 1000),
  totalDepth: Array.from({ length: n }, (_, i) => 10 + i / 100),
  spread: Array.from({ length: n }, (_, i) => 0.01 + i / 10000),
});

describe("timing — T-2s eligibility", () => {
  it("accepts a sample exactly at the cutoff", () => {
    expect(evaluateObservationTiming(obs(2)).eligible).toBe(true);
  });

  it("accepts the window start at T-60s and rejects T-61s", () => {
    expect(evaluateObservationTiming(obs(60)).eligible).toBe(true);
    const early = obs(61);
    expect(evaluateObservationTiming({ ...early, sample_offset_seconds: undefined }).reason).toBe(
      "SAMPLE_BEFORE_WINDOW_START",
    );
  });

  it("rejects a sample after the cutoff", () => {
    const late = obs(1);
    expect(evaluateObservationTiming({ ...late, sample_offset_seconds: undefined }).reason).toBe(
      "SAMPLE_AFTER_CUTOFF",
    );
  });

  it("rejects on receive time even when the exchange event predates the cutoff", () => {
    const row = obs(2, { received_at: new Date(CUTOFF_MS + 1).toISOString() });
    expect(evaluateObservationTiming(row).reason).toBe("RECEIVED_AFTER_CUTOFF");
  });

  it("rejects an exchange event at or after the target", () => {
    expect(evaluateObservationTiming(obs(2, { exchange_event_ts: TARGET })).reason).toBe(
      "EXCHANGE_EVENT_NOT_BEFORE_TARGET",
    );
  });

  it("rejects a declared cutoff that disagrees with the target", () => {
    expect(
      evaluateObservationTiming(obs(2, { feature_cutoff_ts: new Date(TARGET_MS - 1000).toISOString() }))
        .reason,
    ).toBe("CUTOFF_TS_MISMATCH");
  });

  it("rejects a non-boundary target and an inconsistent offset", () => {
    expect(evaluateObservationTiming(obs(2, { target_ts: "2026-01-05T18:03:00.000Z" })).reason).toBe(
      "TARGET_NOT_15M_BOUNDARY",
    );
    expect(evaluateObservationTiming(obs(2, { sample_offset_seconds: 7 })).reason).toBe(
      "OFFSET_INCONSISTENT_WITH_SAMPLE_TS",
    );
  });

  it("partitions a mixed batch and never mutates timestamps", () => {
    const rows = [obs(2), obs(3), obs(1)];
    const part = partitionByTiming(rows);
    expect(part.accepted).toHaveLength(2);
    expect(part.rejected).toHaveLength(1);
    expect(part.accepted[0]!.received_at).toBe(rows[0]!.received_at);
  });
});

describe("features — window maths and readiness", () => {
  it("computes a ready boundary from a complete stream", () => {
    const c = computeBoundaryFeatures({
      targetTs: TARGET,
      observations: fullStream(),
      history: history(),
      captureStatus: "FRESH",
    });
    expect(c.ready).toBe(true);
    expect(c.historyReady).toBe(true);
    expect(c.fields.observation_count_60s).toBe(EXPECTED_OBSERVATIONS);
    expect(c.fields.history_valid_count).toBe(HISTORY_WINDOW);
    expect(c.fields).not.toHaveProperty("history_count_96");
    expect(c.fields.final_imbalance_10bps).toBe(0.2);
    expect(c.fields.final_target_age_ms).toBe(2000);
  });

  it("is not ready below the minimum observation count", () => {
    const short = fullStream().slice(0, MIN_READY_OBSERVATIONS - 1);
    const c = computeBoundaryFeatures({
      targetTs: TARGET,
      observations: short,
      history: history(),
      captureStatus: "FRESH",
    });
    expect(c.ready).toBe(false);
  });

  it("is not ready without the T-2s final observation", () => {
    const noFinal = fullStream().filter((o) => o.sample_offset_seconds !== OBS_END_OFFSET_S);
    const c = computeBoundaryFeatures({
      targetTs: TARGET,
      observations: noFinal,
      history: history(),
      captureStatus: "FRESH",
    });
    expect(c.ready).toBe(false);
    expect(c.fields.final_imbalance_10bps).toBeNull();
  });

  it("withholds percentiles until 96 prior boundaries exist", () => {
    const c = computeBoundaryFeatures({
      targetTs: TARGET,
      observations: fullStream(),
      history: history(95),
      captureStatus: "FRESH",
    });
    expect(c.historyReady).toBe(false);
    expect(c.fields.abs_imbalance_percentile_96).toBeNull();
    expect(c.fields.history_valid_count).toBe(95);
  });

  it("drops leaked post-cutoff rows even if they reach the feature builder", () => {
    const leaked = [...fullStream(), obs(1, { imbalance_10bps: -0.9 })];
    const c = computeBoundaryFeatures({
      targetTs: TARGET,
      observations: leaked,
      history: history(),
      captureStatus: "FRESH",
    });
    expect(c.fields.observation_count_60s).toBe(EXPECTED_OBSERVATIONS);
    expect(c.fields.final_imbalance_10bps).toBe(0.2);
  });

  it("computes deterministic statistics", () => {
    expect(olsSlope([1, 2, 3, 4])).toBeCloseTo(1, 12);
    expect(olsSlope([2, 2, 2])).toBeCloseTo(0, 12);
    expect(signPersistence([1, 1, -1, 1])).toBeCloseTo(0.75, 12);
    expect(signChangeCount([1, -1, 1, 1])).toBe(2);
    expect(empiricalRank([1, 2, 3, 4], 3)).toBeCloseTo(0.75, 12);
    expect(empiricalRank([1, 2, 3, 4], 0)).toBeCloseTo(0, 12);
  });
});

describe("policies — six frozen shadows", () => {
  const ready = (imb: number, pct: number, pers = 1) => ({
    finalImbalance10bps: imb,
    absPercentile96: pct,
    signPersistence15s: pers,
    ready: true,
    historyReady: true,
  });

  it("emits one row per policy, always, including abstentions", () => {
    const rows = evaluateAllPolicies(null, null);
    expect(rows).toHaveLength(BINANCE_OB_POLICIES.length);
    expect(rows.every((r) => r.would_trade === false)).toBe(true);
    expect(rows.every((r) => r.decision_reason.startsWith("ABSTAIN_"))).toBe(true);
  });

  it("fade inverts follow", () => {
    expect(mapDirection(0.2, false)).toBe("GREEN");
    expect(mapDirection(0.2, true)).toBe("RED");
    expect(mapDirection(-0.2, false)).toBe("RED");
    expect(mapDirection(-0.2, true)).toBe("GREEN");
  });

  it("qualifies at both band edges (inclusive)", () => {
    const def = POLICY_DEFINITIONS[0]!;
    const lo = evaluatePolicy(def, ready(0.2, def.absPercentileMin), ready(0.2, 0.9));
    const hi = evaluatePolicy(def, ready(0.2, def.absPercentileMax), ready(0.2, 0.9));
    expect(lo.qualified).toBe(true);
    expect(hi.qualified).toBe(true);
  });

  it("abstains outside the band and on a zero imbalance", () => {
    const def = POLICY_DEFINITIONS[0]!;
    const below = evaluatePolicy(def, ready(0.2, def.absPercentileMin - 0.01), ready(0.2, 0.9));
    expect(below.qualified).toBe(false);
    expect(below.qualification_reason).toBe("SPOT_BELOW_BAND");
    expect(evaluatePolicy(def, ready(0, 0.9), ready(0.2, 0.9)).qualification_reason).toBe(
      "SPOT_IMBALANCE_ZERO",
    );
  });

  it("consensus policies require spot/perp sign agreement", () => {
    const def = POLICY_DEFINITIONS.find((d) => d.requireSignAgreement)!;
    const agree = evaluatePolicy(def, ready(0.3, 0.4), ready(0.3, 0.4));
    const disagree = evaluatePolicy(def, ready(0.3, 0.4), ready(-0.3, 0.4));
    expect(agree.qualified).toBe(true);
    expect(agree.spot_perp_sign_agree).toBe(true);
    expect(disagree.qualified).toBe(false);
    expect(disagree.decision_reason).toBe("ABSTAIN_SPOT_PERP_SIGN_DISAGREE");
  });

  it("scores WIN/LOSS/PUSH and abstentions", () => {
    expect(scorePolicy("GREEN", "GREEN")).toEqual({ result: "WIN", score: 1 });
    expect(scorePolicy("GREEN", "RED")).toEqual({ result: "LOSS", score: -1 });
    expect(scorePolicy("GREEN", "PUSH")).toEqual({ result: "PUSH", score: 0 });
    expect(scorePolicy(null, "GREEN")).toEqual({ result: null, score: null });
  });
});

describe("ingest — validation, de-duplication, idempotency", () => {
  function deps() {
    const stored: Record<string, unknown>[] = [];
    const audits: string[] = [];
    const health: Record<string, unknown>[] = [];
    const d: IngestDeps = {
      existingKeys: async (rows) => {
        const keys = new Set(stored.map((r) => observationKey(r as never)));
        return new Set(rows.map(observationKey).filter((k) => keys.has(k)));
      },
      insertObservations: async (rows) => {
        stored.push(...rows);
        return rows.length;
      },
      upsertHealth: async (row) => {
        health.push(row);
      },
      audit: async (event) => {
        audits.push(event);
      },
    };
    return { d, stored, audits, health };
  }

  it("stores only eligible rows and audits rejections", async () => {
    const { d, stored, audits } = deps();
    const res = await processIngest(
      { collector_version: "binance-ob-collector-r1", observations: [obs(2), obs(3), obs(1)] },
      d,
    );
    expect(res.received).toBe(3);
    expect(res.stored).toBe(2);
    expect(res.rejected).toBe(1);
    expect(res.rejected_by_reason.SAMPLE_AFTER_CUTOFF).toBe(1);
    expect(stored).toHaveLength(2);
    expect(audits).toContain("ingest-rejected-timing");
  });

  it("is idempotent across a replayed batch", async () => {
    const { d, stored } = deps();
    const body = { collector_version: "binance-ob-collector-r1", observations: fullStream() };
    const first = await processIngest(body, d);
    const second = await processIngest(body, d);
    expect(first.stored).toBe(EXPECTED_OBSERVATIONS);
    expect(second.stored).toBe(0);
    expect(second.duplicate).toBe(EXPECTED_OBSERVATIONS);
    expect(stored).toHaveLength(EXPECTED_OBSERVATIONS);
  });

  it("de-duplicates within one batch", async () => {
    const { d } = deps();
    const res = await processIngest(
      { collector_version: "binance-ob-collector-r1", observations: [obs(2), obs(2)] },
      d,
    );
    expect(res.stored).toBe(1);
    expect(res.duplicate).toBe(1);
  });

  it("records reportable collector events and ignores unknown ones", async () => {
    const { d, audits } = deps();
    const res = await processIngest(
      {
        collector_version: "binance-ob-collector-r1",
        events: [{ event: "sequence-gap" }, { event: "not-a-real-event" }],
        health: { market_kind: "SPOT", collector_status: "HEALTHY" },
      },
      d,
    );
    expect(res.events_recorded).toBe(1);
    expect(res.events_ignored).toBe(1);
    expect(res.health_written).toBe(true);
    expect(audits).toContain("sequence-gap");
  });
});

describe("watchdog — missing boundaries become explicit failures", () => {
  it("classifies zero observations as NO_DATA and partial as INCOMPLETE", () => {
    expect(classifyMissingBoundary(0).captureStatus).toBe("NO_DATA");
    const partial = classifyMissingBoundary(MIN_READY_OBSERVATIONS - 1);
    expect(partial.captureStatus).not.toBe("FRESH");
    expect(partial.failureReason).toBeTruthy();
  });
});

describe("collector runtime — audit vocabulary is emitted by the collector", () => {
  it("emits every reportable transition and keeps counters", () => {
    const seen: string[] = [];
    const rt = new CollectorRuntime({
      marketKind: "SPOT",
      deploymentId: "test-deploy",
      collectorVersion: "binance-ob-collector-r1",
      buildIdentifier: "test",
      sink: (e: string) => seen.push(e),
      now: () => Date.parse("2026-01-05T17:59:00.000Z"),
    });
    rt.startup();
    rt.connecting("wss://example", { planned: false });
    rt.snapshotSynchronized(42);
    rt.ready();
    rt.sequenceGap({ last_update_id: 42 });
    rt.resyncing("SEQUENCE_GAP");
    rt.plannedRollover(1000);
    rt.unplannedDisconnect("WS_CLOSE");
    rt.regionBlock(451, "blocked");
    rt.boundaryFinalized(TARGET, 59);
    rt.boundaryFailed(TARGET, "boom");
    rt.ingestFailure("boom");

    for (const e of Object.values(COLLECTOR_EVENTS) as string[]) {
      if (e === COLLECTOR_EVENTS.FUTURES_READY || e === COLLECTOR_EVENTS.HEARTBEAT_STALE) continue;
      expect(seen).toContain(e);
    }
    expect(seen.filter((e) => e === COLLECTOR_EVENTS.SEQUENCE_GAP)).toHaveLength(1);
    const health = rt.healthRow({ lastUpdateId: 42, sequenceOk: true, initialized: true });
    expect(health.deployment_id).toBe("test-deploy");
    expect(health.sequence_gap_count).toBe(1);
    expect(health.resync_count).toBe(1);
    expect(health.planned_rollover_count).toBe(1);
    expect(health.reconnect_count).toBe(1);
    expect(health.region_blocked).toBe(true);
    expect(health.heartbeat_interval_ms).toBeLessThanOrEqual(5000);
  });

  it("only emits events the ingest endpoint accepts", () => {
    for (const e of Object.values(COLLECTOR_EVENTS) as string[]) {
      expect(isCollectorReportableEvent(e)).toBe(true);
    }
  });
});

describe("combined CSV export", () => {
  const featureRow = (market: string) => ({
    target_ts: TARGET,
    market_kind: market,
    venue: "BINANCE_GLOBAL",
    symbol: "BTCUSDT",
    capture_status: "FRESH",
    ready: true,
    history_valid_count: 96,
    final_imbalance_10bps: 0.2,
  });

  it("joins spot, perp and all six policies onto one row per target", () => {
    const rows = buildCombinedRows({
      features: [featureRow("SPOT"), featureRow("USD_M_PERP")],
      policies: BINANCE_OB_POLICIES.map((p) => ({
        target_ts: TARGET,
        policy_name: p,
        qualified: true,
        candidate_direction: "GREEN",
        result: "WIN",
        result_score: 1,
      })),
      localDate: () => "2026-01-05",
      outcomeSource: "OKX:BTC-USDT:15m:confirmed",
      featureVersion: "binance-ob-r1",
      policyVersion: "binance-ob-policy-r1",
    });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.spot_present).toBe(true);
    expect(r.perp_present).toBe(true);
    expect(r.policy_row_count).toBe(BINANCE_OB_POLICIES.length);
    expect(r.spot_final_imbalance_10bps).toBe(0.2);
    expect(r.spot_follow_current_band_result).toBe("WIN");
    const csv = rowsToCsv(combinedColumns(), rows);
    expect(csv.split("\n")[0]!.split(",")).toHaveLength(combinedColumns().length);
    expect(csv.trim().split("\n")).toHaveLength(2);
  });

  it("leaves missing markets and policies empty rather than fabricating values", () => {
    const rows = buildCombinedRows({
      features: [featureRow("SPOT")],
      policies: [],
      localDate: () => "2026-01-05",
      outcomeSource: "OKX:BTC-USDT:15m:confirmed",
      featureVersion: "binance-ob-r1",
      policyVersion: "binance-ob-policy-r1",
    });
    const r = rows[0]!;
    expect(r.perp_present).toBe(false);
    expect(r.perp_final_imbalance_10bps).toBeNull();
    expect(r.spot_follow_current_band_result).toBeNull();
    const csv = rowsToCsv(combinedColumns(), rows);
    expect(csv.split("\n")[1]).toContain(",,");
  });

  it("produces a header-only file when no data exists", () => {
    const csv = rowsToCsv(combinedColumns(), []);
    expect(csv.trim().split("\n")).toHaveLength(1);
  });
});
