// T30 Cross89 Balanced R1 — historical walk-forward replay and checkpoint.
//
// Usage: bun tmpscripts/t30x89_replay.ts [--persist]

import { createClient } from "@supabase/supabase-js";
import {
  T30X_CONFIG_HASH,
  T30X_FEATURE_ORDER_HASH,
  T30X_FEATURE_SCHEMA,
  T30X_IMPLEMENTATION_REVISION,
  T30X_MODEL_NAME,
  T30X_MODEL_VARIANT,
  T30X_MODEL_VERSION,
  T30X_SOLVER,
  T30X_FIRST_FIT_INDEX,
  T30X_FIT_BLOCK_SIZE,
  T30X_FEATURE_ORDER,
} from "@/lib/t30x89/config";
import { decisionHashPayload, replayX89, type X89SourceRow } from "@/lib/t30x89/replay";
import { artifactHashOf, sha256Hex } from "@/lib/t30x89/fitService.server";
import { loadX89FeatureRows, upsertX89Fit, upsertX89Predictions } from "@/lib/t30x89/store.server";

const sb = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const persist = process.argv.includes("--persist");

async function main() {
  console.log("[x89] loading source rows…");
  const raw = await loadX89FeatureRows(sb as never, {
    columns:
      "target_ts, source_index, vector, packet_ready, base_direction, spot_tech_ready, fut_tech_ready, okx_direction, okx_open, okx_high, okx_low, okx_close, feature_complete",
  });
  console.log(`[x89] source rows: ${raw.length}`);

  const source: X89SourceRow[] = raw.map((r, i) => ({
    index: i,
    targetTs: new Date(String(r['target_ts'])).toISOString(),
    vector: (r['feature_complete'] ? (r['vector'] as number[] | null) : null) ?? null,
    packetReady: Boolean(r['packet_ready']),
    spotTechReady: Boolean(r['spot_tech_ready']),
    futTechReady: Boolean(r['fut_tech_ready']),
    baseDirection: (Number(r['base_direction'] ?? 0) || 0) as -1 | 0 | 1,
    okxDirection: r['okx_direction'] == null ? null : Number(r['okx_direction']),
  }));

  const t0 = Date.now();
  const { rows, heads, summary } = replayX89(source);
  const decisionHash = sha256Hex(decisionHashPayload(rows));
  console.log(`[x89] replay done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(JSON.stringify({ ...summary, decisionHash }, null, 2));

  // Monthly breakdown
  const byMonth = new Map<string, { t: number; w: number; l: number }>();
  for (const r of rows) {
    if (!r.modelWouldTrade || r.outcome === "ABSTAIN") continue;
    const m = r.targetTs.slice(0, 7);
    const e = byMonth.get(m) ?? { t: 0, w: 0, l: 0 };
    e.t++;
    if (r.outcome === "WIN") e.w++;
    if (r.outcome === "LOSS") e.l++;
    byMonth.set(m, e);
  }
  for (const [m, e] of [...byMonth.entries()].sort()) {
    const wr = e.w + e.l > 0 ? (e.w / (e.w + e.l)) * 100 : 0;
    console.log(`${m}: ${e.t} trades, ${e.w}W-${e.l}L, ${e.w - e.l >= 0 ? "+" : ""}${e.w - e.l}, ${wr.toFixed(2)}%`);
  }

  console.log(`[x89] identity feature_order_hash=${T30X_FEATURE_ORDER_HASH} features=${T30X_FEATURE_ORDER.length}`);

  if (!persist) return;

  console.log("[x89] persisting fits…");
  for (const [blockStart, head] of [...heads.entries()].sort((a, b) => a[0] - b[0])) {
    const hash = artifactHashOf(head);
    await upsertX89Fit(sb as never, {
      fit_id: `t30x89-${blockStart}-${hash.slice(0, 16)}`,
      block_index: (blockStart - T30X_FIRST_FIT_INDEX) / T30X_FIT_BLOCK_SIZE,
      block_start_index: blockStart,
      training_start_index: head.trainingStartIndex,
      training_end_index: head.trainingEndIndex,
      training_start_ts: head.trainingStartTs,
      training_end_ts: head.trainingEndTs,
      training_row_count: head.trainingRowCount,
      center: head.scaler.center,
      scale: head.scaler.scale,
      coefficients: head.coefficients,
      intercept: head.intercept,
      converged: head.converged,
      iterations: head.iterations,
      gradient_norm: head.gradientNorm,
      feature_order_hash: T30X_FEATURE_ORDER_HASH,
      window_fingerprint: `replay:${head.trainingStartIndex}-${head.trainingEndIndex}`,
      artifact_hash: hash,
      solver: T30X_SOLVER,
      model_version: T30X_MODEL_VERSION,
      config_hash: T30X_CONFIG_HASH,
      certified: true,
      certification_note: "replay double-fit deterministic",
    });
  }

  console.log("[x89] persisting predictions…");
  const okxByTs = new Map(raw.map((r) => [new Date(String(r['target_ts'])).toISOString(), r]));
  const predRows = rows.map((r) => {
    const src = okxByTs.get(r.targetTs) ?? {};
    return {
      target_ts: r.targetTs,
      source_index: r.index,
      model_name: T30X_MODEL_NAME,
      model_version: T30X_MODEL_VERSION,
      model_variant: T30X_MODEL_VARIANT,
      feature_schema: T30X_FEATURE_SCHEMA,
      config_hash: T30X_CONFIG_HASH,
      feature_order_hash: T30X_FEATURE_ORDER_HASH,
      impl_revision: T30X_IMPLEMENTATION_REVISION,
      run_mode: "BACKFILL",
      execution_path: "REPLAY",
      trigger_kind: "REPLAY",
      packet_ready: r.baseDirection !== 0 || r.reason !== "ABSTAIN_T30_PACKET_NOT_READY",
      base_direction: r.baseDirection,
      probability_correct: r.probabilityCorrect,
      long_rank: r.longRank,
      fast_rank: r.fastRank,
      gate_long_pass: r.longRank == null ? null : r.longRank >= 0.625,
      gate_fast_pass: r.fastRank == null ? null : r.fastRank >= 0.5,
      model_would_trade: r.modelWouldTrade,
      model_direction: r.modelDirection,
      decision_reason: r.reason,
      decision_valid: r.decisionValid,
      fit_block_start_index: r.fitBlockStart,
      fit_certified: r.fitBlockStart != null,
      activation_mode: "SHADOW_ONLY",
      webhook_eligible: false,
      okx_open: src['okx_open'] ?? null,
      okx_high: src['okx_high'] ?? null,
      okx_low: src['okx_low'] ?? null,
      okx_close: src['okx_close'] ?? null,
      okx_direction: src['okx_direction'] ?? null,
      correctness_label: r.correctnessLabel,
      outcome: r.outcome,
      raw_score: r.rawScore,
      resolved_at: src['okx_direction'] == null ? null : r.targetTs,
    };
  });
  const written = await upsertX89Predictions(sb as never, predRows);
  console.log(`[x89] predictions written=${written}`);
}

void main();
