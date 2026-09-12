// Observer-level behaviour: duplicates, restart, late receipt, fail-closed.
// The store layer is mocked so no database or network access occurs.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store.server", () => ({
  scoreExists: vi.fn(),
  readLiveContext: vi.fn(),
  readContextRow: vi.fn(),
  upsertContextRow: vi.fn(),
  readT45Inputs: vi.fn(),
  readT45InputsTimed: vi.fn(),
  readVolHistory: vi.fn(),
  upsertVector: vi.fn(),
  readHeadForDate: vi.fn(),
  readPriorScores: vi.fn(),
  appendScore: vi.fn(),
  insertDecision: vi.fn(),
  advanceState: vi.fn(),
  readV1Snapshot: vi.fn(),
}));

import * as store from "../store.server";
import { observeV11Target } from "../observer.server";
import { V11_REASONS, V11_VOL_SOURCE } from "../config";

const sb = {} as never;
const TARGET = "2026-09-11T18:15:00.000Z";

const m = store as unknown as Record<string, ReturnType<typeof vi.fn>>;

function abstainingV1() {
  return {
    committed: true,
    status: "BASE_NO_CALL",
    inputValid: true,
    finalSide: 0,
    reason: "CONFIDENCE_ABSTAIN",
    ordinaryFloorOpen: true,
    sendClaim: "none" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.scoreExists.mockResolvedValue(false);
  m.readLiveContext.mockResolvedValue(null);
  m.readContextRow.mockResolvedValue(null);
  m.readT45Inputs.mockResolvedValue(null);
  m.readT45InputsTimed.mockResolvedValue(null);
  m.readVolHistory.mockResolvedValue([]);
  m.readHeadForDate.mockResolvedValue(null);
  m.readPriorScores.mockResolvedValue([]);
  m.readV1Snapshot.mockResolvedValue(abstainingV1());
  m.upsertContextRow.mockResolvedValue(undefined);
  m.upsertVector.mockResolvedValue(undefined);
  m.appendScore.mockResolvedValue(undefined);
  m.insertDecision.mockResolvedValue(undefined);
  m.advanceState.mockResolvedValue(undefined);
});

describe("observeV11Target", () => {
  it("is a no-op on a duplicate target (exactly once per target)", async () => {
    m.scoreExists.mockResolvedValue(true);
    const res = await observeV11Target(sb, TARGET);
    expect(res.duplicate).toBe(true);
    expect(res.processed).toBe(false);
    expect(m.appendScore).not.toHaveBeenCalled();
    expect(m.insertDecision).not.toHaveBeenCalled();
    expect(m.advanceState).not.toHaveBeenCalled();
  });

  it("fails closed with no context and still appends an invalid score", async () => {
    const res = await observeV11Target(sb, TARGET);
    expect(res.scoreValid).toBe(false);
    expect(res.decisionLeg).toBeNull();
    expect(res.side).toBe(0);
    expect(m.appendScore).toHaveBeenCalledTimes(1);
    expect(m.appendScore.mock.calls[0][1].reason).toBe(V11_REASONS.MISSING_CONTEXT);
    expect(m.advanceState).toHaveBeenCalledTimes(1);
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
    expect(m.appendScore.mock.calls[0][1].reason).toBe(V11_REASONS.MISSING_T45);
    expect(res.decisionLeg).toBeNull();
  });

  it("fails closed when no daily head is available (restart before fit)", async () => {
    m.readContextRow.mockResolvedValue({
      targetTs: TARGET,
      ticker: "T",
      inputValid: true,
      label: null,
      settlementTs: null,
      feats: Object.fromEntries(
        [...new Array(60).keys()].map((i) => [`f${i}`, 1]),
      ),
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

  it("records every decision as shadow-only strategy metadata", async () => {
    await observeV11Target(sb, TARGET);
    const row = m.insertDecision.mock.calls[0][1];
    expect(row.leg).toBeNull();
    expect(row.strategy.publication_mode).toBeDefined();
    expect(row.strategy.sizing_owner).toBe("external-betting-bot");
  });
});
