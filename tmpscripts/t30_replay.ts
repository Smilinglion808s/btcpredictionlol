// T30 PriceFlow Balanced — historical walk-forward replay + backtest.
//
//   bun tmpscripts/t30_replay.ts            # replay only (no writes)
//   bun tmpscripts/t30_replay.ts --write    # + persist fits and BACKFILL rows

import { createClient } from "@supabase/supabase-js";
import {
  T30_CONFIG_HASH,
  T30_DIAGNOSTIC_FEATURES,
  T30_FEATURE_ORDER,
  T30_FEATURE_ORDER_HASH,
  T30_FEATURE_SCHEMA,
  T30_FITS_TABLE,
  T30_FEATURES_TABLE,
  T30_IMPLEMENTATION_REVISION,
  T30_LOGISTIC_C,
  T30_MODEL_NAME,
  T30_MODEL_VARIANT,
  T30_MODEL_VERSION,
  T30_OUTCOME_SOURCE,
  T30_PREDICTIONS_TABLE,
  T30_SCALER,
  T30_SOLVER,
  boiseDate,
} from "@/lib/t30/config";
import { replayT30, type T30ReplayInput } from "@/lib/t30/replay";
import { t30ArtifactHash, t30FitId } from "@/lib/t30/fitService.server";
import { t30FitCertified } from "@/lib/t30/head";

type Row = Record<string, any>;

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const WRITE = process.argv.includes("--write");

async function pageAll(table: string, select: string, apply: (q: any) => any): Promise<Row[]> {
  const out: Row[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await apply(sb.from(table).select(select)).range(off, off + PAGE - 1);
    if (error) throw new Error(`${table}:${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

console.log("loading t30 features…");
const features = await pageAll(
  T30_FEATURES_TABLE,
  "target_ts, spot_complete, feature_complete, invalid_reason, vector, features, label",
  (q) => q.eq("feature_version", T30_FEATURE_SCHEMA).order("target_ts", { ascending: true }),
);
console.log("feature rows:", features.length);

const inputs: T30ReplayInput[] = features.map((f) => {
  const ts = new Date(f.target_ts).toISOString();
  let vector: number[] | null = null;
  const raw = Array.isArray(f.vector) ? (f.vector as unknown[]).map(Number) : null;
  if (
    f.spot_complete === true &&
    f.feature_complete === true &&
    raw &&
    raw.length === T30_FEATURE_ORDER.length &&
    raw.every((v) => Number.isFinite(v))
  ) {
    vector = raw;
  }
  const label = typeof f.label === "number" ? f.label : null;
  return { targetTs: ts, vector, actualDirection: label, invalidReason: f.invalid_reason ?? null };
});

console.log("replay pass 1…");
const t0 = Date.now();
const a = replayT30(inputs);
console.log("pass1:", a.predictionHash, "fits:", a.fits.length, `${Date.now() - t0}ms`);
console.log("replay pass 2…");
const b = replayT30(inputs);
const identical = a.predictionHash === b.predictionHash && JSON.stringify(a.rows) === JSON.stringify(b.rows);
console.log("pass2:", b.predictionHash, "byte-identical:", identical);

function agg(rows: typeof a.rows) {
  let wins = 0,
    losses = 0,
    pushes = 0,
    abst = 0,
    evaluable = 0,
    eq = 0,
    peak = 0,
    dd = 0,
    streak = 0,
    maxStreak = 0;
  for (const r of rows) {
    if (r.decisionValid) evaluable++;
    if (r.result === "WIN") {
      wins++;
      eq++;
      streak = 0;
    } else if (r.result === "LOSS") {
      losses++;
      eq--;
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    } else if (r.result === "PUSH") pushes++;
    else if (r.result === "ABSTAIN") abst++;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const trades = wins + losses + pushes;
  const dec = wins + losses;
  const days = new Map<string, number>();
  for (const r of rows) days.set(boiseDate(r.targetTs), (days.get(boiseDate(r.targetTs)) ?? 0) + (r.score ?? 0));
  const dayList = [...days.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  let r7min: number | null = null;
  for (let i = 6; i < dayList.length; i++) {
    const s = dayList.slice(i - 6, i + 1).reduce((t, d) => t + d[1], 0);
    r7min = r7min == null ? s : Math.min(r7min, s);
  }
  const worst = dayList.reduce<[string, number] | null>((w, d) => (w == null || d[1] < w[1] ? d : w), null);
  return {
    scheduled: rows.length,
    evaluable,
    trades,
    wins,
    losses,
    pushes,
    abstains: abst,
    net: wins - losses,
    winRate: dec ? +((wins / dec) * 100).toFixed(2) : null,
    schedCov: rows.length ? +((trades / rows.length) * 100).toFixed(2) : null,
    maxDrawdown: dd,
    maxLossStreak: maxStreak,
    negativeBoiseDays: dayList.filter((d) => d[1] < 0).length,
    worstBoiseDay: worst ? { date: worst[0], net: worst[1] } : null,
    rolling7Min: r7min,
  };
}

const rows = a.rows;
const between = (lo: string, hi: string) => rows.filter((r) => r.targetTs >= lo && r.targetTs < hi);
const report: Row = {
  identity: {
    model: T30_MODEL_NAME,
    version: T30_MODEL_VERSION,
    variant: T30_MODEL_VARIANT,
    feature_schema: T30_FEATURE_SCHEMA,
    config_hash: T30_CONFIG_HASH,
    feature_order_hash: T30_FEATURE_ORDER_HASH,
    feature_count: T30_FEATURE_ORDER.length,
  },
  determinism: { pass1: a.predictionHash, pass2: b.predictionHash, identical },
  source_rows: features.length,
  fits: a.fits.length,
  certified_fits: a.fits.filter(t30FitCertified).length,
  all: agg(rows),
  green: agg(rows.filter((r) => r.modelDirection === 1 && r.modelWouldTrade)),
  red: agg(rows.filter((r) => r.modelDirection === -1 && r.modelWouldTrade)),
  months: {} as Row,
};
for (const m of [...new Set(rows.map((r) => r.targetTs.slice(0, 7)))].sort())
  report.months[m] = agg(rows.filter((r) => r.targetTs.startsWith(m)));
report.stress_jul4_aug22 = agg(between("2026-07-04", "2026-08-23"));

await Bun.write("/mnt/documents/t30_replay_report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ all: report.all, stress: report.stress_jul4_aug22, months: report.months }, null, 2));

if (!WRITE) {
  console.log("dry run complete (no writes)");
  process.exit(0);
}

console.log("writing fits…");
for (const h of a.fits) {
  const { error } = await sb.from(T30_FITS_TABLE).upsert(
    {
      fit_id: t30FitId(h.blockStartIndex, "BACKFILL"),
      model_version: T30_MODEL_VERSION,
      config_hash: T30_CONFIG_HASH,
      feature_order_hash: T30_FEATURE_ORDER_HASH,
      block_index: h.blockIndex,
      block_start_index: h.blockStartIndex,
      training_start_ts: h.trainingStartTs,
      training_end_ts: h.trainingEndTs,
      training_row_count: h.trainingRowCount,
      training_fingerprint: h.trainingFingerprint,
      scaler_center: h.scaler.center,
      scaler_scale: h.scaler.scale,
      coefficients: h.coefficients,
      intercept: h.intercept,
      solver: T30_SOLVER,
      converged: h.converged,
      certified: t30FitCertified(h),
      iterations: h.iterations,
      gradient_norm: h.gradientNorm,
      artifact_hash: t30ArtifactHash(h),
      source: "BACKFILL",

    },
    { onConflict: "fit_id" },
  );
  if (error) throw new Error(`fit:${error.message}`);
}

console.log("writing BACKFILL predictions…");
const featureByTs = new Map(features.map((f) => [new Date(f.target_ts).toISOString(), f]));
const payload = rows.map((r) => {
  const f = featureByTs.get(r.targetTs) ?? {};
  const subset: Row = {};
  const fv = (f.features ?? {}) as Row;
  for (const n of [...T30_FEATURE_ORDER, ...T30_DIAGNOSTIC_FEATURES])
    subset[n] = typeof fv[n] === "number" ? fv[n] : null;
  return {
    target_ts: r.targetTs,
    model_version: T30_MODEL_VERSION,
    run_mode: "BACKFILL",
    model_name: T30_MODEL_NAME,
    model_variant: T30_MODEL_VARIANT,
    feature_schema: T30_FEATURE_SCHEMA,
    config_hash: T30_CONFIG_HASH,
    feature_order_hash: T30_FEATURE_ORDER_HASH,
    implementation_revision: T30_IMPLEMENTATION_REVISION,
    publication_mode: "SHADOW_ONLY",
    trigger_kind: "REPLAY",
    decided_at: r.targetTs,
    packet_ready: r.probabilityGreen != null,
    spot_complete: f.spot_complete ?? null,
    feature_complete: f.feature_complete ?? null,
    features: subset,
    spot_open: typeof fv.t30_spot_open === "number" ? fv.t30_spot_open : null,
    fit_id: r.fitBlockIndex == null ? null : t30FitId(Number(r.fitId), "BACKFILL"),
    fit_block_index: r.fitBlockIndex,
    fit_certified: r.fitBlockIndex != null,
    probability_green: r.probabilityGreen,
    confidence: r.confidence,
    base_direction: r.baseDirection,
    long_rank: r.longRank,
    long_rank_history: r.longRankHistory,
    fast_rank: r.fastRank,
    fast_rank_history: r.fastRankHistory,
    gate_long_ready: r.gateLongReady,
    gate_fast_ready: r.gateFastReady,
    gate_long_passed: r.gateLongPassed,
    gate_fast_passed: r.gateFastPassed,
    model_direction: r.modelDirection ?? 0,
    model_would_trade: r.modelWouldTrade,
    decision_valid: r.decisionValid,
    decision_reason: r.reason,
    actual_direction: r.actualDirection,
    result: r.result,
    score: r.score,
    resolved_at: r.result == null ? null : r.targetTs,
    outcome_source: T30_OUTCOME_SOURCE,
  };
});

for (let i = 0; i < payload.length; i += 96) {
  const chunk = payload.slice(i, i + 96);
  let ok = false;
  let last = "";
  for (let attempt = 0; attempt < 5 && !ok; attempt++) {
    const { error } = await sb
      .from(T30_PREDICTIONS_TABLE)
      .upsert(chunk as never, { onConflict: "target_ts,model_version,run_mode" });
    if (!error) ok = true;
    else {
      last = error.message;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  if (!ok) throw new Error(`prediction:${last}`);
  if (i % 960 === 0) console.log(`  ${i + chunk.length}/${payload.length}`);
}
console.log("done");
