// Version 1 dispatch path proof — worker request -> gateway gate -> durable
// idempotent outbox -> existing payload -> IN-PROCESS FAKE receiver.
//
// No network request is made anywhere in this file, no real endpoint is used
// and no database is touched. This is a software-path proof, not evidence that
// any bet was or could be placed.

import { describe, expect, it } from "vitest";
import {
  dispatchLiteaDecision,
  evaluateLiteaDispatch,
  liteaServerExecutionEnabled,
  liteaTransportDeadlineMs,
  LITEA_DEFAULT_TRANSPORT_DEADLINE_MS,
  type LiteADecisionRecord,
  type LiteADispatchDeps,
} from "../dispatch.server";
import { LITE_A_MODEL_VERSION } from "@/lib/c85/config";

const TARGET_OPEN = "2026-09-10T18:15:00.000Z";
const OPEN_MS = Date.parse(TARGET_OPEN);

const admitted: LiteADecisionRecord = {
  model_version: LITE_A_MODEL_VERSION,
  ticker: "KXBTC15M-26SEP101815-T77250",
  target_open_utc: TARGET_OPEN,
  run_mode: "LIVE",
  status: "ORDINARY_CALL",
  final_side: 1,
  probability_yes: 0.6412,
  admission_rank: 0.981,
  publication_offset_ms: 6120,
  packet_freeze_ns: "1789067705000000000",
  decision_durable_ns: "1789067706120000000",
  features: {
    input_valid: true,
    lite_a: { head_id: "litea-head-2026-09-10" },
    strike_policy: { value: 77250, source: "official", estimated: false },
  },
};

const allowed = new Set([LITE_A_MODEL_VERSION]);

/** Local stand-in for the bot and the outbox. Nothing leaves the process. */
function harness(opts: {
  clock: number[];
  accept?: boolean;
  existing?: string;
  enabledNow?: () => boolean;
}) {
  const reserved: any[] = [];
  const settled: any[] = [];
  const received: any[] = [];
  const clock = [...opts.clock];
  const table = new Map<string, { state: string; owner: string | null }>();
  if (opts.existing) table.set(opts.existing, { state: "SENT", owner: null });
  const deps: LiteADispatchDeps = {
    now: () => (clock.length > 1 ? clock.shift()! : clock[0]!),
    isEnabledNow: opts.enabledNow ?? (() => true),
    allowedNow: () => allowed,
    async claim(entry) {
      reserved.push(entry);
      const prior = table.get(entry.dedupeKey);
      if (prior?.state === "SENT") return { outcome: "ALREADY_SENT" as const };
      if (prior && prior.state !== "PENDING") return { outcome: "TERMINAL" as const };
      if (prior && prior.owner !== entry.owner) return { outcome: "HELD_BY_OTHER" as const };
      table.set(entry.dedupeKey, { state: "PENDING", owner: entry.owner });
      return { outcome: "CLAIMED" as const };
    },
    async ownsClaim(key, owner) {
      const row = table.get(key);
      return !!row && row.state === "PENDING" && row.owner === owner;
    },
    async deliver(payload, guard) {
      if (!(await guard())) return { delivered: 0 };
      received.push(payload);
      return { delivered: opts.accept === false ? 0 : 1 };
    },
    async settle(entry) {
      settled.push(entry);
      table.set(entry.dedupeKey, { state: entry.status, owner: null });
    },
  };
  return { deps, reserved, settled, received, table };
}


describe("Version 1 dispatch controls (default state)", () => {
  it("has both human controls off in this environment", () => {
    expect(liteaServerExecutionEnabled()).toBe(false);
    expect(liteaTransportDeadlineMs()).toBe(LITEA_DEFAULT_TRANSPORT_DEADLINE_MS);
  });

  it("sends nothing and reserves nothing while disabled", async () => {
    const h = harness({ clock: [OPEN_MS + 6500] });
    const out = await dispatchLiteaDecision(h.deps, admitted, {
      targetId: "t1",
      executionEnabled: liteaServerExecutionEnabled(),
      allowedModels: new Set(["t45-priceflow"]),
      transportDeadlineMs: liteaTransportDeadlineMs(),
    });
    expect(out.verdict).toBe("EXECUTION_DISABLED");
    expect(h.reserved).toHaveLength(0);
    expect(h.received).toHaveLength(0);
  });

  it("still refuses when only the switch is on but the model is not allow-listed", async () => {
    const h = harness({ clock: [OPEN_MS + 6500] });
    const out = await dispatchLiteaDecision(h.deps, admitted, {
      targetId: "t1",
      executionEnabled: true,
      allowedModels: new Set(["t45-priceflow"]),
      transportDeadlineMs: 8000,
    });
    expect(out.verdict).toBe("NOT_IN_ALLOWLIST");
    expect(h.received).toHaveLength(0);
  });
});

describe("Version 1 admitted call, fully enabled in-process", () => {
  it("reserves once, sends the persisted decision, and records SENT", async () => {
    const h = harness({ clock: [OPEN_MS + 6200, OPEN_MS + 6300, OPEN_MS + 6400] });
    const out = await dispatchLiteaDecision(h.deps, admitted, {
      targetId: "t1",
      executionEnabled: true,
      allowedModels: allowed,
      transportDeadlineMs: 8000,
    });
    expect(out.verdict).toBe("SENT");
    expect(h.reserved).toHaveLength(1);
    expect(h.received).toHaveLength(1);
    const p = h.received[0];
    expect(p.model).toBe(LITE_A_MODEL_VERSION);
    expect(p.prediction).toBe("YES");
    expect(p.market_ticker).toBe(admitted.ticker);
    expect(p.strike).toBe(77250);
    expect(p.strike_source).toBe("official");
    expect(p.dedupe_key).toBe(out.dedupeKey);
    expect(p).not.toHaveProperty("fill_price");
    expect(h.settled[0].status).toBe("SENT");
  });

  it("records FAILED without a second reservation when nothing accepts", async () => {
    const h = harness({ clock: [OPEN_MS + 6200], accept: false });
    const out = await dispatchLiteaDecision(h.deps, admitted, {
      targetId: "t1",
      executionEnabled: true,
      allowedModels: allowed,
      transportDeadlineMs: 8000,
    });
    expect(out.verdict).toBe("FAILED");
    expect(h.reserved).toHaveLength(1);
    expect(h.settled[0].error).toBe("no_endpoint_accepted");
  });

  it("collapses a retry onto the same event identity and never re-sends", async () => {
    const first = harness({ clock: [OPEN_MS + 6200] });
    const sent = await dispatchLiteaDecision(first.deps, admitted, {
      targetId: "t1",
      executionEnabled: true,
      allowedModels: allowed,
      transportDeadlineMs: 8000,
    });
    const replay = harness({ clock: [OPEN_MS + 6900], existing: sent.dedupeKey! });
    const out = await dispatchLiteaDecision(replay.deps, admitted, {
      targetId: "t1",
      executionEnabled: true,
      allowedModels: allowed,
      transportDeadlineMs: 8000,
    });
    expect(out.verdict).toBe("ALREADY_SENT");
    expect(replay.received).toHaveLength(0);
  });

  it("stops a prepared retry that expires between reservation and send", async () => {
    // Intake inside the ceiling, wall clock past it by the time we send.
    const h = harness({ clock: [OPEN_MS + 7900, OPEN_MS + 8300] });
    const out = await dispatchLiteaDecision(h.deps, admitted, {
      targetId: "t1",
      executionEnabled: true,
      allowedModels: allowed,
      transportDeadlineMs: 8000,
    });
    expect(out.verdict).toBe("EXPIRED");
    expect(h.received).toHaveLength(0);
    expect(h.settled[0].status).toBe("EXPIRED");
  });

  it("stops a prepared retry when the control is switched off first", async () => {
    const h = harness({ clock: [OPEN_MS + 6200] });
    const out = await dispatchLiteaDecision(h.deps, admitted, {
      targetId: "t1",
      executionEnabled: false,
      allowedModels: allowed,
      transportDeadlineMs: 8000,
    });
    expect(out.verdict).toBe("EXECUTION_DISABLED");
    expect(h.received).toHaveLength(0);
  });
});

describe("Version 1 row-level rejections", () => {
  const verdict = (over: Partial<LiteADecisionRecord>, nowMs = OPEN_MS + 6000) =>
    evaluateLiteaDispatch(
      { ...admitted, ...over },
      {
        nowMs,
        executionEnabled: true,
        allowedModels: allowed,
        alreadySent: false,
        transportDeadlineMs: 8000,
      },
    );

  it("accepts the admitted call and rejects everything else", () => {
    expect(verdict({})).toBe("WOULD_SEND");
    expect(verdict({ final_side: 0 })).toBe("ABSTAIN");
    expect(verdict({ run_mode: "RESEARCH" })).toBe("NOT_LIVE");
    expect(verdict({ model_version: "c85-multi-meta-r1" })).toBe("WRONG_MODEL_IDENTITY");
    expect(
      verdict({ features: { input_valid: false, lite_a: { head_id: "h" } } }),
    ).toBe("INPUT_INVALID");
    expect(verdict({ features: { input_valid: true, lite_a: {} } })).toBe("NO_HEAD");
    expect(verdict({ ticker: "" })).toBe("BAD_TARGET_IDENTITY");
    // NaN must be rejected, not slip through `NaN >= deadline` being false.
    expect(verdict({ publication_offset_ms: Number.NaN })).toBe("TIMING_UNAVAILABLE");
    expect(verdict({ publication_offset_ms: null })).toBe("TIMING_UNAVAILABLE");
    expect(verdict({ publication_offset_ms: -12 })).toBe("TIMING_UNAVAILABLE");
    // Clock behind the target open: unusable, never treated as fresh.
    expect(verdict({}, OPEN_MS - 1000)).toBe("TIMING_UNAVAILABLE");
    // An old shadow/history row can never be replayed into an order.
    expect(verdict({}, OPEN_MS + 3_600_000)).toBe("EXPIRED");
  });
});
