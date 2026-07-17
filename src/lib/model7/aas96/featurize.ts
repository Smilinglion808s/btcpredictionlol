// AAS96 feature extraction. Reads a predictions row and produces a flat
// {name: number|string|null} map. Numerics + booleans + categoricals + a
// small set of derived ratios and time-cyclic terms. No target-outcome
// columns are ever read here.

import { createHash } from "crypto";

export type FeatureValue = number | boolean | string | null;
export type FeatureMap = Record<string, FeatureValue>;

// Kept intentionally curated (not all 141 spec columns). All of these columns
// exist on `predictions` today.
const NUMERIC_FIELDS = [
  "confidence", "bullish_score", "bearish_score", "score_margin",
  "base_bullish_score", "base_bearish_score",
  "partial_completeness", "partial_close_position_pct", "partial_range_vs_atr",
  "partial_module_bull_pts", "partial_module_bear_pts",
  "btc_price_at_prediction",
  "input_candle_age_seconds", "current_partial_minutes_elapsed",
] as const;

const BOOLEAN_FIELDS = [
  "input_features_fresh", "advance_check_passed",
  "partial_snapshot_present", "partial_veto_active",
  "partial_hard_override_fired", "conflict_downgrade_applied",
  "degraded_mode", "feed_mismatch", "agreement_gate_applied",
  "conviction_active", "conviction_aligned",
  "score_sum_mismatch", "changed_by_partial",
] as const;

const CATEGORICAL_FIELDS = [
  "setup_type", "market_condition",
  "partial_direction", "partial_vwap_event",
  "partial_agreement", "partial_veto_tier", "partial_veto_direction",
  "agreement_gate_reason", "final_trade_status",
  "conviction_direction", "change_reason",
  "original_prediction_before_partial", "freshness_action",
] as const;

const MISSING = "__missing__";
const UNKNOWN = "__unknown__";

function safeNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function safeBool(v: unknown): number | null {
  if (v == null) return null;
  return v ? 1 : 0;
}
function normCat(v: unknown): string {
  if (v == null) return MISSING;
  const s = String(v).trim().toLowerCase();
  return s.length === 0 ? MISSING : s;
}

/** Extract flat feature dict for a single predictions row. */
export function extractFeatures(p: Record<string, unknown>): FeatureMap {
  const f: FeatureMap = {};
  for (const k of NUMERIC_FIELDS) f[`num__${k}`] = safeNum(p[k]);
  for (const k of BOOLEAN_FIELDS) f[`bool__${k}`] = safeBool(p[k]);
  for (const k of CATEGORICAL_FIELDS) f[`cat__${k}`] = normCat(p[k]);

  // Module points JSON: aggregate net = sum of (bull - bear) per module.
  const mp = (p.module_points ?? null) as Record<string, unknown> | null;
  let modBull = 0, modBear = 0, modules = 0;
  if (mp && typeof mp === "object") {
    for (const key of Object.keys(mp)) {
      const v = mp[key] as Record<string, unknown> | null;
      if (v && typeof v === "object") {
        const b = safeNum(v.bull) ?? 0;
        const r = safeNum(v.bear) ?? 0;
        modBull += b; modBear += r; modules += 1;
      }
    }
  }
  f["num__module_bull_sum"] = modules ? modBull : null;
  f["num__module_bear_sum"] = modules ? modBear : null;
  f["num__module_net_sum"] = modules ? modBull - modBear : null;
  f["num__module_count"] = modules;

  // Partial snapshot JSON.
  const sn = (p.current_partial_snapshot ?? null) as Record<string, unknown> | null;
  if (sn && typeof sn === "object") {
    const o = safeNum(sn.open), h = safeNum(sn.high),
          l = safeNum(sn.low), c = safeNum(sn.close),
          vol = safeNum(sn.volume);
    if (o != null && h != null && l != null && c != null) {
      const eps = 1e-12;
      f["num__snapshot_return_pct"] = 100 * (c - o) / Math.max(Math.abs(o), eps);
      f["num__snapshot_range_pct"] = 100 * (h - l) / Math.max(Math.abs(o), eps);
      f["num__snapshot_body_pct_of_range"] = 100 * Math.abs(c - o) / Math.max(h - l, eps);
      f["num__snapshot_close_position_pct"] = 100 * (c - l) / Math.max(h - l, eps);
    }
    f["num__snapshot_log_volume"] = vol != null ? Math.log(1 + Math.max(vol, 0)) : null;
  }

  // Derived score balance.
  const bs = safeNum(p.bullish_score), br = safeNum(p.bearish_score);
  if (bs != null && br != null) {
    const denom = Math.max(Math.abs(bs) + Math.abs(br), 1e-12);
    f["num__score_balance"] = (bs - br) / denom;
  }

  // Time cyclic (America/Boise ~ MT). We approximate via UTC hour/minute
  // shifted -6h — good enough as a feature.
  const created = p.created_at ?? p.candle_ts;
  if (created) {
    const d = new Date(String(created));
    if (!isNaN(d.getTime())) {
      const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
      const mtMin = ((utcMin - 6 * 60) + 24 * 60) % (24 * 60);
      const h = mtMin / 60;
      const m = mtMin % 60;
      const dow = d.getUTCDay();
      const twoPi = 2 * Math.PI;
      f["num__hour_sin"] = Math.sin(twoPi * h / 24);
      f["num__hour_cos"] = Math.cos(twoPi * h / 24);
      f["num__minute_sin"] = Math.sin(twoPi * m / 60);
      f["num__minute_cos"] = Math.cos(twoPi * m / 60);
      f["num__dow_sin"] = Math.sin(twoPi * dow / 7);
      f["num__dow_cos"] = Math.cos(twoPi * dow / 7);
    }
  }

  return f;
}

/** Deterministic hash of the sorted feature name list. */
export function featureSchemaHash(names: string[]): string {
  return createHash("sha256").update([...names].sort().join("|")).digest("hex");
}

/** Extract Layer B expert-source signals for a single row. */
export interface ExpertInputs {
  legacy: 1 | -1 | null;
  ema_trend: 1 | -1 | null;
  partial_direction: 1 | -1 | null;
  conviction: 1 | -1 | null;
  original_pre_partial: 1 | -1 | null;
  m6_score: 1 | -1;
  m6_fallback: 1 | -1;
  engine_trend_conflict: 1 | -1 | null;
}
export function extractExpertInputs(p: Record<string, unknown>): ExpertInputs {
  const mapYesNo = (v: unknown): 1 | -1 | null => {
    const s = v == null ? null : String(v).toUpperCase();
    if (s === "YES") return 1;
    if (s === "NO") return -1;
    return null;
  };
  const mapUpDown = (v: unknown): 1 | -1 | null => {
    const s = v == null ? null : String(v).toLowerCase();
    if (s === "up" || s === "green") return 1;
    if (s === "down" || s === "red") return -1;
    return null;
  };
  const legacy = mapYesNo(p.prediction);
  const emaTrend = mapUpDown(p.trend);
  const partialDir = mapUpDown(p.partial_direction);
  const conv = mapUpDown(p.conviction_direction);
  const orig = mapYesNo(p.original_prediction_before_partial);
  const mBull = safeNum(p.bullish_score) ?? 0;
  const mBear = safeNum(p.bearish_score) ?? 0;
  const m6 = mBull >= mBear ? 1 : -1;
  const fallback = m6; // Layer B fallback per spec formula
  let etc: 1 | -1 | null = legacy;
  if (legacy != null && emaTrend != null && legacy !== emaTrend) etc = emaTrend;
  return {
    legacy,
    ema_trend: emaTrend,
    partial_direction: partialDir,
    conviction: conv,
    original_pre_partial: orig,
    m6_score: m6,
    m6_fallback: fallback,
    engine_trend_conflict: etc,
  };
}
