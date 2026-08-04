import { describe, expect, it } from "vitest";
import { advanceV6Warm } from "../warmup";
import { canResumePersistedState, rollWarmupWindow, type WarmupBaseDecision } from "../warmupCore";
import { V6_ARTIFACT_SHA256, V6_FEATURE_SCHEMA_VERSION, V6_FIT_ID, V6_MODEL_VERSION } from "../config";

const TF_MS = 15 * 60 * 1000;
const T = new Date("2026-08-04T00:00:00.000Z");
const T2 = new Date(T.getTime() + TF_MS);

function windowFor(targetTs: Date): WarmupBaseDecision[] {
  return Array.from({ length: 7 }, (_, i) => {
    const tgt = new Date(targetTs.getTime() - (7 - i) * TF_MS);
    return {
      target_candle_ts: tgt.toISOString(),
      input_candle_ts: new Date(tgt.getTime() - TF_MS).toISOString(),
      base_v6_prediction: (i % 2 === 0 ? "GREEN" : "RED") as "GREEN" | "RED",
    };
  });
}

/** Minimal in-memory stand-in for the single-row v6_warmup_state table. */
function makeSb(initial: Record<string, unknown> | null) {
  const store: { row: Record<string, unknown> | null } = { row: initial };
  let writes = 0;
  const sb = {
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: store.row }) };
            },
          };
        },
        async upsert(patch: Record<string, unknown>) {
          writes += 1;
          store.row = { ...(store.row ?? {}), ...patch };
          return { error: null };
        },
      };
    },
  };
  return { sb: sb as never, store, writes: () => writes };
}

function readyRow(targetTs: Date) {
  return {
    model_version: V6_MODEL_VERSION,
    v6_warmup_status: "READY",
    fit_id: V6_FIT_ID,
    model_artifact_sha256: V6_ARTIFACT_SHA256,
    feature_schema_version: V6_FEATURE_SCHEMA_VERSION,
    warmup_last_candle_ts: new Date(targetTs.getTime() - TF_MS).toISOString(),
    warmup_next_target_ts: targetTs.toISOString(),
    warmup_continuity_valid: true,
    warmup_feature_valid: true,
    warmup_base_predictions_count: 7,
    warmup_base_predictions_json: windowFor(targetTs),
  };
}

describe("V6 warmup window roll", () => {
  it("appends the live base decision and drops the oldest", () => {
    const rolled = rollWarmupWindow(windowFor(T), T, new Date(T.getTime() - TF_MS).toISOString(), "RED");
    expect(rolled).not.toBeNull();
    expect(rolled).toHaveLength(7);
    expect(rolled![6].target_candle_ts).toBe(T.toISOString());
    expect(rolled![6].base_v6_prediction).toBe("RED");
    expect(rolled![0].target_candle_ts).toBe(new Date(T.getTime() - 6 * TF_MS).toISOString());
  });

  it("refuses to roll a disconnected window or mismatched input candle", () => {
    expect(rollWarmupWindow(windowFor(T), T2, new Date(T2.getTime() - TF_MS).toISOString(), "GREEN")).toBeNull();
    expect(rollWarmupWindow(windowFor(T), T, new Date(T.getTime() - 2 * TF_MS).toISOString(), "GREEN")).toBeNull();
    expect(rollWarmupWindow(windowFor(T).slice(1), T, new Date(T.getTime() - TF_MS).toISOString(), "GREEN")).toBeNull();
  });
});

describe("V6 successive boundaries", () => {
  it("advances state after the live prediction so the next boundary resumes without replay", async () => {
    const { sb, store } = makeSb(readyRow(T));
    const r = await advanceV6Warm(sb, T, new Date(T.getTime() - TF_MS).toISOString(), "GREEN");
    expect(r.advanced).toBe(true);

    const s = store.row!;
    expect(s.warmup_last_candle_ts).toBe(T.toISOString());
    expect(s.warmup_next_target_ts).toBe(T2.toISOString());
    expect(s.warmup_base_predictions_count).toBe(7);

    // The next boundary must resume the persisted state — no full replay.
    expect(
      canResumePersistedState(s, {
        targetTs: T2,
        fitId: V6_FIT_ID,
        artifactSha256: V6_ARTIFACT_SHA256,
        featureSchemaVersion: V6_FEATURE_SCHEMA_VERSION,
      }),
    ).toBe(true);

    const win = s.warmup_base_predictions_json as WarmupBaseDecision[];
    expect(win[6].target_candle_ts).toBe(T.toISOString());
    expect(win[6].base_v6_prediction).toBe("GREEN");
  });

  it("is idempotent and never regresses on a duplicate or stale advance", async () => {
    const { sb, store } = makeSb(readyRow(T));
    await advanceV6Warm(sb, T, new Date(T.getTime() - TF_MS).toISOString(), "GREEN");
    const snapshot = JSON.stringify(store.row);

    const dup = await advanceV6Warm(sb, T, new Date(T.getTime() - TF_MS).toISOString(), "RED");
    expect(dup.advanced).toBe(false);
    expect(dup.reason).toBe("already_advanced");

    const stale = await advanceV6Warm(
      sb,
      new Date(T.getTime() - TF_MS),
      new Date(T.getTime() - 2 * TF_MS).toISOString(),
      "RED",
    );
    expect(stale.advanced).toBe(false);
    expect(JSON.stringify(store.row)).toBe(snapshot);
  });

  it("does not advance when state is not READY", async () => {
    const { sb } = makeSb({ ...readyRow(T), v6_warmup_status: "FAILED" });
    const r = await advanceV6Warm(sb, T, new Date(T.getTime() - TF_MS).toISOString(), "GREEN");
    expect(r.advanced).toBe(false);
    expect(r.reason).toBe("not_ready");
  });

  it("concurrent advances for the same target converge to one consistent state", async () => {
    const { sb, store } = makeSb(readyRow(T));
    const [a, b] = await Promise.all([
      advanceV6Warm(sb, T, new Date(T.getTime() - TF_MS).toISOString(), "GREEN"),
      advanceV6Warm(sb, T, new Date(T.getTime() - TF_MS).toISOString(), "GREEN"),
    ]);
    expect([a.advanced, b.advanced].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    const s = store.row!;
    expect(s.warmup_last_candle_ts).toBe(T.toISOString());
    expect(s.warmup_next_target_ts).toBe(T2.toISOString());
    expect((s.warmup_base_predictions_json as WarmupBaseDecision[])).toHaveLength(7);
    expect(
      canResumePersistedState(s, {
        targetTs: T2,
        fitId: V6_FIT_ID,
        artifactSha256: V6_ARTIFACT_SHA256,
        featureSchemaVersion: V6_FEATURE_SCHEMA_VERSION,
      }),
    ).toBe(true);
  });
});
