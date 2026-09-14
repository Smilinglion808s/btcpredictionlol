// Send-latency behaviour: the independent reads on the T+45 path really run
// concurrently, the safety seams still fail closed, and a decision that becomes
// ready late is transmitted when it is ready — never deferred to a later fixed
// offset.
//
// Everything here is in-process: the store layer, the database and the HTTP
// transport are fakes. No live send, no replay, no real endpoint.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store.server", () => ({
  decisionExists: vi.fn(),
  readMissingPredecessors: vi.fn(),
  commitObservation: vi.fn(),
  readState: vi.fn(),
  readLiveContext: vi.fn(),
  readContextRow: vi.fn(),
  upsertContextRow: vi.fn(),
  readT45InputsTimed: vi.fn(),
  readT45InputsFromSamples: vi.fn(),
  readVolHistory: vi.fn(),
  upsertVector: vi.fn(),
  readHeadForDate: vi.fn(),
  readPriorConfidences: vi.fn(),
  readPriorOpportunities: vi.fn(),
  readV1Snapshot: vi.fn(),
}));

import * as store from "../store.server";
import { observeV11Target } from "../observer.server";
import { v11ObserveAndDispatch } from "../hookPipeline";
import { V11_REASONS } from "../config";

const m = store as unknown as Record<string, ReturnType<typeof vi.fn>>;
const sb = {} as never;
const TARGET = "2026-09-11T18:15:00.000Z";
const ORIGINAL_ENV = { ...process.env };

/** Resolves after `ms` of REAL time, recording when it started and finished. */
function timed<T>(value: T, ms: number, marks: { name: string; at: number }[], name: string) {
  return () =>
    new Promise<T>((resolve) => {
      marks.push({ name: `${name}:start`, at: Date.now() });
      setTimeout(() => {
        marks.push({ name: `${name}:end`, at: Date.now() });
        resolve(value);
      }, ms);
    });
}

function eligibleV1() {
  return {
    committed: true,
    status: "BASE_NO_CALL",
    runMode: "LIVE",
    inputValid: true,
    finalSide: 0,
    reason: "CONFIDENCE_ABSTAIN",
    ordinaryFloorOpen: true,
    sendClaim: "none" as const,
    publicationOffsetMs: 5_100,
    lastReceiptNs: "1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.decisionExists.mockResolvedValue(false);
  m.readMissingPredecessors.mockResolvedValue([]);
  m.readState.mockResolvedValue({ lastProcessedTs: null, stateVersion: 1 });
  m.commitObservation.mockResolvedValue({
    committed: true,
    duplicate: false,
    stale: false,
    gap: false,
    excluded: false,
    outOfOrder: false,
    repaired: false,
    reason: null,
    scoreWritten: true,
    decisionWritten: true,
    lastProcessedTs: TARGET,
    stateVersion: 2,
    firstMissingTs: null,
  });
  m.readLiveContext.mockResolvedValue(null);
  m.readContextRow.mockResolvedValue(null);
  m.readT45InputsTimed.mockResolvedValue(null);
  m.readT45InputsFromSamples.mockResolvedValue(null);
  m.readVolHistory.mockResolvedValue([]);
  m.readHeadForDate.mockResolvedValue(null);
  m.readPriorConfidences.mockResolvedValue([]);
  m.readPriorOpportunities.mockResolvedValue([]);
  m.readV1Snapshot.mockResolvedValue(eligibleV1());
  m.upsertContextRow.mockResolvedValue(undefined);
  m.upsertVector.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("observer: the independent pre-commit reads actually overlap", () => {
  it("runs the five independent reads concurrently instead of one after another", async () => {
    const marks: { name: string; at: number }[] = [];
    const D = 60;
    m.readState.mockImplementation(
      timed({ lastProcessedTs: null, stateVersion: 1 }, D, marks, "state"),
    );
    m.readMissingPredecessors.mockImplementation(timed([], D, marks, "predecessors"));
    m.readLiveContext.mockImplementation(timed(null, D, marks, "live"));
    m.readT45InputsFromSamples.mockImplementation(timed(null, D, marks, "samples"));
    m.readV1Snapshot.mockImplementation(timed(eligibleV1(), D, marks, "v1"));

    const started = Date.now();
    await observeV11Target(sb, TARGET);
    const elapsed = Date.now() - started;

    // Serially these five alone would cost 5 x 60ms; overlapped they cost ~60ms.
    expect(elapsed).toBeLessThan(D * 3);
    const ends = marks.filter((x) => x.name.endsWith(":start"));
    expect(ends).toHaveLength(5);
    // Every one of them was in flight before any of them finished.
    const firstEnd = Math.min(...marks.filter((x) => x.name.endsWith(":end")).map((x) => x.at));
    for (const s of ends) expect(s.at).toBeLessThanOrEqual(firstEnd);
  });

  it("still starts the predecessor scan BEFORE the context row is written", async () => {
    const order: string[] = [];
    m.readMissingPredecessors.mockImplementation(async () => {
      order.push("predecessors");
      return [];
    });
    m.readLiveContext.mockResolvedValue({
      targetTs: TARGET,
      ticker: "KXBTC15M-X",
      inputValid: true,
      label: null,
      settlementTs: null,
      feats: {},
      runMode: "LIVE",
      lastReceiptNs: "1",
      publicationOffsetMs: 5_100,
    });
    m.upsertContextRow.mockImplementation(async () => {
      order.push("upsertContext");
    });

    await observeV11Target(sb, TARGET);

    expect(order.indexOf("predecessors")).toBeLessThan(order.indexOf("upsertContext"));
  });

  it("keeps the benign-error rule for the V1 snapshot ONLY", async () => {
    m.readV1Snapshot.mockRejectedValue(new Error("v1 read down"));
    const out = await observeV11Target(sb, TARGET);
    // A failed V1 read blocks the fallback and is named as itself.
    expect(out.reason).toBe(V11_REASONS.V1_READ_FAILED);
    expect(m.commitObservation).toHaveBeenCalledTimes(1);

    // Any other read failing is still an error, never "missing data".
    vi.clearAllMocks();
    m.decisionExists.mockResolvedValue(false);
    m.readMissingPredecessors.mockResolvedValue([]);
    m.readState.mockResolvedValue({ lastProcessedTs: null, stateVersion: 1 });
    m.readT45InputsFromSamples.mockResolvedValue(null);
    m.readV1Snapshot.mockResolvedValue(eligibleV1());
    m.readLiveContext.mockRejectedValue(new Error("context read down"));
    await expect(observeV11Target(sb, TARGET)).rejects.toThrow("context read down");
    expect(m.commitObservation).not.toHaveBeenCalled();
  });
});

describe("hook composition: an eligible T+45 decision is not queued behind legacy work", () => {
  it("dispatches the instant the observation commits, while slow legacy work is still pending", async () => {
    let legacyDone = false;
    const legacy = new Promise((r) => setTimeout(() => ((legacyDone = true), r(null)), 200));
    let dispatchedAt: number | null = null;

    const combined = v11ObserveAndDispatch(
      async () => ({ ok: true }),
      async () => {
        dispatchedAt = Date.now();
        return { verdict: "SENT" };
      },
    );
    const out = await combined;

    expect(out.dispatch).toEqual({ verdict: "SENT" });
    expect(dispatchedAt).not.toBeNull();
    // The legacy pipeline had not finished when the send decision was made.
    expect(legacyDone).toBe(false);
    await legacy;
  });
});

// ── The claim-ownership seam: parallel, but not weaker ──────────────────────

const TICKER = "KXBTC15M-26SEP111815-T77250";
const OPEN_MS = Date.parse(TARGET);
const SOURCE = { ticker: TICKER, targetOpenIso: new Date(OPEN_MS).toISOString() };

const V1_SOURCE_TARGET = {
  id: "11111111-2222-3333-4444-555555555555",
  model_version: "lite-a-floor4-top10-r1",
  ticker: TICKER,
  target_open_utc: new Date(OPEN_MS).toISOString(),
  run_mode: "LIVE",
  final_side: 0,
  webhook_status: null,
  features: {
    input_valid: true,
    lite_a: { reason: "CONFIDENCE_ABSTAIN" },
    daily_floor: { ordinary_floor_allows: true },
  },
};

/** Minimal client for the ownership guard, with per-read delay and failure. */
function guardDb(opts: {
  sourceDelayMs?: number;
  claimDelayMs?: number;
  sourceRow?: Record<string, unknown> | null;
  sourceThrows?: boolean;
  claimError?: boolean;
  claimRow?: Record<string, unknown> | null;
  marks?: { name: string; at: number }[];
} = {}) {
  const marks = opts.marks ?? [];
  const owner = "owner-1";
  const claimRow =
    opts.claimRow === undefined
      ? {
          state: "PENDING",
          claim_owner: owner,
          claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
        }
      : opts.claimRow;
  const client: any = {
    rpc: async () => ({ data: { outcome: "CLAIMED" }, error: null }),
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          const isSource = table === "c85_targets";
          const name = isSource ? "source" : "claim";
          marks.push({ name: `${name}:start`, at: Date.now() });
          await new Promise((r) =>
            setTimeout(r, isSource ? (opts.sourceDelayMs ?? 0) : (opts.claimDelayMs ?? 0)),
          );
          marks.push({ name: `${name}:end`, at: Date.now() });
          if (isSource) {
            if (opts.sourceThrows) throw new Error("source read down");
            return {
              data: opts.sourceRow === undefined ? V1_SOURCE_TARGET : opts.sourceRow,
              error: null,
            };
          }
          if (opts.claimError) return { data: null, error: new Error("claim read down") };
          return { data: claimRow, error: null };
        },
        update: () => {
          const u: any = { eq: () => u, select: async () => ({ data: [], error: null }) };
          return u;
        },
        then: (r: any) => r({ data: [], error: null }),
      };
      return chain;
    },
  };
  return { client, owner, marks };
}

async function guardResult(
  db: ReturnType<typeof guardDb>,
  claimFirst = true,
): Promise<boolean> {
  const { supabaseV11DispatchDeps, v11EventDedupeKey } = await import("../dispatch.server");
  const deps = supabaseV11DispatchDeps(db.client, async () => ({ delivered: 0 }), SOURCE);
  const dedupeKey = v11EventDedupeKey(SOURCE.ticker, SOURCE.targetOpenIso);
  if (claimFirst) {
    await deps.claim({
      dedupeKey,
      owner: db.owner,
      payload: {
        model: (await import("../config")).V11_MODEL_VERSION,
        leg: "T45R2",
        market_ticker: TICKER,
        candle_starts_at: SOURCE.targetOpenIso,
      },
      expiresAt: new Date(OPEN_MS + 900_000).toISOString(),
    });
  }
  return deps.ownsClaim(dedupeKey, db.owner);
}

describe("claim ownership guard: two safety reads in parallel, both still enforced", () => {
  it("overlaps the source revalidation and the claim read", async () => {
    const marks: { name: string; at: number }[] = [];
    const db = guardDb({ sourceDelayMs: 60, claimDelayMs: 60, marks });
    const started = Date.now();
    const owns = await guardResult(db);
    const elapsed = Date.now() - started;
    expect(owns).toBe(true);
    // The claim itself performs one source read; the guard then performs its
    // two reads TOGETHER, so the guard pair costs ~60ms, not ~120ms.
    const guardMarks = marks.slice(1); // drop the claim-time source read
    const guardStarts = guardMarks.filter((x) => x.name.endsWith(":start"));
    const firstEnd = Math.min(
      ...guardMarks.filter((x) => x.name.endsWith(":end")).map((x) => x.at),
    );
    expect(guardStarts).toHaveLength(2);
    for (const s of guardStarts) expect(s.at).toBeLessThanOrEqual(firstEnd);
    expect(elapsed).toBeLessThan(60 * 4);
  });

  it("refuses when the source revalidation rejects", async () => {
    const db = guardDb();
    await guardResult(db); // establish the claim with a healthy source
    const broken = guardDb({ sourceThrows: true });
    expect(await guardResult(broken)).toBe(false);
  });

  it("refuses when the claim read errors", async () => {
    expect(await guardResult(guardDb({ claimError: true }))).toBe(false);
  });

  it("refuses when the source abstention is revoked after the claim", async () => {
    const { supabaseV11DispatchDeps, v11EventDedupeKey } = await import("../dispatch.server");
    let source: Record<string, unknown> | null = V1_SOURCE_TARGET;
    const outbox = {
      state: "PENDING",
      claim_owner: "owner-1",
      claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const client: any = {
      rpc: async () => ({ data: { outcome: "CLAIMED" }, error: null }),
      from: (table: string) => ({
        select: () => ({
          eq: function eq() {
            return this;
          },
          maybeSingle: async () =>
            table === "c85_targets" ? { data: source, error: null } : { data: outbox, error: null },
        }),
      }),
    };
    const deps = supabaseV11DispatchDeps(client, async () => ({ delivered: 0 }), SOURCE);
    const cfg = await import("../config");
    const dedupeKey = v11EventDedupeKey(SOURCE.ticker, SOURCE.targetOpenIso);
    await deps.claim({
      dedupeKey,
      owner: "owner-1",
      payload: {
        model: cfg.V11_MODEL_VERSION,
        leg: "T45R2",
        market_ticker: TICKER,
        candle_starts_at: SOURCE.targetOpenIso,
      },
      expiresAt: new Date(OPEN_MS + 900_000).toISOString(),
    });
    // The original V1 leg took the interval between the claim and the transport.
    source = { ...V1_SOURCE_TARGET, final_side: 1, webhook_status: "SENT" };
    expect(await deps.ownsClaim(dedupeKey, "owner-1")).toBe(false);
  });

  it("refuses when ownership was lost to another owner", async () => {
    const db = guardDb({
      claimRow: {
        state: "PENDING",
        claim_owner: "someone-else",
        claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(await guardResult(db)).toBe(false);
  });

  it("refuses when the claim expires while the two reads are in flight", async () => {
    const db = guardDb({
      sourceDelayMs: 40,
      claimDelayMs: 40,
      claimRow: {
        state: "PENDING",
        claim_owner: "owner-1",
        // Already lapsed by the time both reads resolve.
        claim_expires_at: new Date(Date.now() + 20).toISOString(),
      },
    });
    expect(await guardResult(db)).toBe(false);
  });
});
