// Cross89 — deterministic walk-forward replay (pure).
//
// Drives both the historical backtest and the live warm-up path so a live
// decision is byte-identical to the replayed one for the same inputs.

import {
  T30X_FAST_RANK_WINDOW,
  T30X_LONG_RANK_WINDOW,
  T30X_REASONS,
  type T30XDirection,
} from "./config";
import {
  blockStartFor,
  decideX89,
  fitX89Head,
  probabilityCorrect,
  trainingRangeFor,
  type X89Decision,
  type X89Head,
  type X89TrainingRow,
} from "./head";

export interface X89SourceRow {
  index: number;
  targetTs: string;
  /** 89-length model vector, or null when the packet/features are unusable. */
  vector: number[] | null;
  packetReady: boolean;
  spotTechReady: boolean;
  futTechReady: boolean;
  baseDirection: T30XDirection;
  /** Confirmed OKX direction: 1 GREEN, -1 RED, 0 PUSH, null unresolved. */
  okxDirection: number | null;
}

export interface X89ReplayRow extends X89Decision {
  index: number;
  targetTs: string;
  fitBlockStart: number | null;
  outcome: "WIN" | "LOSS" | "PUSH" | "ABSTAIN";
  rawScore: number;
  correctnessLabel: 0 | 1 | null;
}

export interface X89ReplaySummary {
  sourceRows: number;
  opportunities: number;
  trades: number;
  wins: number;
  losses: number;
  pushes: number;
  rawNet: number;
  winRate: number;
  coverage: number;
  maxDrawdown: number;
  maxLossStreak: number;
  decisionHash: string;
  fits: number;
}

/** Correctness label for a resolved row: did the 30s direction survive? */
export function correctnessLabelOf(
  baseDirection: T30XDirection,
  okxDirection: number | null,
): 0 | 1 | null {
  if (baseDirection === 0 || okxDirection == null || okxDirection === 0) return null;
  return baseDirection === okxDirection ? 1 : 0;
}

/** `target_ts|base_direction|model_would_trade`, one chronological row per line. */
export function decisionHashPayload(rows: readonly X89ReplayRow[]): string {
  return rows
    .map(
      (r) =>
        `${r.targetTs}|${r.baseDirection === 0 ? "null" : r.baseDirection}|${
          r.modelWouldTrade ? 1 : 0
        }`,
    )
    .join("\n");
}

export interface X89ReplayResult {
  rows: X89ReplayRow[];
  heads: Map<number, X89Head>;
  summary: Omit<X89ReplaySummary, "decisionHash">;
}

/**
 * Walk the chronological source rows once. Fits are minted lazily at each
 * 96-row block boundary from the strictly past-only training window; the block
 * being scored never enters its own fit.
 */
export function replayX89(rows: readonly X89SourceRow[]): X89ReplayResult {
  const heads = new Map<number, X89Head>();
  const probs: (number | null)[] = new Array(rows.length).fill(null);
  const out: X89ReplayRow[] = [];

  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let trades = 0;
  let opportunities = 0;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let lossStreak = 0;
  let maxLossStreak = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.packetReady && r.baseDirection !== 0) opportunities++;

    const blockStart = blockStartFor(i);
    let head: X89Head | null = null;
    if (blockStart != null) {
      head = heads.get(blockStart) ?? null;
      if (!head) {
        const { from, to } = trainingRangeFor(blockStart);
        const training: X89TrainingRow[] = [];
        for (let k = from; k < to; k++) {
          const s = rows[k];
          if (!s?.vector) continue;
          const label = correctnessLabelOf(s.baseDirection, s.okxDirection);
          if (label == null) continue;
          training.push({ targetTs: s.targetTs, index: k, vector: s.vector, label });
        }
        if (training.length > 0) {
          head = fitX89Head(blockStart, training);
          heads.set(blockStart, head);
        }
      }
    }

    const probability = head && r.vector ? probabilityCorrect(head, r.vector) : null;
    probs[i] = probability;

    const longHistory: number[] = [];
    if (i >= T30X_LONG_RANK_WINDOW) {
      let ok = true;
      for (let k = i - T30X_LONG_RANK_WINDOW; k < i; k++) {
        const p = probs[k];
        if (p == null || !Number.isFinite(p)) {
          ok = false;
          break;
        }
        longHistory.push(p);
      }
      if (!ok) longHistory.length = 0;
    }
    const fastHistory: number[] = [];
    if (i >= T30X_FAST_RANK_WINDOW) {
      let ok = true;
      for (let k = i - T30X_FAST_RANK_WINDOW; k < i; k++) {
        const p = probs[k];
        if (p == null || !Number.isFinite(p)) {
          ok = false;
          break;
        }
        fastHistory.push(p);
      }
      if (!ok) fastHistory.length = 0;
    }

    const decision = decideX89({
      packetReady: r.packetReady,
      baseDirection: r.baseDirection,
      spotTechReady: r.spotTechReady,
      futTechReady: r.futTechReady,
      vector: r.vector,
      head,
      probability,
      longHistory,
      fastHistory,
    });

    const correctnessLabel = correctnessLabelOf(r.baseDirection, r.okxDirection);
    let outcome: X89ReplayRow["outcome"] = "ABSTAIN";
    let rawScore = 0;
    if (decision.modelWouldTrade) {
      trades++;
      if (r.okxDirection === 0) {
        outcome = "PUSH";
        pushes++;
      } else if (correctnessLabel === 1) {
        outcome = "WIN";
        rawScore = 1;
        wins++;
      } else if (correctnessLabel === 0) {
        outcome = "LOSS";
        rawScore = -1;
        losses++;
      } else {
        outcome = "ABSTAIN";
        trades--;
      }
      equity += rawScore;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
      if (outcome === "LOSS") {
        lossStreak++;
        maxLossStreak = Math.max(maxLossStreak, lossStreak);
      } else if (outcome === "WIN") {
        lossStreak = 0;
      }
    }

    out.push({
      ...decision,
      index: i,
      targetTs: r.targetTs,
      fitBlockStart: blockStart,
      outcome,
      rawScore,
      correctnessLabel,
      reason: decision.reason || T30X_REASONS.PACKET_NOT_READY,
    });
  }

  const decided = wins + losses;
  return {
    rows: out,
    heads,
    summary: {
      sourceRows: rows.length,
      opportunities,
      trades,
      wins,
      losses,
      pushes,
      rawNet: wins - losses,
      winRate: decided > 0 ? (wins / decided) * 100 : 0,
      coverage: opportunities > 0 ? (trades / opportunities) * 100 : 0,
      maxDrawdown,
      maxLossStreak,
      fits: heads.size,
    },
  };
}
