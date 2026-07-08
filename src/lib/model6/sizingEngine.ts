// Pure sizing engine — conviction rule from user backtest.
import type { Features } from "./featureEngine";
import type { Prediction } from "./decisionEngine";
import {
  CONVICTION_STREAK_LEN, CONVICTION_BODY_MOVE_PCT,
  CONVICTION_MARUBOZU_BODY_PCT, CONVICTION_VOLUME_MULT,
} from "./config";

export type ConvictionReason = "streak4" | "body_030" | "marubozu" | "volume_2x";

export interface Sizing {
  units: 1 | 2;
  conviction_active: boolean;
  conviction_reasons: ConvictionReason[];
  conviction_direction: "green" | "red" | "doji" | null;
  conviction_aligned: boolean;
}

export function computeUnits(f: Features, prediction: Prediction): Sizing {
  const prev = f.last; // prev candle = latest COMPLETED candle (already the input candle for prediction)
  if (!prev) {
    return { units: 1, conviction_active: false, conviction_reasons: [],
      conviction_direction: null, conviction_aligned: false };
  }
  const reasons: ConvictionReason[] = [];
  if (f.consecutive_same_color_streak >= CONVICTION_STREAK_LEN) reasons.push("streak4");
  const bodyMovePct = prev.open > 0 ? Math.abs(prev.close - prev.open) / prev.open : 0;
  if (bodyMovePct >= CONVICTION_BODY_MOVE_PCT) reasons.push("body_030");
  if (prev.body_pct_of_range >= CONVICTION_MARUBOZU_BODY_PCT) reasons.push("marubozu");
  const volRatio = f.volume_avg_20 > 0 ? prev.volume / f.volume_avg_20 : 0;
  if (volRatio >= CONVICTION_VOLUME_MULT) reasons.push("volume_2x");

  const dir: "green" | "red" | "doji" = prev.green ? "green" : prev.red ? "red" : "doji";
  const aligned =
    (dir === "green" && prediction === "YES") || (dir === "red" && prediction === "NO");
  const active = reasons.length > 0;
  return {
    units: active ? 2 : 1,
    conviction_active: active,
    conviction_reasons: reasons,
    conviction_direction: dir,
    conviction_aligned: aligned,
  };
}
