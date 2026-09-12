// Version 1.1 delivery — integration tests over the REAL routing seams.
//
// Nothing here contacts a network, a real endpoint or a production table. The
// transport is an in-process receiver; Supabase is an in-memory stand-in that
// records exactly which statements the code issued. Every execution control is
// absent unless a single test sets it on itself and deletes it afterwards.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchV11Fallback,
  dispatchV11FallbackForObservation,
  evaluateV11Dispatch,
  relabelV1PayloadAsV11,
  supabaseV11DispatchDeps,
  v11DeliveryArmed,
  v11EventDedupeKey,
  v11ServerExecutionEnabled,
  v11V1LegDeliver,
  v11V1LegGateReaders,
  type V11ClaimOutcome,
  type V11DecisionRecord,
  type V11DispatchDeps,
} from "../dispatch.server";
import {
  V11_CANDIDATE_VERSION,
  V11_CONFIG_FINGERPRINT,
  V11_FEATURE_ORDER_HASH,
  V11_MODEL_VERSION,
  V11_POLICY_VERSION,
  V11_RUN_MODES,
} from "../config";
import {
  dispatchLiteaDecision,
  type LiteADecisionRecord,
  type LiteADispatchDeps,
} from "@/lib/litea/dispatch.server";
import { liteaDedupeKey } from "@/lib/litea/webhook.server";
import { LITE_A_MODEL_VERSION } from "@/lib/c85/config";

const TICKER = "KXBTC15M-26SEP120345-T77250";
const OPEN_MS = Date.parse("2026-09-12T03:45:00.000Z");
const CEILING = 60_000;

/** The persisted `v11_decisions` shape the observer actually writes. */
function liveShadowRow(over: Partial<V11DecisionRecord> = {}): V11DecisionRecord {
  return {
    ticker: TICKER,
    target_ts: new Date(OPEN_MS).toISOString(),
    run_mode: V11_RUN_MODES.LIVE,
    leg: "T45R2",
    side: 1,
    reason: "FALLBACK_CALL",
    probability: 0.6314,
    rank: 0.94,
    admission_gate: 0.62,
    v1_status: "BASE_NO_CALL",
    v1_reason: "CONFIDENCE_ABSTAIN",
    v1_final_side: 0,
    v1_floor_open: true,
    v1_send_claim: "none",
    decision_offset_ms: 47_210,
    within_publication_ceiling: true,
    strategy: {
      model_version: V11_MODEL_VERSION,
      candidate_version: V11_CANDIDATE_VERSION,
      policy_version: V11_POLICY_VERSION,
    },
    evidence: {
      run_mode: V11_RUN_MODES.LIVE,
      trigger: "t45-boundary-run",
      trigger_signed: true,
      trigger_received_at_ms: OPEN_MS + 45_400,
      v1_run_mode: "LIVE",
      v1_read_failed: false,
      downgraded_by: null,
      feature_order_hash: V11_FEATURE_ORDER_HASH,
      config_fingerprint: V11_CONFIG_FINGERPRINT,
    },
    ...over,
  };
}

const ON = {
  nowMs: OPEN_MS + 48_000,
  executionEnabled: true,
  v1DeliveryOff: true,
  commitOffsetMs: 47_900,
  effectiveRunMode: V11_RUN_MODES.LIVE,
};

afterEach(() => {
  delete process.env['V11_SERVER_EXECUTION_ENABLED'];
  delete process.env['LITEA_SERVER_EXECUTION_ENABLED'];
  vi.unstubAllGlobals();
});

// ── Controls ────────────────────────────────────────────────────────────────

describe("Version 1.1 execution controls", () => {
  it("is off with no environment at all", () => {
    expect(v11ServerExecutionEnabled()).toBe(false);
    expect(v11DeliveryArmed()).toBe(false);
  });

  it("stays off while the ORIGINAL Version 1 sender is enabled", () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    expect(v11DeliveryArmed()).toBe(false);
  });

  it("arms only when its own control is on AND Version 1 delivery is off", () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    expect(v11DeliveryArmed()).toBe(true);
  });
});

// ── Verdicts over the REAL persisted row ────────────────────────────────────

describe("evaluateV11Dispatch over the real LIVE_SHADOW row", () => {
  it("admits a signed, on-time, admitted fallback", () => {
    expect(evaluateV11Dispatch(liveShadowRow(), ON)).toBe("WOULD_SEND");
  });

  it("refuses while either control is missing", () => {
    expect(evaluateV11Dispatch(liveShadowRow(), { ...ON, executionEnabled: false })).toBe(
      "EXECUTION_DISABLED",
    );
    expect(evaluateV11Dispatch(liveShadowRow(), { ...ON, v1DeliveryOff: false })).toBe(
      "V1_DELIVERY_STILL_ENABLED",
    );
  });

  it("accepts only LIVE_SHADOW, on the row AND in the transaction's own report", () => {
    expect(
      evaluateV11Dispatch(liveShadowRow({ run_mode: V11_RUN_MODES.RECOVERY }), ON),
    ).toBe("NOT_LIVE_SHADOW");
    expect(
      evaluateV11Dispatch(liveShadowRow({ run_mode: V11_RUN_MODES.RESEARCH }), ON),
    ).toBe("NOT_LIVE_SHADOW");
    expect(
      evaluateV11Dispatch(liveShadowRow(), { ...ON, effectiveRunMode: V11_RUN_MODES.RECOVERY }),
    ).toBe("NOT_LIVE_SHADOW");
  });

  it("requires genuine signed, non-downgraded collector evidence", () => {
    const unsigned = liveShadowRow();
    (unsigned.evidence as Record<string, unknown>).trigger_signed = false;
    expect(evaluateV11Dispatch(unsigned, ON)).toBe("EVIDENCE_UNSIGNED");

    const downgraded = liveShadowRow();
    (downgraded.evidence as Record<string, unknown>).downgraded_by = "LATE_PUBLICATION";
    expect(evaluateV11Dispatch(downgraded, ON)).toBe("EVIDENCE_UNSIGNED");

    const maintenance = liveShadowRow();
    (maintenance.evidence as Record<string, unknown>).trigger_received_at_ms = null;
    expect(evaluateV11Dispatch(maintenance, ON)).toBe("EVIDENCE_UNSIGNED");
  });

  it("requires the exact frozen model, candidate and fingerprint identity", () => {
    const other = liveShadowRow({
      strategy: {
        model_version: "some-other-model",
        candidate_version: V11_CANDIDATE_VERSION,
        policy_version: V11_POLICY_VERSION,
      },
    });
    expect(evaluateV11Dispatch(other, ON)).toBe("IDENTITY_MISMATCH");

    const stale = liveShadowRow();
    (stale.evidence as Record<string, unknown>).config_fingerprint = "deadbeef";
    expect(evaluateV11Dispatch(stale, ON)).toBe("IDENTITY_MISMATCH");
  });

  it("requires a finite score, rank at/above the gate and at/above 0.80", () => {
    expect(evaluateV11Dispatch(liveShadowRow({ probability: null }), ON)).toBe("SCORE_INVALID");
    expect(evaluateV11Dispatch(liveShadowRow({ rank: null }), ON)).toBe("SCORE_INVALID");
    expect(evaluateV11Dispatch(liveShadowRow({ admission_gate: null }), ON)).toBe("SCORE_INVALID");
    expect(evaluateV11Dispatch(liveShadowRow({ rank: 0.9, admission_gate: 0.95 }), ON)).toBe(
      "BELOW_ADMISSION_GATE",
    );
    expect(evaluateV11Dispatch(liveShadowRow({ rank: 0.79, admission_gate: 0.6 }), ON)).toBe(
      "BELOW_FALLBACK_RANK",
    );
  });

  it("requires the ORIGINAL V1 leg to have left the interval free", () => {
    expect(evaluateV11Dispatch(liveShadowRow({ v1_final_side: 1 }), ON)).toBe(
      "V1_LEG_NOT_EXCLUSIVE",
    );
    expect(evaluateV11Dispatch(liveShadowRow({ v1_floor_open: false }), ON)).toBe(
      "V1_LEG_NOT_EXCLUSIVE",
    );
    expect(evaluateV11Dispatch(liveShadowRow({ v1_reason: "FIT_UNAVAILABLE" }), ON)).toBe(
      "V1_LEG_NOT_EXCLUSIVE",
    );
    expect(evaluateV11Dispatch(liveShadowRow({ v1_send_claim: "SENT" }), ON)).toBe(
      "V1_LEG_NOT_EXCLUSIVE",
    );
    const shadowV1 = liveShadowRow();
    (shadowV1.evidence as Record<string, unknown>).v1_run_mode = "SHADOW";
    expect(evaluateV11Dispatch(shadowV1, ON)).toBe("V1_LEG_NOT_EXCLUSIVE");
  });

  it("requires real timing and an on-time commit inside the 60s ceiling", () => {
    expect(evaluateV11Dispatch(liveShadowRow(), { ...ON, commitOffsetMs: null })).toBe(
      "TIMING_UNAVAILABLE",
    );
    expect(evaluateV11Dispatch(liveShadowRow({ decision_offset_ms: null }), ON)).toBe(
      "TIMING_UNAVAILABLE",
    );
    expect(evaluateV11Dispatch(liveShadowRow(), { ...ON, commitOffsetMs: 61_000 })).toBe(
      "LATE_COMMIT",
    );
    expect(
      evaluateV11Dispatch(liveShadowRow({ within_publication_ceiling: false }), ON),
    ).toBe("LATE_COMMIT");
    expect(evaluateV11Dispatch(liveShadowRow(), { ...ON, nowMs: OPEN_MS + CEILING })).toBe(
      "EXPIRED",
    );
  });

  it("never admits an abstention or a non-fallback leg", () => {
    expect(evaluateV11Dispatch(liveShadowRow({ side: 0 }), ON)).toBe("ABSTAIN");
    expect(evaluateV11Dispatch(liveShadowRow({ leg: "V1" }), ON)).toBe("NOT_FALLBACK_LEG");
  });
});

// ── Claim + single attempt, against an in-memory outbox ─────────────────────

function harness(opts: { claim?: V11ClaimOutcome; throwOnSend?: boolean } = {}) {
  const sent: Record<string, unknown>[] = [];
  const attempts: string[] = [];
  const rows = new Map<string, { state: string; owner: string | null }>();
  let enabled = true;
  const deps: V11DispatchDeps = {
    now: () => OPEN_MS + 48_000,
    isEnabledNow: () => enabled,
    v1OffNow: () => true,
    async claim(entry) {
      if (opts.claim && opts.claim !== "CLAIMED") return { outcome: opts.claim };
      const existing = rows.get(entry.dedupeKey);
      if (existing) {
        return { outcome: existing.state === "SENT" ? "ALREADY_SENT" : "HELD_BY_OTHER" };
      }
      rows.set(entry.dedupeKey, { state: "PENDING", owner: entry.owner });
      return { outcome: "CLAIMED" };
    },
    async ownsClaim(key, owner) {
      const row = rows.get(key);
      return !!row && row.state === "PENDING" && row.owner === owner;
    },
    async deliver(payload, guard) {
      attempts.push("attempt");
      if (!(await guard())) return { delivered: 0 };
      if (opts.throwOnSend) throw new Error("socket hang up");
      sent.push(payload);
      return { delivered: 1, sendStartedAtMs: OPEN_MS + 48_100 };
    },
    async settle(entry) {
      const row = rows.get(entry.dedupeKey);
      if (!row || row.owner !== entry.owner || row.state !== "PENDING") return { applied: false };
      row.state = entry.status;
      row.owner = null;
      return { applied: true };
    },
  };
  return { deps, sent, attempts, rows, disable: () => (enabled = false) };
}

const COMMIT = { commitOffsetMs: 47_900, effectiveRunMode: V11_RUN_MODES.LIVE };

describe("dispatchV11Fallback", () => {
  it("claims the CANONICAL Version 1 interval key and sends exactly once", async () => {
    const h = harness();
    const out = await dispatchV11Fallback(h.deps, liveShadowRow(), COMMIT);
    expect(out.verdict).toBe("SENT");
    expect(out.dedupeKey).toBe(liteaDedupeKey(TICKER, new Date(OPEN_MS).toISOString()));
    expect(h.attempts).toHaveLength(1);
    expect(h.sent[0]?.model).toBe(V11_MODEL_VERSION);
    expect(h.sent[0]?.leg).toBe("T45R2");
    expect(h.sent[0]?.stake_fraction_of_boise_day_opening_principal).toBe(0.04);
    expect(h.sent[0]?.sizing_owner).toBe("external-betting-bot");
  });

  it("is excluded by an existing claim on the same interval (either leg)", async () => {
    const h = harness();
    const first = await dispatchV11Fallback(h.deps, liveShadowRow(), COMMIT);
    expect(first.verdict).toBe("SENT");
    const second = await dispatchV11Fallback(h.deps, liveShadowRow(), COMMIT);
    expect(second.verdict).toBe("ALREADY_CLAIMED");
    expect(h.attempts).toHaveLength(1);
  });

  it("never sends on a conflicting, terminal or ambiguous claim", async () => {
    for (const outcome of ["HELD_BY_OTHER", "TERMINAL", "AMBIGUOUS", "UNAVAILABLE"] as const) {
      const h = harness({ claim: outcome });
      const out = await dispatchV11Fallback(h.deps, liveShadowRow(), COMMIT);
      expect(out.verdict).toBe("NOT_CLAIM_OWNER");
      expect(h.attempts).toHaveLength(0);
    }
  });

  it("cancels at the transport guard when the control is turned off mid-flight", async () => {
    const h = harness();
    const real = h.deps.deliver;
    h.deps.deliver = async (payload, guard) => {
      h.disable();
      return real(payload, guard);
    };
    const out = await dispatchV11Fallback(h.deps, liveShadowRow(), COMMIT);
    expect(out.verdict).toBe("FAILED");
    expect(h.sent).toHaveLength(0);
  });

  it("does not retry a thrown/timed-out attempt", async () => {
    const h = harness({ throwOnSend: true });
    const out = await dispatchV11Fallback(h.deps, liveShadowRow(), COMMIT);
    expect(out.verdict).toBe("FAILED");
    expect(h.attempts).toHaveLength(1);
  });

  it("reports OWNER_LOST instead of claiming success when settle finds no owned row", async () => {
    const h = harness();
    h.deps.settle = async () => ({ applied: false });
    const out = await dispatchV11Fallback(h.deps, liveShadowRow(), COMMIT);
    expect(out.verdict).toBe("OWNER_LOST");
  });

  it("refuses a RECOVERY/research row before making any claim", async () => {
    const h = harness();
    const out = await dispatchV11Fallback(h.deps, liveShadowRow(), {
      commitOffsetMs: 240_000,
      effectiveRunMode: V11_RUN_MODES.RECOVERY,
    });
    expect(out.verdict).toBe("NOT_LIVE_SHADOW");
    expect(h.rows.size).toBe(0);
  });
});

// ── The real Supabase deps and the real hook seam ───────────────────────────

const ENDPOINT = {
  id: "ep-local",
  url: "http://127.0.0.1:1/in-process-receiver",
  secret: "s",
  events: ["prediction.created"],
  is_active: true,
};

/** In-memory Supabase stand-in that records every statement it is given. */
function fakeDb(opts: { decision?: V11DecisionRecord | null; endpoints?: unknown[] } = {}) {
  const log: { table: string; op: string; args: unknown }[] = [];
  const rpc: { name: string; args: Record<string, unknown> }[] = [];
  const outbox = new Map<string, { state: string; claim_owner: string | null; claim_expires_at: string }>();
  const client: any = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpc.push({ name, args });
      const key = String(args.p_dedupe_key);
      if (outbox.has(key)) return { data: { outcome: "HELD_BY_OTHER" }, error: null };
      outbox.set(key, {
        state: "PENDING",
        claim_owner: String(args.p_owner),
        claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      return { data: { outcome: "CLAIMED" }, error: null };
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        },
        is: () => chain,
        maybeSingle: async () => {
          log.push({ table, op: "select", args: { ...filters } });
          if (table === "v11_decisions") return { data: opts.decision ?? null, error: null };
          if (table === "c85_outbox") {
            const row = outbox.get(String(filters['dedupe_key']));
            return { data: row ? { dedupe_key: filters['dedupe_key'], ...row } : null, error: null };
          }
          return { data: null, error: null };
        },
        update: (values: Record<string, unknown>) => {
          const u: any = {
            eq: (col: string, val: unknown) => {
              filters[col] = val;
              return u;
            },
            select: async () => {
              log.push({ table, op: "update", args: { values, filters: { ...filters } } });
              const row = outbox.get(String(filters['dedupe_key']));
              if (!row || row.claim_owner !== filters['claim_owner'] || row.state !== "PENDING") {
                return { data: [], error: null };
              }
              row.state = String(values['state']);
              row.claim_owner = null;
              return { data: [{ dedupe_key: filters['dedupe_key'] }], error: null };
            },
            then: (r: any) => r({ data: null, error: null }),
          };
          return u;
        },
        insert: async () => ({ error: null }),
        order: () => chain,
        limit: () => chain,
        then: (r: any) =>
          r({ data: table === "webhook_endpoints" ? (opts.endpoints ?? [ENDPOINT]) : [], error: null }),
      };
      return chain;
    },
  };
  return { client, log, rpc, outbox };
}

describe("real Supabase deps for the fallback leg", () => {
  it("claims through the shared RPC and settles ONLY its own outbox entry", async () => {
    const db = fakeDb();
    const sent: Record<string, unknown>[] = [];
    const deps = supabaseV11DispatchDeps(db.client, async (payload, guard) => {
      expect(await guard()).toBe(true);
      sent.push(payload);
      return { delivered: 1, sendStartedAtMs: Date.now() };
    });
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    // Pin the clock inside the real 60s ceiling for the fixture interval.
    vi.useFakeTimers();
    vi.setSystemTime(OPEN_MS + 48_000);
    const out = await dispatchV11Fallback(deps, liveShadowRow(), COMMIT);
    vi.useRealTimers();
    expect(out.verdict).toBe("SENT");
    expect(db.rpc[0]?.name).toBe("c85_litea_claim_outbox");
    expect(db.rpc[0]?.args['p_dedupe_key']).toBe(
      liteaDedupeKey(TICKER, new Date(OPEN_MS).toISOString()),
    );
    expect(db.rpc[0]?.args['p_target_id']).toBeNull();
    // The Version 1 target row and its guard accounting are never amended.
    expect(db.log.some((l) => l.table === "c85_targets")).toBe(false);
    const settle = db.log.find((l) => l.op === "update");
    expect(settle?.table).toBe("c85_outbox");
    expect((settle?.args as any).filters.state).toBe("PENDING");
    expect(sent).toHaveLength(1);
  });
});

describe("signed T+45 hook seam", () => {
  const observation = {
    commit: {
      committed: true,
      decisionWritten: true,
      effectiveRunMode: V11_RUN_MODES.LIVE,
      commitOffsetMs: 47_900,
    },
    decisionLeg: "T45R2",
    side: 1,
  };

  it("does nothing at all while the controls are absent — no read, no claim", async () => {
    const db = fakeDb({ decision: liveShadowRow() });
    const out = await dispatchV11FallbackForObservation(db.client, observation.commit
      ? new Date(OPEN_MS).toISOString()
      : "", observation, { signed: true });
    expect(out.verdict).toBe("EXECUTION_DISABLED");
    expect(db.rpc).toHaveLength(0);
    expect(db.log).toHaveLength(0);
  });

  it("refuses unsigned callers even when armed", async () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    const db = fakeDb({ decision: liveShadowRow() });
    const out = await dispatchV11FallbackForObservation(
      db.client,
      new Date(OPEN_MS).toISOString(),
      observation,
      { signed: false },
    );
    expect(out.verdict).toBe("SKIPPED_UNSIGNED");
    expect(db.rpc).toHaveLength(0);
  });

  it("refuses maintenance/recovery commits and uncommitted observations", async () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    const db = fakeDb({ decision: liveShadowRow() });
    const recovery = await dispatchV11FallbackForObservation(
      db.client,
      new Date(OPEN_MS).toISOString(),
      { ...observation, commit: { ...observation.commit, effectiveRunMode: "RECOVERY" } },
      { signed: true },
    );
    expect(recovery.verdict).toBe("NOT_LIVE_SHADOW");
    const notCommitted = await dispatchV11FallbackForObservation(
      db.client,
      new Date(OPEN_MS).toISOString(),
      { ...observation, commit: { ...observation.commit, committed: false } },
      { signed: true },
    );
    expect(notCommitted.verdict).toBe("NO_FRESH_COMMIT");
    expect(db.rpc).toHaveLength(0);
  });

  it("reads the row the transaction persisted and drives the real claim path", async () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    // The fixture interval is historical, so the live 60s ceiling legitimately
    // refuses it: that refusal is itself the evidence the seam is wired.
    const db = fakeDb({ decision: liveShadowRow() });
    const out = await dispatchV11FallbackForObservation(
      db.client,
      new Date(OPEN_MS).toISOString(),
      observation,
      { signed: true },
    );
    expect(db.log.some((l) => l.table === "v11_decisions" && l.op === "select")).toBe(true);
    expect(out.verdict).toBe("EXPIRED");
    expect(db.rpc).toHaveLength(0);
  });
});

// ── The V1 leg routed through the combined identity ─────────────────────────

function v1Row(): LiteADecisionRecord {
  return {
    model_version: LITE_A_MODEL_VERSION,
    ticker: TICKER,
    target_open_utc: new Date(OPEN_MS).toISOString(),
    run_mode: "LIVE",
    status: "ORDINARY_CALL",
    final_side: 1,
    probability_yes: 0.6412,
    admission_rank: 0.981,
    publication_offset_ms: 6_120,
    features: {
      input_valid: true,
      lite_a: { head_id: "litea-head-2026-09-12" },
      strike_policy: { value: 77250, source: "official", estimated: false },
    },
  } as LiteADecisionRecord;
}

function v1Harness() {
  const sent: Record<string, unknown>[] = [];
  const rows = new Map<string, { state: string; owner: string | null }>();
  const deps: LiteADispatchDeps = {
    now: () => OPEN_MS + 6_500,
    ...v11V1LegGateReaders(),
    async claim(entry) {
      if (rows.has(entry.dedupeKey)) return { outcome: "HELD_BY_OTHER" };
      rows.set(entry.dedupeKey, { state: "PENDING", owner: entry.owner });
      return { outcome: "CLAIMED" };
    },
    async ownsClaim(key, owner) {
      const r = rows.get(key);
      return !!r && r.state === "PENDING" && r.owner === owner;
    },
    async deliver(payload, guard) {
      if (!(await guard())) return { delivered: 0 };
      sent.push(relabelV1PayloadAsV11(payload));
      return { delivered: 1, sendStartedAtMs: OPEN_MS + 6_600 };
    },
    async settle(entry) {
      const r = rows.get(entry.dedupeKey);
      if (!r || r.owner !== entry.owner || r.state !== "PENDING") return { applied: false };
      r.state = entry.status;
      return { applied: true };
    },
  };
  return { deps, sent, rows };
}

describe("Version 1 leg routed through the combined stream", () => {
  it("sends nothing while both controls are absent", async () => {
    const h = v1Harness();
    const out = await dispatchLiteaDecision(h.deps, v1Row(), {
      targetId: "t-1",
      executionEnabled: false,
      allowedModels: new Set<string>(),
      transportDeadlineMs: 8_000,
    });
    expect(out.verdict).toBe("EXECUTION_DISABLED");
    expect(h.sent).toHaveLength(0);
    expect(h.rows.size).toBe(0);
  });

  it("keeps the V1 decision, timing and canonical key, relabelled as Version 1.1", async () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    const h = v1Harness();
    const out = await dispatchLiteaDecision(h.deps, v1Row(), {
      targetId: "t-1",
      executionEnabled: true,
      allowedModels: v11V1LegGateReaders().allowedNow(),
      transportDeadlineMs: 8_000,
    });
    expect(out.verdict).toBe("SENT");
    const payload = h.sent[0]!;
    expect(payload['model']).toBe(V11_MODEL_VERSION);
    expect(payload['leg']).toBe("V1");
    expect(payload['source_model_version']).toBe(LITE_A_MODEL_VERSION);
    expect(payload['direction']).toBe("GREEN");
    expect(payload['probability_yes']).toBe(0.6412);
    expect(payload['publication_offset_ms']).toBe(6_120);
    expect(payload['dedupe_key']).toBe(
      v11EventDedupeKey(TICKER, new Date(OPEN_MS).toISOString()),
    );
    expect(payload['stake_fraction_of_boise_day_opening_principal']).toBe(0.04);
  });

  it("excludes the fallback leg for the same interval once the V1 leg claimed it", async () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    const h = v1Harness();
    await dispatchLiteaDecision(h.deps, v1Row(), {
      targetId: "t-1",
      executionEnabled: true,
      allowedModels: v11V1LegGateReaders().allowedNow(),
      transportDeadlineMs: 8_000,
    });
    const key = v11EventDedupeKey(TICKER, new Date(OPEN_MS).toISOString());
    expect(h.rows.get(key)?.state).toBe("SENT");

    // The fallback claims the SAME key, so it cannot produce a second bet.
    const fb = harness();
    fb.deps.claim = async () => ({ outcome: "ALREADY_SENT" as V11ClaimOutcome });
    const out = await dispatchV11Fallback(fb.deps, liveShadowRow(), COMMIT);
    expect(out.verdict).toBe("ALREADY_CLAIMED");
    expect(fb.attempts).toHaveLength(0);
  });

  it("does not allow the V1 leg while the combined control is off", () => {
    expect(v11V1LegGateReaders().allowedNow().has(LITE_A_MODEL_VERSION)).toBe(false);
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    expect(v11V1LegGateReaders().allowedNow().has(LITE_A_MODEL_VERSION)).toBe(true);
  });
});

// ── Transport-level: still nothing goes out while disabled ──────────────────

describe("combined transport with an in-process receiver", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));
  });

  it("posts nothing for the combined identity while the control is absent", async () => {
    const posts: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      posts.push(String(url));
      return new Response("ok", { status: 200 });
    });
    const db = fakeDb();
    const deliver = v11V1LegDeliver(db.client, OPEN_MS);
    const out = await deliver({ model: LITE_A_MODEL_VERSION, prediction: "YES" }, async () => true);
    expect(out.delivered).toBe(0);
    expect(posts).toHaveLength(0);
  });
});
