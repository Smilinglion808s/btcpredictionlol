// T45 PriceFlow — deterministic historical replay + backfill.
//
// Usage:
//   bun tmpscripts/t45pf_replay.ts            # replay only, no writes
//   bun tmpscripts/t45pf_replay.ts --write    # replay + persist BACKFILL rows

import { createClient } from "@supabase/supabase-js";
import {
  MODEL_NAME,
  MODEL_VARIANT,
  MODEL_VERSION,
  FEATURE_SCHEMA,
  T45PF_BASE_HEAD,
  T45PF_CONFIG_HASH,
  T45PF_CUTOFF_OFFSET_MS,
  T45PF_FEATURE_ORDER,
  T45PF_FEATURE_ORDER_HASH,
  T45PF_IMPL_REVISION,
  T45PF_LOGISTIC_C,
  T45PF_OUTCOME_SOURCE,
  T45PF_SCALER,
  T45PF_SOLVER,
  boiseDate,
  utcDate,
} from "../src/lib/t45pf/config";
import { replayPriceFlow, pfArtifactHash, pfFitId, sha256Hex, type PFReplayInput } from "../src/lib/t45pf/replay";
import { pfFitCertified } from "../src/lib/t45pf/head";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });
const WRITE = process.argv.includes("--write");

type Row = Record<string, any>;

async function pageAll(table: string, select: string, apply: (q: any) => any) {
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

const t0 = Date.now();
console.log("loading features…");
const features = await pageAll(
  "t45_features",
  ["target_ts", "spot_complete", "feature_complete", ...T45PF_FEATURE_ORDER].join(", "),
  (q) => q.eq("feature_version", "t45-features-r1").order("target_ts", { ascending: true }),
);
console.log("features:", features.length);

const labels = await pageAll("t45_training_labels", "target_ts, evaluation_label_strict", (q) =>
  q.order("target_ts", { ascending: true }),
);
const labelMap = new Map<string, number>();
for (const l of labels) {
  if (typeof l.evaluation_label_strict === "number") {
    labelMap.set(new Date(l.target_ts).toISOString(), l.evaluation_label_strict);
  }
}
console.log("labels:", labelMap.size);

const inputs: PFReplayInput[] = features.map((f) => {
  const ts = new Date(f.target_ts).toISOString();
  let vector: number[] | null = [];
  if (f.spot_complete !== true) vector = null;
  else {
    for (const name of T45PF_FEATURE_ORDER) {
      const v = f[name];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        vector = null;
        break;
      }
      (vector as number[]).push(v);
    }
  }
  return { targetTs: ts, vector, actualDirection: labelMap.get(ts) ?? null };
});

console.log("replay pass 1…");
const a = replayPriceFlow(inputs);
console.log("pass1 hash:", a.predictionHash, "fits:", a.fits.length, `${Date.now() - t0}ms`);
console.log("replay pass 2…");
const b = replayPriceFlow(inputs);
console.log("pass2 hash:", b.predictionHash);
const identical =
  a.predictionHash === b.predictionHash &&
  JSON.stringify(a.rows) === JSON.stringify(b.rows);
console.log("byte-identical:", identical);

// ---- original R2-dependent model, from its stored immutable backfill rows ----
const legacy = await pageAll(
  "t45_predictions",
  "target_ts, probability_green, confidence_rank, active_prediction, active_would_trade, active_result",
  (q) =>
    q
      .eq("model_version", "t45-balanced-q375-r1")
      .eq("run_mode", "BACKFILL")
      .order("target_ts", { ascending: true }),
);
const legacyHash = sha256Hex(
  legacy
    .map(
      (r) =>
        `${new Date(r.target_ts).toISOString()}|${
          r.probability_green == null ? "" : Number(r.probability_green).toExponential(17)
        }|${r.confidence_rank == null ? "" : Number(r.confidence_rank).toExponential(17)}|${
          r.active_prediction ?? ""
        }|${r.active_would_trade ? 1 : 0}`,
    )
    .join("\n"),
);
console.log("legacy backfill rows:", legacy.length, "stream hash:", legacyHash);

// ---- reporting ----
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
  for (const r of rows) {
    const d = boiseDate(r.targetTs);
    days.set(d, (days.get(d) ?? 0) + (r.score ?? 0));
  }
  const dayList = [...days.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  let r7min: number | null = null;
  for (let i = 6; i < dayList.length; i++) {
    const s = dayList.slice(i - 6, i + 1).reduce((t, d) => t + d[1], 0);
    r7min = r7min == null ? s : Math.min(r7min, s);
  }
  const worst = dayList.reduce<[string, number] | null>(
    (w, d) => (w == null || d[1] < w[1] ? d : w),
    null,
  );
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
    evalCov: evaluable ? +((trades / evaluable) * 100).toFixed(2) : null,
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
    MODEL_NAME,
    MODEL_VERSION,
    MODEL_VARIANT,
    FEATURE_SCHEMA,
    config_hash: T45PF_CONFIG_HASH,
    feature_order_hash: T45PF_FEATURE_ORDER_HASH,
    feature_count: T45PF_FEATURE_ORDER.length,
  },
  determinism: { pass1: a.predictionHash, pass2: b.predictionHash, identical },
  legacy: { rows: legacy.length, stream_hash: legacyHash },
  source_rows: features.length,
  all: agg(rows),
  research_jan_jun: agg(between("2026-01-01", "2026-07-01")),
  stress_jul4_aug19: agg(between("2026-07-04", "2026-08-20")),
  months: {} as Row,
  blocks14d: [] as Row[],
  green: agg(rows.filter((r) => r.activePrediction === 1)),
  red: agg(rows.filter((r) => r.activePrediction === -1)),
};

const months = [...new Set(rows.map((r) => r.targetTs.slice(0, 7)))].sort();
for (const m of months) report.months[m] = agg(rows.filter((r) => r.targetTs.startsWith(m)));

const first = rows[0]?.targetTs;
if (first) {
  const startMs = new Date(first).getTime();
  const endMs = new Date(rows[rows.length - 1].targetTs).getTime();
  const BLOCK = 14 * 86400000;
  for (let s = startMs; s < endMs; s += BLOCK) {
    const lo = new Date(s).toISOString();
    const hi = new Date(s + BLOCK).toISOString();
    report.blocks14d.push({ from: lo.slice(0, 10), to: hi.slice(0, 10), ...agg(between(lo, hi)) });
  }
}

const legacyResults = legacy.reduce(
  (t, r) => {
    if (r.active_result === "WIN") t.wins++;
    else if (r.active_result === "LOSS") t.losses++;
    else if (r.active_result === "PUSH") t.pushes++;
    else if (r.active_result === "ABSTAIN") t.abstains++;
    return t;
  },
  { wins: 0, losses: 0, pushes: 0, abstains: 0 },
);
report.legacy_results = {
  ...legacyResults,
  net: legacyResults.wins - legacyResults.losses,
  winRate: +(
    (legacyResults.wins / Math.max(1, legacyResults.wins + legacyResults.losses)) *
    100
  ).toFixed(2),
};

await Bun.write("/mnt/documents/t45pf_replay_report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ all: report.all, research: report.research_jan_jun, stress: report.stress_jul4_aug19, legacy: report.legacy_results }, null, 2));

if (!WRITE) {
  console.log("dry run complete (no writes)");
  process.exit(0);
}

// ---- persist fits ----
console.log("writing fits…");
for (const h of a.fits) {
  const { error } = await sb.from("t45_pf_fits").upsert(
    {
      fit_id: pfFitId(h.blockStartIndex),
      model_version: MODEL_VERSION,
      config_hash: T45PF_CONFIG_HASH,
      feature_schema: FEATURE_SCHEMA,
      feature_order_hash: T45PF_FEATURE_ORDER_HASH,
      block_index: h.blockIndex,
      block_start_index: h.blockStartIndex,
      training_start_ts: h.trainingStartTs,
      training_end_ts: h.trainingEndTs,
      training_row_count: h.trainingRowCount,
      training_fingerprint: h.trainingFingerprint,
      feature_order: T45PF_FEATURE_ORDER,
      scaler: T45PF_SCALER,
      scaler_center: h.scaler.center,
      scaler_scale: h.scaler.scale,
      coefficients: h.coefficients,
      intercept: h.intercept,
      logistic_c: T45PF_LOGISTIC_C,
      solver: T45PF_SOLVER,
      converged: h.converged,
      certified: pfFitCertified(h),
      iterations: h.iterations,
      gradient_norm: h.gradientNorm,
      artifact_hash: pfArtifactHash(h),
      impl_revision: T45PF_IMPL_REVISION,
    },
    { onConflict: "fit_id" },
  );
  if (error) throw new Error(`fit:${error.message}`);
}

// ---- persist BACKFILL predictions ----
console.log("writing predictions…");
const featureByTs = new Map(features.map((f) => [new Date(f.target_ts).toISOString(), f]));
const payload = rows.map((r) => {
  const f = featureByTs.get(r.targetTs) ?? {};
  const fv: Row = {};
  for (const n of T45PF_FEATURE_ORDER) fv[n] = typeof f[n] === "number" ? f[n] : null;
  const targetMs = new Date(r.targetTs).getTime();
  return {
    target_ts: r.targetTs,
    model_name: MODEL_NAME,
    model_version: MODEL_VERSION,
    model_variant: MODEL_VARIANT,
    base_head: T45PF_BASE_HEAD,
    config_hash: T45PF_CONFIG_HASH,
    feature_schema: FEATURE_SCHEMA,
    feature_order_hash: T45PF_FEATURE_ORDER_HASH,
    impl_revision: T45PF_IMPL_REVISION,
    run_mode: "BACKFILL",
    utc_date: utcDate(r.targetTs),
    local_date: boiseDate(r.targetTs),
    decision_cutoff_ts: new Date(targetMs + T45PF_CUTOFF_OFFSET_MS).toISOString(),
    decided_at: new Date().toISOString(),
    expected_observations: 45,
    actual_observations: f.spot_complete === true ? 45 : null,
    unique_observations: f.spot_complete === true ? 45 : null,
    min_offset_seconds: f.spot_complete === true ? 0 : null,
    max_offset_seconds: f.spot_complete === true ? 44 : null,
    timing_valid: f.spot_complete === true,
    packet_ready: f.spot_complete === true,
    feature_complete: r.fitId != null || f.spot_complete === true,
    feature_values_json: fv,
    fit_id: r.fitId,
    fit_block_index: r.fitBlockIndex,
    fit_training_row_count: r.fitTrainingRowCount,
    fit_training_fingerprint: r.fitTrainingFingerprint,
    fit_artifact_hash: r.fitArtifactHash,
    fit_certified: r.fitId != null,
    scaler: T45PF_SCALER,
    solver: T45PF_SOLVER,
    probability_green: r.probabilityGreen,
    confidence: r.confidence,
    confidence_rank: r.confidenceRank,
    rank_history_count: r.rankHistoryCount,
    base_direction: r.baseDirection,
    active_prediction: r.activePrediction,
    active_sleeve: r.activeSleeve,
    active_would_trade: r.activeWouldTrade,
    decision_valid: r.decisionValid,
    decision_reason: r.reason,
    activation_mode: "SHADOW_ONLY",
    webhook_eligible: false,
    webhook_sent: false,
    actual_direction: r.actualDirection,
    outcome_source: r.actualDirection == null ? null : T45PF_OUTCOME_SOURCE,
    resolved_at: r.actualDirection == null ? null : new Date().toISOString(),
    active_result: r.result,
    active_score: r.score,
  };
});

for (let i = 0; i < payload.length; i += 500) {
  const chunk = payload.slice(i, i + 500);
  const { error } = await sb
    .from("t45_pf_predictions")
    .upsert(chunk, { onConflict: "target_ts,model_version,run_mode" });
  if (error) throw new Error(`pred:${error.message}`);
  if (i % 5000 === 0) console.log("  wrote", i);
}
console.log("backfill complete:", payload.length, "rows", `${Date.now() - t0}ms`);
