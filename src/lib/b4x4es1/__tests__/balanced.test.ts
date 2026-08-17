import { describe, expect, it } from "vitest";
import {
  BALANCED_SHADOW_POLICIES,
  applyActivationGate,
  balancedConfigHash,
  decideBalanced,
  evaluateBalancedShadowPolicies,
  incrementalValue,
  marketReadinessFrom,
  scoreDirection,
  signVote,
  votePatternOf,
  type BalancedInput,
  type Direction,
  type MarketReadiness,
} from "../balanced";
import {
  BINANCE_OB_COLLECTOR_VERSION,
  BINANCE_OB_SYMBOL,
  BINANCE_OB_VENUE,
  BINANCE_OB_VERSION,
  binanceObConfigHash,
  binanceObFeatureSchemaHash,
} from "../binanceOb/config";

const TARGET = "2026-08-17T01:00:00.000Z";

function featureRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "feat-1",
    target_ts: TARGET,
    venue: BINANCE_OB_VENUE,
    symbol: BINANCE_OB_SYMBOL,
    feature_version: BINANCE_OB_VERSION,
    collector_version: BINANCE_OB_COLLECTOR_VERSION,
    config_hash: binanceObConfigHash(),
    feature_schema_hash: binanceObFeatureSchemaHash(),
    feature_values_hash: "vh",
    capture_status: "FRESH",
    ready: true,
    ready_reason: "READY",
    sequence_ok: true,
    book_complete_10bps: true,
    resync_continuous: true,
    resync_generation_min: 3,
    resync_generation_max: 3,
    final_received_at: "2026-08-17T00:59:58.000Z",
    final_exchange_event_ts: "2026-08-17T00:59:57.900Z",
    final_target_age_ms: 2100,
    observation_count_60s: 59,
    final_imbalance_10bps: 0.2,
    normalized_ofi_60s: 0.1,
    ...over,
  };
}

function ready(over: Record<string, unknown> = {}): MarketReadiness {
  return marketReadinessFrom(featureRow(over), { targetTs: TARGET });
}

function input(over: Partial<BalancedInput> = {}): BalancedInput {
  return {
    targetTs: TARGET,
    es1: {
      priceDirection: "GREEN",
      parityCertified: true,
      probabilityGreen: 0.61,
      confidence: 0.11,
      priceFitId: "fit-1",
      priceFitSource: "ts-lbfgs-certified",
    },
    spot: ready(),
    perp: ready({ id: "feat-2", final_imbalance_10bps: -0.3 }),
    activationBoundaryTs: null,
    ...over,
  };
}

/** Build an input that produces exactly the requested four votes. */
function withVotes(es1: 1 | -1, depth: 1 | -1, ofi: 1 | -1, perpFade: 1 | -1): BalancedInput {
  return input({
    es1: { ...input().es1, priceDirection: es1 === 1 ? "GREEN" : "RED" },
    spot: ready({ final_imbalance_10bps: depth * 0.2, normalized_ofi_60s: ofi * 0.1 }),
    // perp is faded: a GREEN perp vote requires a negative imbalance.
    perp: ready({ id: "feat-2", final_imbalance_10bps: -perpFade * 0.3 }),
  });
}

describe("frozen identity", () => {
  it("config hash is stable and deterministic", () => {
    expect(balancedConfigHash()).toBe(balancedConfigHash());
    expect(balancedConfigHash()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("vote mapping", () => {
  it("follow and fade mapping", () => {
    expect(signVote(0.5)).toBe(1);
    expect(signVote(-0.5)).toBe(-1);
    expect(signVote(0.5, true)).toBe(-1);
    expect(signVote(-0.5, true)).toBe(1);
  });

  it("zero, NaN, Infinity and missing all fail closed", () => {
    for (const v of [0, -0, NaN, Infinity, -Infinity, null, undefined]) {
      expect(signVote(v as number | null)).toBeNull();
      expect(signVote(v as number | null, true)).toBeNull();
    }
  });

  it("perpetual fade never reuses the spot value", () => {
    const d = decideBalanced(
      input({
        spot: ready({ final_imbalance_10bps: 0.4, normalized_ofi_60s: 0.4 }),
        perp: ready({ id: "p", final_imbalance_10bps: 0.4 }),
      }),
    );
    expect(d.spotDepthVote).toBe(1);
    expect(d.perpFadeVote).toBe(-1);
  });

  it("vote pattern is deterministic and readable", () => {
    expect(votePatternOf(-1, 1, 1, 1)).toBe(
      "ES1=RED|SPOT_DEPTH=GREEN|SPOT_OFI60=GREEN|PERP_FADE=GREEN",
    );
  });
});

describe("all sixteen vote combinations", () => {
  const combos: Array<[1 | -1, 1 | -1, 1 | -1, 1 | -1]> = [];
  for (const a of [1, -1] as const)
    for (const b of [1, -1] as const)
      for (const c of [1, -1] as const) for (const d of [1, -1] as const) combos.push([a, b, c, d]);

  it("covers 16 combinations with the frozen outcome", () => {
    expect(combos).toHaveLength(16);
    for (const [a, b, c, d] of combos) {
      const votes = [a, b, c, d];
      const green = votes.filter((v) => v === 1).length;
      const red = 4 - green;
      const decision = decideBalanced(withVotes(a, b, c, d));
      expect(decision.greenVoteCount).toBe(green);
      expect(decision.redVoteCount).toBe(red);
      expect(decision.voteSum).toBe(green - red);
      expect(decision.voteMargin).toBe(Math.abs(green - red));

      if (green === 4) {
        expect(decision.finalPrediction).toBe("GREEN");
        expect(decision.agreementTier).toBe("UNANIMOUS_4_OF_4");
        expect(decision.decisionReason).toBe("PUBLISH_BALANCED_4_OF_4_GREEN");
      } else if (red === 4) {
        expect(decision.finalPrediction).toBe("RED");
        expect(decision.agreementTier).toBe("UNANIMOUS_4_OF_4");
        expect(decision.decisionReason).toBe("PUBLISH_BALANCED_4_OF_4_RED");
      } else if (green === 3) {
        expect(decision.finalPrediction).toBe("GREEN");
        expect(decision.agreementTier).toBe("MAJORITY_3_OF_4");
        expect(decision.decisionReason).toBe("PUBLISH_BALANCED_3_OF_4_GREEN");
      } else if (red === 3) {
        expect(decision.finalPrediction).toBe("RED");
        expect(decision.agreementTier).toBe("MAJORITY_3_OF_4");
        expect(decision.decisionReason).toBe("PUBLISH_BALANCED_3_OF_4_RED");
      } else {
        expect(decision.finalPrediction).toBeNull();
        expect(decision.wouldTrade).toBe(false);
        expect(decision.agreementTier).toBe("TIE_2_OF_2");
        expect(decision.decisionReason).toBe("ABSTAIN_BALANCED_VOTE_TIE_2_2");
      }
    }
  });

  it("all six 2-2 ties abstain", () => {
    const ties: Array<[1 | -1, 1 | -1, 1 | -1, 1 | -1]> = [
      [1, 1, -1, -1],
      [1, -1, 1, -1],
      [1, -1, -1, 1],
      [-1, 1, 1, -1],
      [-1, 1, -1, 1],
      [-1, -1, 1, 1],
    ];
    for (const t of ties) {
      const d = decideBalanced(withVotes(...t));
      expect(d.wouldTrade).toBe(false);
      expect(d.decisionReason).toBe("ABSTAIN_BALANCED_VOTE_TIE_2_2");
    }
  });
});

describe("fail-closed readiness", () => {
  it("uncertified ES1 abstains before any Binance read", () => {
    const d = decideBalanced(input({ es1: { ...input().es1, parityCertified: false } }));
    expect(d.decisionReason).toBe("ABSTAIN_ES1_NOT_PARITY_CERTIFIED");
    expect(d.wouldTrade).toBe(false);
  });

  it("missing ES1 direction abstains", () => {
    const d = decideBalanced(input({ es1: { ...input().es1, priceDirection: null } }));
    expect(d.decisionReason).toBe("ABSTAIN_ES1_DIRECTION_INVALID");
  });

  it("spot and perp readiness fail independently", () => {
    expect(
      decideBalanced(input({ spot: ready({ capture_status: "STALE", ready: false }) }))
        .decisionReason,
    ).toBe("ABSTAIN_BINANCE_SPOT_NOT_READY");
    expect(
      decideBalanced(
        input({ perp: ready({ id: "p", capture_status: "NO_DATA", ready: false }) }),
      ).decisionReason,
    ).toBe("ABSTAIN_BINANCE_PERP_NOT_READY");
  });

  it("sequence or resync discontinuity abstains with the continuity reason", () => {
    for (const over of [
      { sequence_ok: false },
      { resync_continuous: false },
      { resync_continuous: null },
      { resync_generation_min: 2, resync_generation_max: 3 },
    ]) {
      const d = decideBalanced(input({ spot: ready(over) }));
      expect(d.decisionReason).toBe("ABSTAIN_BINANCE_SEQUENCE_NOT_CONTINUOUS");
    }
  });

  it("target timestamp mismatch fails closed", () => {
    const stale = marketReadinessFrom(featureRow({ target_ts: "2026-08-17T00:45:00.000Z" }), {
      targetTs: TARGET,
    });
    expect(stale.gateReason).toBe("TARGET_TS_MISMATCH");
    expect(decideBalanced(input({ spot: stale })).decisionReason).toBe(
      "ABSTAIN_BINANCE_SPOT_NOT_READY",
    );
  });

  it("version, config and schema mismatches fail closed", () => {
    for (const over of [
      { feature_version: "other" },
      { collector_version: "other" },
      { config_hash: "deadbeef" },
      { feature_schema_hash: "deadbeef" },
      { venue: "BINANCE_US" },
      { symbol: "ETHUSDT" },
    ]) {
      expect(marketReadinessFrom(featureRow(over), { targetTs: TARGET }).gateReason).toBeTruthy();
    }
  });

  it("missing boundary row, short window and bad age fail closed", () => {
    expect(marketReadinessFrom(null, { targetTs: TARGET }).gateReason).toBe("NO_BOUNDARY_FEATURE");
    expect(
      marketReadinessFrom(featureRow({ observation_count_60s: 49 }), { targetTs: TARGET })
        .gateReason,
    ).toBe("INSUFFICIENT_OBSERVATIONS");
    expect(
      marketReadinessFrom(featureRow({ final_target_age_ms: 5001 }), { targetTs: TARGET })
        .gateReason,
    ).toBe("TARGET_AGE_OUT_OF_RANGE");
    expect(
      marketReadinessFrom(featureRow({ final_received_at: null }), { targetTs: TARGET }).gateReason,
    ).toBe("NO_FINAL_OBSERVATION");
  });

  it("zero or non-finite feature values abstain as invalid features", () => {
    for (const over of [
      { final_imbalance_10bps: 0 },
      { normalized_ofi_60s: 0 },
      { normalized_ofi_60s: null },
    ]) {
      expect(decideBalanced(input({ spot: ready(over) })).decisionReason).toBe(
        "ABSTAIN_BINANCE_FEATURE_INVALID",
      );
    }
    expect(
      decideBalanced(input({ perp: ready({ id: "p", final_imbalance_10bps: 0 }) })).decisionReason,
    ).toBe("ABSTAIN_BINANCE_FEATURE_INVALID");
  });

  it("history readiness is not required", () => {
    const d = decideBalanced(input({ spot: ready({ history_ready: false }) }));
    expect(d.wouldTrade).toBe(true);
  });
});

describe("activation gate", () => {
  it("abstains before the activation boundary and trades at equality", () => {
    const d = decideBalanced(withVotes(1, 1, 1, 1));
    expect(applyActivationGate(d, TARGET, null).decisionReason).toBe(
      "ABSTAIN_BALANCED_ACTIVATION_NOT_REACHED",
    );
    expect(applyActivationGate(d, TARGET, "2026-08-17T01:15:00.000Z").wouldTrade).toBe(false);
    const atBoundary = applyActivationGate(d, TARGET, TARGET);
    expect(atBoundary.wouldTrade).toBe(true);
    expect(atBoundary.finalPrediction).toBe("GREEN");
  });
});

describe("shadow policies", () => {
  const legacy = { direction: "RED" as Direction, wouldTrade: true, decisionReason: "PUBLISH" };

  it("writes exactly one row per policy including abstentions", () => {
    const rows = evaluateBalancedShadowPolicies(decideBalanced(withVotes(1, 1, -1, 1)), legacy);
    expect(rows.map((r) => r.policy_name).sort()).toEqual([...BALANCED_SHADOW_POLICIES].sort());
    expect(new Set(rows.map((r) => r.policy_name)).size).toBe(9);
  });

  it("confirm policies only publish on agreement", () => {
    const rows = evaluateBalancedShadowPolicies(decideBalanced(withVotes(1, -1, -1, -1)), legacy);
    const by = Object.fromEntries(rows.map((r) => [r.policy_name, r]));
    expect(by.ES1_PRICE_HEAD_ALL_R1.candidate_direction).toBe("GREEN");
    expect(by.BINANCE_SPOT_DEPTH_FOLLOW_R1.candidate_direction).toBe("RED");
    expect(by.ES1_SPOT_DEPTH_CONFIRM_R1.would_trade).toBe(false);
    expect(by.BINANCE_OB_UNANIMOUS_3OF3_R1.candidate_direction).toBe("RED");
    expect(by.ES1_BINANCE_UNANIMOUS_4OF4_R1.would_trade).toBe(false);
    expect(by.ES1_BINANCE_3OF4_BALANCED_R1.candidate_direction).toBe("RED");
    expect(by.ES1_BINANCE_3OF4_BALANCED_R1.is_active_policy).toBe(true);
    expect(by.LEGACY_B4X4_ES1_POLICY.candidate_direction).toBe("RED");
  });

  it("only the balanced policy is ever marked active", () => {
    const rows = evaluateBalancedShadowPolicies(decideBalanced(withVotes(1, 1, 1, 1)), legacy);
    expect(rows.filter((r) => r.is_active_policy)).toHaveLength(1);
  });
});

describe("scoring and attribution", () => {
  it("win, loss, push and abstain", () => {
    expect(scoreDirection("GREEN", "GREEN")).toEqual({ result: "WIN", score: 1 });
    expect(scoreDirection("GREEN", "RED")).toEqual({ result: "LOSS", score: -1 });
    expect(scoreDirection("GREEN", "PUSH")).toEqual({ result: "PUSH", score: 0 });
    expect(scoreDirection(null, "GREEN")).toEqual({ result: null, score: 0 });
  });

  it("incremental value versus legacy", () => {
    expect(incrementalValue(1, -1)).toBe(2);
    expect(incrementalValue(0, 0)).toBe(0);
    expect(incrementalValue(null, null)).toBeNull();
  });
});
