import { describe, expect, it } from "vitest";
import {
  canResumePersistedState,
  replayWarmup,
  V6_WARMUP_BASE_PREDICTIONS,
  V6_WARMUP_MIN_CANDLES,
  type WarmupBaseDecision,
} from "../warmupCore";
import { buildTechnicalRows, type RawCandle } from "../technical";
import { inferV6, type TechnicalRow } from "../inference";
import { V6_ARTIFACT_SHA256, V6_FEATURE_SCHEMA_VERSION, V6_FIT_ID } from "../config";

const TF_MS = 15 * 60 * 1000;
const TARGET = new Date("2026-08-04T00:00:00.000Z");

/** Deterministic synthetic BTC-like series ending exactly at TARGET - 15m. */
function makeCandles(count: number, targetTs: Date = TARGET): RawCandle[] {
  const out: RawCandle[] = [];
  let price = 60000;
  const firstMs = targetTs.getTime() - count * TF_MS;
  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 7) * 120 + Math.cos(i / 3) * 45;
    const open = price;
    const close = price + wave * 0.3 + ((i % 5) - 2) * 10;
    const high = Math.max(open, close) + 25 + (i % 4) * 5;
    const low = Math.min(open, close) - 25 - (i % 3) * 5;
    out.push({
      candle_ts: new Date(firstMs + i * TF_MS).toISOString(),
      open, high, low, close,
      volume: 100 + (i % 17) * 3,
    });
    price = close;
  }
  return out;
}

describe("V6 warmup replay", () => {
  it("reaches READY with 200+ consecutive confirmed candles", () => {
    const r = replayWarmup(makeCandles(260), TARGET);
    expect(r.status).toBe("READY");
    expect(r.error).toBeNull();
    expect(r.candleCount).toBeGreaterThanOrEqual(V6_WARMUP_MIN_CANDLES);
    expect(r.continuityValid).toBe(true);
    expect(r.featureValid).toBe(true);
    expect(r.priorBasePredictions).toHaveLength(V6_WARMUP_BASE_PREDICTIONS);
  });

  it("anchors the latest warmup candle to exactly T - 15m and never sees the target", () => {
    const r = replayWarmup(makeCandles(260), TARGET);
    expect(r.lastCandleTs).toBe(new Date(TARGET.getTime() - TF_MS).toISOString());
    const leak = makeCandles(260);
    leak.push({ ...leak[leak.length - 1], candle_ts: TARGET.toISOString() });
    const bad = replayWarmup(leak, TARGET);
    expect(bad.status).toBe("FAILED");
    expect(bad.error).toContain("target_candle_leakage");
  });

  it("fails on a missing candle and publishes no state", () => {
    const c = makeCandles(260);
    c.splice(100, 1);
    const r = replayWarmup(c, TARGET);
    expect(r.status).toBe("FAILED");
    expect(r.failureReason).toBe("V6_WARMUP_CONTINUITY_FAILURE");
    expect(r.priorBasePredictions).toHaveLength(0);
  });

  it("fails on a duplicate candle", () => {
    const c = makeCandles(260);
    c.splice(50, 0, { ...c[50] });
    const r = replayWarmup(c, TARGET);
    expect(r.status).toBe("FAILED");
    expect(r.error).toContain("duplicate_candle");
  });

  it("fails when fewer than the minimum candles are available", () => {
    const r = replayWarmup(makeCandles(V6_WARMUP_MIN_CANDLES - 1), TARGET);
    expect(r.status).toBe("FAILED");
    expect(r.failureReason).toBe("V6_WARMUP_HISTORY_MISSING");
  });

  it("replayed decisions are BASE predictions and match direct historical inference", () => {
    const candles = makeCandles(260);
    const r = replayWarmup(candles, TARGET);
    const rows = buildTechnicalRows(candles) as unknown as TechnicalRow[];
    const n = rows.length;
    for (let k = V6_WARMUP_BASE_PREDICTIONS, i = 0; k >= 1; k -= 1, i += 1) {
      const idx = n - 1 - k;
      const direct = inferV6(rows[idx], rows[idx - 1], rows[idx - 4], { priorBasePredictions: [] });
      expect(r.baseDecisions[i].base_v6_prediction).toBe(direct.basePrediction);
      expect(r.baseDecisions[i].input_candle_ts).toBe(candles[idx].candle_ts);
      expect(r.baseDecisions[i].target_candle_ts).toBe(
        new Date(TARGET.getTime() - (V6_WARMUP_BASE_PREDICTIONS - i) * TF_MS).toISOString(),
      );
    }
  });

  it("the first live decision sees seven historical base decisions plus its own", () => {
    const candles = makeCandles(260);
    const r = replayWarmup(candles, TARGET);
    const rows = buildTechnicalRows(candles) as unknown as TechnicalRow[];
    const n = rows.length;
    const live = inferV6(rows[n - 1], rows[n - 2], rows[n - 5], {
      priorBasePredictions: r.priorBasePredictions,
    });
    expect(live.basePredictionsLast8).toHaveLength(8);
    expect(live.basePredictionsLast8.slice(0, 7)).toEqual(r.priorBasePredictions);
    expect(live.basePredictionsLast8[7]).toBe(live.basePrediction);
    expect(live.saturationVetoEvaluable).toBe(true);
  });

  it("is idempotent across repeated replays", () => {
    const a = replayWarmup(makeCandles(260), TARGET);
    const b = replayWarmup(makeCandles(260), TARGET);
    expect(b).toEqual(a);
  });
});

describe("V6 persisted warmup state", () => {
  const decisions: WarmupBaseDecision[] = Array.from({ length: 7 }, (_, i) => ({
    target_candle_ts: new Date(TARGET.getTime() - (7 - i) * TF_MS).toISOString(),
    input_candle_ts: new Date(TARGET.getTime() - (8 - i) * TF_MS).toISOString(),
    base_v6_prediction: i % 2 === 0 ? "GREEN" : "RED",
  }));
  const good = {
    v6_warmup_status: "READY",
    fit_id: V6_FIT_ID,
    model_artifact_sha256: V6_ARTIFACT_SHA256,
    feature_schema_version: V6_FEATURE_SCHEMA_VERSION,
    warmup_last_candle_ts: new Date(TARGET.getTime() - TF_MS).toISOString(),
    warmup_continuity_valid: true,
    warmup_feature_valid: true,
    warmup_base_predictions_count: 7,
    warmup_base_predictions_json: decisions,
  };
  const expectation = {
    targetTs: TARGET,
    fitId: V6_FIT_ID,
    artifactSha256: V6_ARTIFACT_SHA256,
    featureSchemaVersion: V6_FEATURE_SCHEMA_VERSION,
  };

  it("resumes only when timestamps, artifact hash, and schema all match", () => {
    expect(canResumePersistedState(good, expectation)).toBe(true);
  });

  it("forces a full replay on any mismatch", () => {
    expect(canResumePersistedState(null, expectation)).toBe(false);
    expect(canResumePersistedState({ ...good, model_artifact_sha256: "x" }, expectation)).toBe(false);
    expect(canResumePersistedState({ ...good, feature_schema_version: "x" }, expectation)).toBe(false);
    expect(canResumePersistedState({ ...good, v6_warmup_status: "FAILED" }, expectation)).toBe(false);
    expect(canResumePersistedState({ ...good, warmup_continuity_valid: false }, expectation)).toBe(false);
    expect(canResumePersistedState({ ...good, warmup_base_predictions_json: decisions.slice(1) }, expectation)).toBe(false);
    expect(
      canResumePersistedState(
        { ...good, warmup_last_candle_ts: new Date(TARGET.getTime() - 2 * TF_MS).toISOString() },
        expectation,
      ),
    ).toBe(false);
    // A stale window (state built for an earlier target) cannot be carried over.
    expect(
      canResumePersistedState(good, { ...expectation, targetTs: new Date(TARGET.getTime() + TF_MS) }),
    ).toBe(false);
  });
});
