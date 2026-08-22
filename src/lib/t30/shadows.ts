// T30 PriceFlow — reporting-only shadow policies (pure).
//
// Shadows are evaluated from the SAME probability, ranks and features as the
// primary decision and are written to their own table. Nothing here can change
// the primary decision, the webhook (T30 never emits one) or the primary stats.

import {
  T30_FAST_RANK_MIN,
  T30_LONG_RANK_MIN,
  type T30Direction,
  type T30ShadowPolicy,
} from "./config";
import type { T30Decision } from "./head";
import type { T30FeatureMap } from "./features";

export interface T30ShadowOutcome {
  policy: T30ShadowPolicy;
  wouldTrade: boolean;
  direction: T30Direction;
  reason: string;
}

const num = (m: T30FeatureMap, k: string): number | null => {
  const v = m[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

export function evaluateT30Shadows(
  decision: T30Decision,
  features: T30FeatureMap,
): T30ShadowOutcome[] {
  const dir = decision.baseDirection;
  const long = decision.longRank.rank;
  const fast = decision.fastRank.rank;
  const ready = long != null && fast != null && decision.decisionValid;
  const align = num(features, "t30_price_flow_alignment");
  const rvol = num(features, "t30_realized_vol_30s_bps");
  const flow = num(features, "t30_quote_flow_30s");

  const out: T30ShadowOutcome[] = [];
  const push = (policy: T30ShadowPolicy, ok: boolean, reason: string) =>
    out.push({ policy, wouldTrade: ok, direction: ok ? dir : 0, reason });

  push(
    "LONG_ONLY_Q375",
    ready && (long as number) >= T30_LONG_RANK_MIN,
    ready ? "EVALUATED" : "NOT_READY",
  );
  push(
    "DUAL_RANK_BALANCED",
    ready && (long as number) >= T30_LONG_RANK_MIN && (fast as number) >= T30_FAST_RANK_MIN,
    ready ? "EVALUATED" : "NOT_READY",
  );
  push(
    "DUAL_RANK_PRECISION",
    ready && (long as number) >= 0.75 && (fast as number) >= 0.625,
    ready ? "EVALUATED" : "NOT_READY",
  );
  push(
    "FLOW_CONFIRMED",
    ready &&
      (long as number) >= T30_LONG_RANK_MIN &&
      (fast as number) >= T30_FAST_RANK_MIN &&
      align === 1,
    align == null ? "FEATURE_MISSING" : ready ? "EVALUATED" : "NOT_READY",
  );
  push(
    "VOLATILITY_WITHOUT_FLOW",
    ready &&
      (long as number) >= T30_LONG_RANK_MIN &&
      rvol != null &&
      rvol >= 8 &&
      flow != null &&
      Math.abs(flow) < 0.2,
    rvol == null || flow == null ? "FEATURE_MISSING" : ready ? "EVALUATED" : "NOT_READY",
  );
  return out;
}
