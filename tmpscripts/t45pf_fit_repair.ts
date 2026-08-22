// T45 PriceFlow — fit-rollover repair + rolling-state rebuild.
//
//   bun tmpscripts/t45pf_fit_repair.ts             # audit only
//   bun tmpscripts/t45pf_fit_repair.ts --write     # mint fits + write repair state
//
// Mints every missing certified block fit from index 25152 onward using the
// production fitter, then rebuilds the rolling probability/rank state over the
// rows that failed with FIT_NOT_READY. Original decisions, reasons, would_trade
// and webhook fields are never rewritten — repair values land in repair_* only.

import { createClient } from "@supabase/supabase-js";
import { MODEL_VERSION, T45PF_FEATURE_ORDER, T45PF_RANK_WINDOW } from "../src/lib/t45pf/config";
import { ensurePFFit, headFromFitRow } from "../src/lib/t45pf/fitService.server";
import { pfBlockStart, pfDecide, pfProbability, type PFHead } from "../src/lib/t45pf/head";
import { pfArtifactHash, pfFitId, sha256Hex } from "../src/lib/t45pf/replay";
import { T45PF_REASONS } from "../src/lib/t45pf/config";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const WRITE = process.argv.includes("--write");

type Row = Record<string, any>;

async function pageAll(table: string, select: string, apply: (q: any) => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await apply(sb.from(table).select(select)).range(off, off + 999);
    if (error) throw new Error(`${table}:${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function main() {
  // 1. absolute index spine
  const features = await pageAll("t45_features", "target_ts, spot_complete", (q) =>
    q.eq("feature_version", "t45-features-r1").order("target_ts", { ascending: true }),
  );
  const indexOf = new Map<string, number>();
  features.forEach((f, i) => indexOf.set(new Date(f.target_ts).toISOString(), i));
  console.log("feature rows:", features.length);

  // 2. every block boundary that any existing prediction needs
  const preds = await pageAll(
    "t45_pf_predictions",
    "target_ts, run_mode, decision_valid, decision_reason, fit_id, feature_values_json, confidence",
    (q) =>
      q
        .eq("model_version", MODEL_VERSION)
        .eq("run_mode", "LIVE")
        .order("target_ts", { ascending: true }),
  );
  const needed = new Set<number>();
  for (const p of preds) {
    const idx = indexOf.get(new Date(p.target_ts).toISOString());
    if (idx == null) continue;
    const bs = pfBlockStart(idx);
    if (bs != null) needed.add(bs);
  }
  const boundaries = [...needed].sort((a, b) => a - b);
  const heads = new Map<number, PFHead>();
  for (const bs of boundaries) {
    const existing = await sb
      .from("t45_pf_fits")
      .select("*")
      .eq("fit_id", pfFitId(bs))
      .maybeSingle();
    if (existing.data) {
      heads.set(bs, headFromFitRow(existing.data as Row));
      continue;
    }
    if (!WRITE) {
      console.log("MISSING fit", bs);
      continue;
    }
    const a = await ensurePFFit(sb, bs);
    const b = await ensurePFFit(sb, bs); // idempotency + byte-identical replay
    console.log(
      "fit",
      bs,
      a.status,
      a.trainingRowCount,
      a.trainingStartTs,
      "->",
      a.trainingEndTs,
      a.artifactHash,
      "replay:",
      b.status,
      b.artifactHash,
      a.artifactHash === b.artifactHash ? "IDENTICAL" : "DIVERGENT",
      a.error ?? "",
    );
    if (a.head) heads.set(bs, a.head);
  }

  // 3. rebuild the rolling probability/rank state chronologically
  const confidences: number[] = [];
  const repairs: Row[] = [];
  const canonical: string[] = [];
  for (const p of preds) {
    const ts = new Date(p.target_ts).toISOString();
    const idx = indexOf.get(ts);
    if (idx == null) continue;
    const bs = pfBlockStart(idx);
    const head = bs == null ? null : heads.get(bs);
    const values = (p.feature_values_json ?? {}) as Record<string, number | null>;
    const vector: number[] = [];
    let ok = head != null;
    for (const name of T45PF_FEATURE_ORDER) {
      const v = values[name];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        ok = false;
        break;
      }
      vector.push(v);
    }
    if (!ok || !head) {
      canonical.push(`${ts}|invalid`);
      continue;
    }
    const probability = pfProbability(head, vector);
    const prior = confidences.slice(-T45PF_RANK_WINDOW);
    const d = pfDecide(probability, prior, T45PF_REASONS);
    confidences.push(d.confidence);
    canonical.push(
      `${ts}|${probability.toExponential(17)}|${
        d.confidenceRank == null ? "" : d.confidenceRank.toExponential(17)
      }|${d.activePrediction ?? ""}|${d.activeWouldTrade ? 1 : 0}`,
    );
    if (p.decision_valid !== true && p.decision_reason === T45PF_REASONS.FIT_NOT_READY) {
      repairs.push({
        target_ts: ts,
        repair_probability_green: d.probabilityGreen,
        repair_confidence: d.confidence,
        repair_confidence_rank: d.confidenceRank,
        repair_base_direction: d.baseDirection,
        repair_prediction: d.confidenceRank == null ? null : d.activePrediction,
        repair_would_trade: d.confidenceRank == null ? false : d.activeWouldTrade,
        repair_fit_id: pfFitId(bs!),
      });
    }
  }
  const checksum = sha256Hex(canonical.join("\n"));
  console.log("rebuilt rows:", canonical.length, "repair rows:", repairs.length);
  console.log("rolling-state checksum:", checksum);

  if (WRITE) {
    for (const r of repairs) {
      const { target_ts, ...rest } = r;
      const { error } = await sb
        .from("t45_pf_predictions")
        .update({ ...rest, repair_state_checksum: checksum, repaired_at: new Date().toISOString() })
        .eq("target_ts", target_ts)
        .eq("model_version", MODEL_VERSION)
        .eq("run_mode", "LIVE");
      if (error) console.log("repair write failed", target_ts, error.message);
    }
    console.log("repair state written");
  }
  console.log(
    "fit coverage:",
    [...heads.keys()].sort((a, b) => a - b).slice(-4),
    "artifact:",
    [...heads.values()].slice(-1).map(pfArtifactHash),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
