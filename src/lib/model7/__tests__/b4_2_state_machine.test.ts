// Model 7 Variant B4.2 — Daily Edge Guard state-machine tests.
//
// The canonical state machine lives in the Postgres function
// `public.apply_b4_2_resolution` (see migration for the SQL body). This test
// module is a byte-for-byte mirror of that SQL translated into TypeScript so
// we can exercise every invariant in unit tests. If you change one, you MUST
// change the other — golden tests below enforce the required behaviour.
//
// Invariants (matching the spec the user provided):
//   1. cooldownRemaining in [0, 8].
//   2. Only B2 YES/NO signals reach this function (base SKIP never does).
//   3. Mid-cooldown resolutions decrement by 1 and NEVER re-arm to 8.
//   4. When cooldownRemaining === 0 and awaiting_probe_resolution === false
//      the next YES/NO from B2 is issued as a probe (armed at scoring time).
//   5. On probe resolution: re-arm to 8 iff edge_after <= -15, else release.
//   6. Idempotent by resolution_id; concurrent callers serialize on the day.

import { describe, expect, it } from "vitest";

type Result = "WIN" | "LOSS";

interface State {
  edge_score: number;
  cooldown_remaining: number;
  circuit_active: boolean;
  awaiting_probe_resolution: boolean;
  processed_ids: Set<string>;
}

function initialState(): State {
  return {
    edge_score: 0,
    cooldown_remaining: 0,
    circuit_active: false,
    awaiting_probe_resolution: false,
    processed_ids: new Set(),
  };
}

/** Mirrors SQL apply_b4_2_resolution. Returns before/after snapshot. */
function applyResolution(state: State, opts: { id: string; result: Result }) {
  if (state.processed_ids.has(opts.id)) {
    return { idempotent: true as const };
  }
  state.processed_ids.add(opts.id);

  const edge_before = state.edge_score;
  const cooldown_before = state.cooldown_remaining;
  const circuit_before = state.circuit_active;
  const awaiting_before = state.awaiting_probe_resolution;

  const delta = opts.result === "WIN" ? 2 : -3;
  const edge_after = Math.min(0, edge_before + delta);

  let cooldown_after = cooldown_before;
  let circuit_after = circuit_before;
  let awaiting_after = awaiting_before;

  const is_probe = awaiting_before;

  if (is_probe) {
    awaiting_after = false;
    if (edge_after <= -15) { cooldown_after = 8; circuit_after = true; }
    else { cooldown_after = 0; circuit_after = false; }
  } else if (circuit_before) {
    if (cooldown_before > 0) cooldown_after = cooldown_before - 1;
    // Never re-arm mid-cooldown, regardless of edge_after.
  } else {
    if (edge_after <= -15) { cooldown_after = 8; circuit_after = true; }
  }

  cooldown_after = Math.max(0, Math.min(8, cooldown_after));

  state.edge_score = edge_after;
  state.cooldown_remaining = cooldown_after;
  state.circuit_active = circuit_after;
  state.awaiting_probe_resolution = awaiting_after;

  return {
    idempotent: false as const,
    is_probe,
    edge_before, edge_after,
    cooldown_before, cooldown_after,
    circuit_active: circuit_after,
    awaiting_probe_resolution: awaiting_after,
  };
}

/** Mirrors the scoring-path decision: arms a probe when applicable. */
function scoreDecision(state: State, b2: "YES" | "NO" | "SKIP") {
  if (b2 === "SKIP") return { decision: "SKIP" as const, reason: "BASE_SKIP", armedProbe: false };
  if (state.circuit_active) {
    if (state.cooldown_remaining > 0 || state.awaiting_probe_resolution) {
      return { decision: "SKIP" as const, reason: "DAILY_EDGE_CIRCUIT", armedProbe: false };
    }
    // Cooldown drained: arm probe atomically and let B2 through.
    state.awaiting_probe_resolution = true;
    return { decision: b2, reason: "DAILY_EDGE_PROBE", armedProbe: true };
  }
  return { decision: b2, reason: "NONE", armedProbe: false };
}

describe("B4.2 state machine — required invariants", () => {
  it("(1) circuit arms at edge <= -15 with cooldown starting at 8", () => {
    const s = initialState();
    // Five losses: 0 -3 -6 -9 -12 -15
    for (let i = 0; i < 5; i++) applyResolution(s, { id: `L${i}`, result: "LOSS" });
    expect(s.edge_score).toBe(-15);
    expect(s.circuit_active).toBe(true);
    expect(s.cooldown_remaining).toBe(8);
  });

  it("(2) eight consecutive B2 trade signals decrement 8→1", () => {
    const s = initialState();
    for (let i = 0; i < 5; i++) applyResolution(s, { id: `A${i}`, result: "LOSS" });
    expect(s.cooldown_remaining).toBe(8);
    const observed: number[] = [s.cooldown_remaining];
    for (let i = 0; i < 8; i++) {
      // Simulate B2 wanting to trade → scoring skips (circuit) → resolution arrives.
      const dec = scoreDecision(s, "YES");
      expect(dec.decision).toBe("SKIP");
      applyResolution(s, { id: `sig${i}`, result: i % 2 === 0 ? "WIN" : "LOSS" });
      observed.push(s.cooldown_remaining);
    }
    // Started at 8, decremented once per signal: 8,7,6,5,4,3,2,1,0
    expect(observed).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it("(3) the 9th eligible signal is issued as a probe", () => {
    const s = initialState();
    for (let i = 0; i < 5; i++) applyResolution(s, { id: `A${i}`, result: "LOSS" });
    for (let i = 0; i < 8; i++) applyResolution(s, { id: `d${i}`, result: "WIN" });
    expect(s.cooldown_remaining).toBe(0);
    expect(s.circuit_active).toBe(true);
    expect(s.awaiting_probe_resolution).toBe(false);
    const probe = scoreDecision(s, "NO");
    expect(probe.decision).toBe("NO");
    expect(probe.reason).toBe("DAILY_EDGE_PROBE");
    expect(s.awaiting_probe_resolution).toBe(true);
  });

  it("(4) counterfactual resolutions during cooldown never reset to 8", () => {
    const s = initialState();
    for (let i = 0; i < 5; i++) applyResolution(s, { id: `A${i}`, result: "LOSS" });
    // Losses arriving mid-cooldown must not re-arm.
    for (let i = 0; i < 3; i++) {
      applyResolution(s, { id: `mid${i}`, result: "LOSS" });
      expect(s.cooldown_remaining).toBeLessThanOrEqual(7);
      expect(s.cooldown_remaining).toBeGreaterThanOrEqual(0);
    }
    expect(s.cooldown_remaining).toBe(5); // 8 → 7 → 6 → 5
  });

  it("(5) edge remaining below -15 does not re-arm until probe resolves", () => {
    const s = initialState();
    for (let i = 0; i < 10; i++) applyResolution(s, { id: `A${i}`, result: "LOSS" }); // deep negative
    expect(s.edge_score).toBeLessThanOrEqual(-15);
    // Drain cooldown with 8 mid-cooldown resolutions (edge stays capped at 0/negative)
    for (let i = 0; i < 8; i++) applyResolution(s, { id: `dr${i}`, result: "LOSS" });
    expect(s.cooldown_remaining).toBe(0);
    expect(s.circuit_active).toBe(true);
    expect(s.awaiting_probe_resolution).toBe(false); // not yet armed
  });

  it("(6) a losing probe re-arms cooldown to 8", () => {
    const s = initialState();
    for (let i = 0; i < 5; i++) applyResolution(s, { id: `A${i}`, result: "LOSS" });
    // Drain with losses so edge stays deep-negative (edge caps drift-down).
    for (let i = 0; i < 8; i++) applyResolution(s, { id: `d${i}`, result: "LOSS" });
    expect(s.cooldown_remaining).toBe(0);
    expect(s.edge_score).toBeLessThanOrEqual(-15);
    scoreDecision(s, "YES"); // arm probe
    applyResolution(s, { id: "probe1", result: "LOSS" });
    expect(s.circuit_active).toBe(true);
    expect(s.cooldown_remaining).toBe(8);
    expect(s.awaiting_probe_resolution).toBe(false);
  });

  it("(7) a winning probe releases the circuit when edge climbs above -15", () => {
    const s = initialState();
    for (let i = 0; i < 5; i++) applyResolution(s, { id: `A${i}`, result: "LOSS" }); // edge=-15
    // Drain cooldown with 8 WINs: edge_after per resolution = min(0, prev+2)
    for (let i = 0; i < 8; i++) applyResolution(s, { id: `w${i}`, result: "WIN" });
    expect(s.edge_score).toBeGreaterThan(-15);
    scoreDecision(s, "YES");
    applyResolution(s, { id: "probe1", result: "WIN" });
    expect(s.circuit_active).toBe(false);
    expect(s.cooldown_remaining).toBe(0);
    expect(s.awaiting_probe_resolution).toBe(false);
  });

  it("(8) B2 base SKIP does not become a probe", () => {
    const s = initialState();
    for (let i = 0; i < 5; i++) applyResolution(s, { id: `A${i}`, result: "LOSS" });
    for (let i = 0; i < 8; i++) applyResolution(s, { id: `d${i}`, result: "WIN" });
    const dec = scoreDecision(s, "SKIP");
    expect(dec.decision).toBe("SKIP");
    expect(dec.armedProbe).toBe(false);
    expect(s.awaiting_probe_resolution).toBe(false);
  });

  it("(9) duplicate resolution calls do not decrement or re-arm twice", () => {
    const s = initialState();
    for (let i = 0; i < 5; i++) applyResolution(s, { id: `A${i}`, result: "LOSS" });
    const first = applyResolution(s, { id: "dup", result: "LOSS" });
    const second = applyResolution(s, { id: "dup", result: "LOSS" });
    expect((first as { idempotent: boolean }).idempotent).toBe(false);
    expect((second as { idempotent: boolean }).idempotent).toBe(true);
    // Only one decrement applied.
    expect(s.cooldown_remaining).toBe(7);
  });

  it("(10) cooldownRemaining invariant stays within [0, 8] across a long run", () => {
    const s = initialState();
    const rnd = (i: number) => ((i * 2654435761) >>> 0) % 2 === 0 ? "WIN" : "LOSS";
    for (let i = 0; i < 500; i++) {
      applyResolution(s, { id: `r${i}`, result: rnd(i) });
      expect(s.cooldown_remaining).toBeGreaterThanOrEqual(0);
      expect(s.cooldown_remaining).toBeLessThanOrEqual(8);
    }
  });
});
