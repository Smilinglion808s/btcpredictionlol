// Observer-level behaviour: duplicates, restart, late receipt, run-mode
// honesty, gap detection, crash/concurrency and fail-closed abstention.
// The store layer is mocked, so no database or network access occurs.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store.server", () => ({
  decisionExists: vi.fn(),
  readMissingPredecessors: vi.fn(),
  commitObservation: vi.fn(),
  readState: vi.fn(),
  readLiveContext: vi.fn(),
  readContextRow: vi.fn(),
  upsertContextRow: vi.fn(),
  readT45InputsTimed: vi.fn(),
  readVolHistory: vi.fn(),
  upsertVector: vi.fn(),
  readHeadForDate: vi.fn(),
  readPriorConfidences: vi.fn(),
  readPriorOpportunities: vi.fn(),
  readV1Snapshot: vi.fn(),
}));


import * as store from "../store.server";
import { observeV11Target } from "../observer.server";
import { V11_REASONS, V11_RUN_MODES, V11_VOL_SOURCE } from "../config";

const sb = {} as never;
const TARGET = "2026-09-11T18:15:00.000Z";

const m = store as unknown as Record<string, ReturnType<typeof vi.fn>>;

/** The V1 snapshot that IS fallback-eligible: valid, low-confidence, floor open. */
function abstainingV1() {
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

/** Last committed score + decision handed to the atomic commit. */
const lastScore = () => m.commitObservation.mock.calls.at(-1)?.[2];
const lastDecision = () => m.commitObservation.mock.calls.at(-1)?.[3];

beforeEach(() => {
  vi.clearAllMocks();
  m.decisionExists.mockResolvedValue(false);
  m.readMissingPredecessors.mockResolvedValue([]);
  m.commitObservation.mockResolvedValue({
    scoreWritten: true,
    decisionWritten: true,
    lastProcessedTs: TARGET,
  });
  m.readLiveContext.mockResolvedValue(null);
  m.readContextRow.mockResolvedValue(null);
  m.readT45InputsTimed.mockResolvedValue(null);
  m.readVolHistory.mockResolvedValue([]);
  m.readHeadForDate.mockResolvedValue(null);
  m.readPriorConfidences.mockResolvedValue([]);
  m.readPriorOpportunities.mockResolvedValue([]);
  m.readV1Snapshot.mockResolvedValue(abstainingV1());
  m.upsertContextRow.mockResolvedValue(undefined);
  m.upsertVector.mockResolvedValue(undefined);
});

describe("observeV11Target", () => {
  it("is a no-op on a duplicate target (exactly once per target)", async () => {
    m.decisionExists.mockResolvedValue(true);
    const res = await observeV11Target(sb, TARGET);
    expect(res.duplicate).toBe(true);
    expect(res.processed).toBe(false);
    expect(m.commitObservation).not.toHaveBeenCalled();
  });

  it("fails closed with no context and still commits an invalid score", async () => {
    const res = await observeV11Target(sb, TARGET);
    expect(res.scoreValid).toBe(false);
    expect(res.decisionLeg).toBeNull();
    expect(res.side).toBe(0);
    expect(m.commitObservation).toHaveBeenCalledTimes(1);
    expect(lastScore().reason).toBe(V11_REASONS.MISSING_CONTEXT);
  });

  it("fails closed when T45 inputs are missing", async () => {
    m.readContextRow.mockResolvedValue({
      targetTs: TARGET,
      ticker: "T",
      inputValid: true,
      label: null,
      settlementTs: null,
      feats: { [V11_VOL_SOURCE]: 1 },
    });
    const res = await observeV11Target(sb, TARGET);
    expect(res.scoreValid).toBe(false);
    expect(lastScore().reason).toBe(V11_REASONS.MISSING_T45);
    expect(res.decisionLeg).toBeNull();
  });

  it("fails closed when no daily head is available (restart before fit)", async () => {
    m.readContextRow.mockResolvedValue({
      targetTs: TARGET,
      ticker: "T",
      inputValid: true,
      label: null,
      settlementTs: null,
      feats: Object.fromEntries([...new Array(60).keys()].map((i) => [`f${i}`, 1])),
    });
    m.readT45InputsTimed.mockResolvedValue({ feats: {}, persistedAt: null });
    m.readVolHistory.mockResolvedValue(new Array(96).fill(10));
    const res = await observeV11Target(sb, TARGET);
    expect(res.scoreValid).toBe(false);
    expect(res.decisionLeg).toBeNull();
    expect(res.side).toBe(0);
  });

  it("never admits a fallback when the V1 leg is unresolved (late receipt)", async () => {
    m.readV1Snapshot.mockResolvedValue({
      committed: false,
      status: null,
      runMode: null,
      inputValid: false,
      finalSide: null,
      reason: null,
      ordinaryFloorOpen: null,
      sendClaim: "none",
    });
    const res = await observeV11Target(sb, TARGET);
    expect(res.decisionLeg).toBeNull();
    expect(res.reason).toBe(V11_REASONS.V1_NOT_RESOLVED);
  });

  it("never admits a fallback when the V1 delivery claim is ambiguous", async () => {
    m.readV1Snapshot.mockResolvedValue({ ...abstainingV1(), sendClaim: "unknown" });
    const res = await observeV11Target(sb, TARGET);
    expect(res.decisionLeg).toBeNull();
    expect(res.reason).toBe(V11_REASONS.V1_DELIVERY_AMBIGUOUS);
  });

  it("fails closed and never guesses when the V1 read itself fails", async () => {
    m.readV1Snapshot.mockRejectedValue(new Error("connection reset"));
    const res = await observeV11Target(sb, TARGET);
    expect(res.decisionLeg).toBeNull();
    expect(res.reason).toBe(V11_REASONS.V1_READ_FAILED);
    expect(lastDecision().v1_send_claim).toBe("unknown");
  });

  it("records every decision as shadow-only strategy metadata", async () => {
    await observeV11Target(sb, TARGET);
    const row = lastDecision();
    expect(row.leg).toBeNull();
    expect(row.strategy.publication_mode).toBeDefined();
    expect(row.strategy.sizing_owner).toBe("external-betting-bot");
    expect(row.evidence.dispatch_enabled).toBe(false);
  });
});

describe("run mode is earned, not requested", () => {
  it("downgrades an unsigned live request to RECOVERY", async () => {
    const res = await observeV11Target(sb, TARGET, {
      requestedRunMode: V11_RUN_MODES.LIVE,
    });
    expect(res.runMode).toBe(V11_RUN_MODES.RECOVERY);
  });

  it("labels a signed live trigger LIVE_SHADOW only with a real receipt, a LIVE V1 row and no gaps", async () => {
    m.readT45InputsTimed.mockResolvedValue({
      feats: {},
      persistedAt: new Date(Date.parse(TARGET) + 45_400).toISOString(),
    });
    const res = await observeV11Target(sb, TARGET, {
      requestedRunMode: V11_RUN_MODES.LIVE,
      live: { signed: true, source: "t45-boundary-run", receivedAtMs: Date.now() },
      now: new Date(Date.parse(TARGET) + 47_000),
    });
    expect(res.runMode).toBe(V11_RUN_MODES.LIVE);
  });

  it("refuses LIVE_SHADOW past the 60s publication ceiling", async () => {
    m.readT45InputsTimed.mockResolvedValue({
      feats: {},
      persistedAt: new Date(Date.parse(TARGET) + 45_400).toISOString(),
    });
    const res = await observeV11Target(sb, TARGET, {
      requestedRunMode: V11_RUN_MODES.LIVE,
      live: { signed: true, source: "t45-boundary-run", receivedAtMs: Date.now() },
      now: new Date(Date.parse(TARGET) + 90_000),
    });
    expect(res.runMode).toBe(V11_RUN_MODES.RECOVERY);
    expect(lastDecision().within_publication_ceiling).toBe(false);
  });

  it("refuses LIVE_SHADOW for a RESEARCH V1 row", async () => {
    m.readV1Snapshot.mockResolvedValue({ ...abstainingV1(), runMode: "RESEARCH" });
    m.readT45InputsTimed.mockResolvedValue({
      feats: {},
      persistedAt: new Date(Date.parse(TARGET) + 45_400).toISOString(),
    });
    const res = await observeV11Target(sb, TARGET, {
      requestedRunMode: V11_RUN_MODES.LIVE,
      live: { signed: true, source: "t45-boundary-run", receivedAtMs: Date.now() },
      now: new Date(Date.parse(TARGET) + 47_000),
    });
    expect(res.runMode).toBe(V11_RUN_MODES.RECOVERY);
  });

  it("refuses LIVE_SHADOW while earlier opportunities are missing", async () => {
    m.readMissingPredecessors.mockResolvedValue(["2026-09-11T18:00:00.000Z"]);
    m.readT45InputsTimed.mockResolvedValue({
      feats: {},
      persistedAt: new Date(Date.parse(TARGET) + 45_400).toISOString(),
    });
    const res = await observeV11Target(sb, TARGET, {
      requestedRunMode: V11_RUN_MODES.LIVE,
      live: { signed: true, source: "t45-boundary-run", receivedAtMs: Date.now() },
      now: new Date(Date.parse(TARGET) + 47_000),
    });
    expect(res.runMode).toBe(V11_RUN_MODES.RECOVERY);
    expect(res.missingPredecessors).toHaveLength(1);
    expect(lastDecision().evidence.missing_predecessors).toBe(1);
  });
});

describe("atomic commit", () => {
  it("writes score, decision and checkpoint in one call, never separately", async () => {
    await observeV11Target(sb, TARGET);
    expect(m.commitObservation).toHaveBeenCalledTimes(1);
    const [, ts, score, decision] = m.commitObservation.mock.calls[0];
    expect(ts).toBe(TARGET);
    expect(score).toBeDefined();
    expect(decision).toBeDefined();
  });

  it("propagates a crash during the commit instead of reporting success", async () => {
    m.commitObservation.mockRejectedValue(new Error("connection lost"));
    await expect(observeV11Target(sb, TARGET)).rejects.toThrow("connection lost");
  });

  it("is a no-op for the loser of two concurrent runs on one target", async () => {
    let first = true;
    m.decisionExists.mockImplementation(async () => {
      if (first) {
        first = false;
        return false;
      }
      return true;
    });
    const [a, b] = await Promise.all([
      observeV11Target(sb, TARGET),
      observeV11Target(sb, TARGET),
    ]);
    expect([a.processed, b.processed].filter(Boolean)).toHaveLength(1);
    expect(m.commitObservation).toHaveBeenCalledTimes(1);
  });
});

describe("timing is recorded truthfully", () => {
  it("keeps the 45s event cutoff separate from actual receipt and enforces the 60s ceiling", async () => {
    m.readT45InputsTimed.mockResolvedValue({
      feats: {},
      persistedAt: new Date(Date.parse(TARGET) + 45_312).toISOString(),
    });
    await observeV11Target(sb, TARGET);
    const row = lastDecision();
    expect(row.event_cutoff_offset_ms).toBe(45_000);
    expect(row.inputs_persisted_offset_ms).toBe(45_312);
    expect(row.inputs_persisted_offset_ms).toBeGreaterThan(row.event_cutoff_offset_ms);
    expect(row.publication_ceiling_ms).toBe(60_000);
    expect(typeof row.within_publication_ceiling).toBe("boolean");
  });

  it("leaves receipt timing null instead of assuming 45000ms", async () => {
    m.readT45InputsTimed.mockResolvedValue({ feats: {}, persistedAt: null });
    await observeV11Target(sb, TARGET);
    expect(lastDecision().inputs_persisted_offset_ms).toBeNull();
  });
});
