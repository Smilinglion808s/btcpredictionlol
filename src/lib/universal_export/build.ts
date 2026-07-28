// Universal CSV v2 orchestrator.  Merges every source into a spine-aligned
// row set, emits CSV + JSON manifest, and produces summary stats.
//
// Pure function.  Callers do the IO.

import {
  buildManifest,
  NEW_COLUMNS,
  UNIVERSAL_SCHEMA_VERSION,
  type ManifestEntry,
} from "./columns";
import {
  classifyA96,
  classifyAas96,
  classifyBase,
  classifyTd1,
  unavailable,
  type Classification,
} from "./abstention";
import {
  indexCanonicalCandles,
  lookupCanonical,
  type CanonicalCandle,
} from "./canonical";
import { canonicalScore, normalizePrediction } from "./normalize";
import { buildSpine, FIFTEEN_MIN_MS, priorBoundariesContiguous } from "./spine";

type Row = Record<string, unknown>;

export interface UniversalInput {
  predictions: readonly Row[]; // union of predictions + predictions_archive
  candles: readonly CanonicalCandle[]; // OKX-confirmed candles for the range
  td1Rows: readonly Row[]; // model7_td1_rc_shadow
  aas96Rows: readonly Row[]; // model7_aas96_shadow
  a96Rows: readonly Row[]; // a96_predictions
}

export interface UniversalStats {
  boundaries: number;
  missing_prediction_rows: number;
  valid_canonical_candles: number;
  invalid_canonical_candles: number;
  legacy_disagreements: number;
  strategic_abstentions: { base: number; td1: number; aas96: number; a96: number };
  operational_failures: { base: number; td1: number; aas96: number; a96: number };
}

export interface UniversalOutput {
  csv: string;
  manifest: ManifestEntry[];
  stats: UniversalStats;
  rows: Row[];
  columns: string[];
}

// ----------------------------- helpers -----------------------------------

function toIsoBucket(ts: unknown): string | null {
  if (ts === null || ts === undefined || ts === "") return null;
  const d = new Date(String(ts));
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = typeof v === "object" ? stableJson(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) out[k] = (val as Record<string, unknown>)[k];
      return out;
    }
    return val;
  });
}

// Names of legacy columns that describe resolution/outcome (they must NOT be
// counted as prediction-time safe in the manifest).
const LEGACY_OUTCOME_NAMES = new Set<string>([
  "status",
  "correct",
  "actual_direction",
  "actual_next_candle_open",
  "actual_next_candle_high",
  "actual_next_candle_low",
  "actual_next_candle_close",
  "price_change_abs",
  "price_change_pct",
  "candle_range",
  "body_size",
  "body_pct_of_range",
  "upper_wick",
  "lower_wick",
  "upper_wick_pct",
  "lower_wick_pct",
  "resolution_source",
  "kalshi_market_ticker",
  "kalshi_settlement_direction",
]);
const LEGACY_RESOLUTION_META_NAMES = new Set<string>([
  "resolved_at",
  "seconds_to_resolve",
]);

// ---------------------------- main build ---------------------------------

export function buildUniversalExport(input: UniversalInput): UniversalOutput {
  const { predictions, candles, td1Rows, aas96Rows, a96Rows } = input;

  // 1. Determine spine range.
  const allTsSources: Array<number> = [];
  for (const p of predictions) { const t = toIsoBucket(p.candle_ts); if (t) allTsSources.push(Date.parse(t)); }
  for (const c of candles) { const t = toIsoBucket(c.candle_ts); if (t) allTsSources.push(Date.parse(t)); }
  for (const r of td1Rows) { const t = toIsoBucket(r.candle_ts ?? r.target_candle_ts); if (t) allTsSources.push(Date.parse(t)); }
  for (const r of aas96Rows) { const t = toIsoBucket(r.target_candle_ts ?? r.candle_ts); if (t) allTsSources.push(Date.parse(t)); }
  for (const r of a96Rows) { const t = toIsoBucket(r.target_candle_ts); if (t) allTsSources.push(Date.parse(t)); }

  if (allTsSources.length === 0) {
    return {
      csv: "expected_candle_boundary,universal_schema_version\n",
      manifest: buildManifest(
        ["expected_candle_boundary", "universal_schema_version"],
        LEGACY_OUTCOME_NAMES,
        LEGACY_RESOLUTION_META_NAMES,
      ),
      stats: {
        boundaries: 0,
        missing_prediction_rows: 0,
        valid_canonical_candles: 0,
        invalid_canonical_candles: 0,
        legacy_disagreements: 0,
        strategic_abstentions: { base: 0, td1: 0, aas96: 0, a96: 0 },
        operational_failures: { base: 0, td1: 0, aas96: 0, a96: 0 },
      },
      rows: [],
      columns: ["expected_candle_boundary", "universal_schema_version"],
    };
  }

  const startMs = Math.min(...allTsSources);
  const endMs = Math.max(...allTsSources);
  const spine = buildSpine(startMs, endMs);

  // 2. Index every source by exact ISO boundary.
  const canonicalIndex = indexCanonicalCandles(candles);

  const predsBy = new Map<string, Row>();
  for (const p of predictions) {
    const key = toIsoBucket(p.candle_ts);
    if (!key) continue;
    // Prefer the row with the latest created_at if duplicates exist.
    const prev = predsBy.get(key);
    if (!prev) predsBy.set(key, p);
    else {
      const a = Date.parse(String((prev as Row).created_at ?? 0));
      const b = Date.parse(String((p as Row).created_at ?? 0));
      if (b > a) predsBy.set(key, p);
    }
  }

  const td1By = new Map<string, Row>();
  for (const r of td1Rows) {
    const key = toIsoBucket(r.candle_ts ?? r.target_candle_ts);
    if (key) td1By.set(key, r);
  }

  const aasBy = new Map<string, Row>();
  for (const r of aas96Rows) {
    const key = toIsoBucket(r.target_candle_ts ?? r.candle_ts);
    if (key) aasBy.set(key, r);
  }

  const a96By = new Map<string, Row>();
  for (const r of a96Rows) {
    const key = toIsoBucket(r.target_candle_ts);
    if (key) a96By.set(key, r);
  }

  // 3. a96 fit-episode lineage per (artifact_fit_id -> set<episode_id>).
  const a96EpisodesByArtifact = new Map<string, Set<string>>();
  for (const r of a96Rows) {
    const artifact = String((r as Row).artifact_fit_id ?? "");
    const episode = String((r as Row).fit_episode_id ?? "");
    if (!artifact || !episode) continue;
    if (!a96EpisodesByArtifact.has(artifact)) a96EpisodesByArtifact.set(artifact, new Set());
    a96EpisodesByArtifact.get(artifact)!.add(episode);
  }

  // 4. Emit one row per boundary.
  const outRows: Row[] = [];
  const stats: UniversalStats = {
    boundaries: spine.length,
    missing_prediction_rows: 0,
    valid_canonical_candles: 0,
    invalid_canonical_candles: 0,
    legacy_disagreements: 0,
    strategic_abstentions: { base: 0, td1: 0, aas96: 0, a96: 0 },
    operational_failures: { base: 0, td1: 0, aas96: 0, a96: 0 },
  };

  const emittedColumnSet = new Set<string>();
  let previousBoundary: string | null = null;

  spine.forEach((boundary, idx) => {
    const row: Row = { expected_candle_boundary: boundary };

    // Legacy pass-through: spread the whole predictions row so every
    // historically tracked column remains available under its original name.
    const pred = predsBy.get(boundary) ?? null;
    if (pred) {
      for (const [k, v] of Object.entries(pred)) {
        if (k === "expected_candle_boundary") continue;
        row[k] = v && typeof v === "object" ? stableJson(v) : (v as unknown);
      }
    } else {
      stats.missing_prediction_rows += 1;
    }

    // ---- Canonical block ------------------------------------------------
    const canonical = lookupCanonical(canonicalIndex, boundary);
    if (canonical.canonical_ground_truth_valid) stats.valid_canonical_candles += 1;
    else stats.invalid_canonical_candles += 1;
    Object.assign(row, canonical);

    // ---- Legacy preservation flags -------------------------------------
    const legacyDir = pred ? normalizePrediction(pred.actual_direction) : null;
    row.legacy_actual_direction = pred ? (pred.actual_direction ?? null) : null;
    row.legacy_status = pred ? (pred.status ?? null) : null;
    row.legacy_settlement_source = pred ? (pred.resolution_source ?? null) : null;
    const canonicalDirNorm = canonical.canonical_actual_direction;
    const canonicalCompareable =
      canonical.canonical_ground_truth_valid &&
      (canonicalDirNorm === "GREEN" || canonicalDirNorm === "RED") &&
      (legacyDir === "GREEN" || legacyDir === "RED");
    const disagree =
      canonicalCompareable && canonicalDirNorm !== legacyDir;
    row.canonical_disagrees_with_legacy = canonicalCompareable ? disagree : false;
    if (disagree) stats.legacy_disagreements += 1;

    // ---- Per-model canonical scoring -----------------------------------
    const td1Row = td1By.get(boundary) ?? null;
    const aas96Row = aasBy.get(boundary) ?? null;
    const a96Row = a96By.get(boundary) ?? null;

    const basePred = pred ? normalizePrediction(pred.prediction) : null;
    const td1Pred = td1Row ? normalizePrediction((td1Row as Row).external_final_decision ?? (td1Row as Row).prediction) : null;
    const aas96Pred = aas96Row ? normalizePrediction((aas96Row as Row).published_prediction ?? (aas96Row as Row).final_prediction) : null;
    const a96Pred = a96Row ? normalizePrediction((a96Row as Row).final_prediction) : null;

    row.base_canonical_prediction = basePred;
    row.base_canonical_result_score = canonicalScore(basePred, canonicalDirNorm, canonical.canonical_ground_truth_valid);
    row.td1_canonical_prediction = td1Pred;
    row.td1_canonical_result_score = canonicalScore(td1Pred, canonicalDirNorm, canonical.canonical_ground_truth_valid);
    row.aas96_canonical_prediction = aas96Pred;
    row.aas96_canonical_result_score = canonicalScore(aas96Pred, canonicalDirNorm, canonical.canonical_ground_truth_valid);
    row.a96_canonical_prediction = a96Pred;
    row.a96_canonical_result_score = canonicalScore(a96Pred, canonicalDirNorm, canonical.canonical_ground_truth_valid);

    // ---- Spine audit ----------------------------------------------------
    row.prediction_row_present = pred !== null;
    row.missing_prediction_reason = pred === null ? "no_prediction_row_for_boundary" : null;
    row.previous_expected_candle_ts = previousBoundary;
    if (previousBoundary) {
      const gapMs = new Date(boundary).getTime() - new Date(previousBoundary).getTime();
      row.gap_from_previous_exported_row_seconds = Math.round(gapMs / 1000);
      row.missing_boundaries_since_previous_row = Math.max(0, Math.floor(gapMs / FIFTEEN_MIN_MS) - 1);
    } else {
      row.gap_from_previous_exported_row_seconds = null;
      row.missing_boundaries_since_previous_row = null;
    }
    row.prior_4_boundaries_contiguous = priorBoundariesContiguous(spine, idx, 4);
    row.prior_21_boundaries_contiguous = priorBoundariesContiguous(spine, idx, 21);
    row.prior_30_boundaries_contiguous = priorBoundariesContiguous(spine, idx, 30);

    // ---- Timing audit ---------------------------------------------------
    if (pred) {
      const createdMs = Date.parse(String(pred.created_at ?? ""));
      const targetMs = Date.parse(boundary);
      const createdBefore = Number.isFinite(createdMs) && createdMs < targetMs;
      const leadMs = Number.isFinite(createdMs) ? targetMs - createdMs : null;
      const inputTs = toIsoBucket(pred.input_candle_ts);
      const inputDeltaSec = inputTs ? Math.round((targetMs - Date.parse(inputTs)) / 1000) : null;
      const inputExact = inputDeltaSec === 900;
      const featureCutoff = toIsoBucket((pred as Row).feature_cutoff_ts ?? (pred as Row).td1_feature_cutoff_ts);
      const cutoffBefore = featureCutoff ? Date.parse(featureCutoff) < targetMs : null;
      const reasons: string[] = [];
      if (!createdBefore) reasons.push("created_at_not_before_target");
      if (inputExact !== true) reasons.push("input_delta_not_900s");
      if (cutoffBefore === false) reasons.push("feature_cutoff_not_before_target");
      if (cutoffBefore === null) reasons.push("feature_cutoff_missing");
      const timingValid = createdBefore && inputExact && cutoffBefore === true;
      row.prediction_created_before_boundary = createdBefore;
      row.prediction_lead_ms = leadMs;
      row.input_candle_exactly_prior = inputExact;
      row.input_to_target_delta_seconds = inputDeltaSec;
      row.feature_cutoff_before_target = cutoffBefore;
      row.prediction_timing_valid = timingValid;
      row.prediction_timing_invalid_reason = timingValid ? null : reasons.join(",");
    } else {
      row.prediction_created_before_boundary = null;
      row.prediction_lead_ms = null;
      row.input_candle_exactly_prior = null;
      row.input_to_target_delta_seconds = null;
      row.feature_cutoff_before_target = null;
      row.prediction_timing_valid = false;
      row.prediction_timing_invalid_reason = "no_prediction_row";
    }

    // ---- Classification -------------------------------------------------
    const baseClass: Classification = pred
      ? classifyBase(pred.prediction, pred.notes ?? pred.freshness_action, Boolean(pred.agreement_gate_applied))
      : unavailable();
    const td1Class: Classification = td1Row
      ? classifyTd1((td1Row as Row).external_final_decision, (td1Row as Row).skip_reason ?? (td1Row as Row).shadow_error)
      : unavailable();
    const aas96Class: Classification = aas96Row
      ? classifyAas96(
          (aas96Row as Row).published_prediction ?? (aas96Row as Row).final_prediction,
          (aas96Row as Row).published_abstain_reason ?? (aas96Row as Row).skip_reason ?? (aas96Row as Row).shadow_error,
        )
      : unavailable();
    const a96Class: Classification = a96Row
      ? classifyA96(
          (a96Row as Row).final_prediction,
          (a96Row as Row).decision_reason,
          Boolean((a96Row as Row).agreement_veto_fired),
        )
      : unavailable();

    for (const [prefix, cls] of [
      ["base", baseClass],
      ["td1", td1Class],
      ["aas96", aas96Class],
      ["a96", a96Class],
    ] as const) {
      row[`${prefix}_output_class`] = cls.output_class;
      row[`${prefix}_abstain_class`] = cls.abstain_class;
      row[`${prefix}_normalized_abstain_reason`] = cls.normalized_reason;
      if (cls.abstain_class === "STRATEGIC") stats.strategic_abstentions[prefix] += 1;
      if (cls.abstain_class === "OPERATIONAL") stats.operational_failures[prefix] += 1;
    }

    // ---- Prospective validity flags ------------------------------------
    row.base_prospective_row_valid = pred !== null;
    row.base_prospective_invalid_reason = pred === null ? "no_prediction_row" : null;
    row.td1_prospective_row_valid = td1Row !== null && !(td1Row as Row).shadow_error;
    row.td1_prospective_invalid_reason =
      td1Row === null ? "no_td1_row" : (td1Row as Row).shadow_error ? String((td1Row as Row).shadow_error) : null;
    row.aas96_prospective_row_valid = aas96Row !== null && !(aas96Row as Row).shadow_error;
    row.aas96_prospective_invalid_reason =
      aas96Row === null ? "no_aas96_row" : (aas96Row as Row).shadow_error ? String((aas96Row as Row).shadow_error) : null;
    const a96Prospective =
      a96Row !== null && (a96Row as Row).prospective_valid !== false && (a96Row as Row).resolution_data_invalid !== true;
    row.a96_prospective_row_valid = a96Prospective;
    row.a96_prospective_invalid_reason = a96Row === null
      ? "no_a96_row"
      : (a96Row as Row).prospective_invalid_reason
        ? String((a96Row as Row).prospective_invalid_reason)
        : (a96Row as Row).resolution_data_invalid === true
          ? "resolution_data_invalid"
          : null;
    // Enforce §11: a96 rows with prospective_valid=false cannot contribute to
    // prospective performance — null out the canonical score.
    if (!a96Prospective) row.a96_canonical_result_score = null;

    // ---- Lineage --------------------------------------------------------
    row.universal_schema_version = UNIVERSAL_SCHEMA_VERSION;
    row.base_model_version = pred ? (pred.model_version ?? null) : null;
    row.base_config_hash = pred ? (pred.config_hash ?? null) : null;
    row.base_engine_version_hash = pred ? (pred.engine_version_hash ?? null) : null;
    row.td1_fit_id = td1Row ? ((td1Row as Row).td1_fit_id ?? null) : null;
    row.td1_artifact_sha256 = td1Row ? ((td1Row as Row).td1_artifact_sha256 ?? null) : null;
    row.aas96_fit_id = aas96Row ? ((aas96Row as Row).fit_id ?? null) : null;
    row.aas96_feature_schema_hash = aas96Row ? ((aas96Row as Row).feature_schema_hash ?? null) : null;
    row.aas96_cleanup_veto_version = aas96Row ? ((aas96Row as Row).cleanup_veto_v1_version ?? null) : null;
    row.aas96_selector_override_version = aas96Row ? ((aas96Row as Row).selector_b_confirmation_v1_version ?? null) : null;
    row.a96_model_version = a96Row ? ((a96Row as Row).model_version ?? null) : null;
    row.a96_artifact_fit_id = a96Row ? ((a96Row as Row).artifact_fit_id ?? null) : null;
    row.a96_fit_episode_id = a96Row ? ((a96Row as Row).fit_episode_id ?? null) : null;
    if (a96Row) {
      const artifact = String((a96Row as Row).artifact_fit_id ?? "");
      const episodes = a96EpisodesByArtifact.get(artifact);
      const lineageValid = !!episodes && episodes.size <= 1;
      row.a96_fit_episode_lineage_valid = lineageValid;
      row.a96_fit_episode_lineage_error = lineageValid
        ? null
        : `artifact ${artifact} spans ${episodes?.size ?? 0} distinct fit_episode_id values`;
    } else {
      row.a96_fit_episode_lineage_valid = null;
      row.a96_fit_episode_lineage_error = null;
    }

    // ---- Availability ---------------------------------------------------
    row.base_feature_tracking_available =
      pred !== null && (pred.indicators !== null && pred.indicators !== undefined);
    row.partial_tracking_available =
      pred !== null && (pred.current_partial_snapshot !== null && pred.current_partial_snapshot !== undefined);
    row.orderbook_tracking_available = pred !== null && (pred.orderbook !== null && pred.orderbook !== undefined);
    row.td1_tracking_available = td1Row !== null;
    row.aas96_tracking_available = aas96Row !== null;
    row.a96_tracking_available = a96Row !== null;

    // Attach per-model raw rows under prefixed keys (backward-compat with
    // the old exporter).  Values are stably serialized.
    if (td1Row) {
      for (const [k, v] of Object.entries(td1Row)) {
        const key = `td1_raw_${k}`;
        row[key] = v && typeof v === "object" ? stableJson(v) : v;
      }
    }
    if (aas96Row) {
      for (const [k, v] of Object.entries(aas96Row)) {
        const key = `aas96_raw_${k}`;
        row[key] = v && typeof v === "object" ? stableJson(v) : v;
      }
    }
    if (a96Row) {
      for (const [k, v] of Object.entries(a96Row)) {
        const key = `a96_raw_${k}`;
        row[key] = v && typeof v === "object" ? stableJson(v) : v;
      }
    }

    for (const k of Object.keys(row)) emittedColumnSet.add(k);
    outRows.push(row);
    previousBoundary = boundary;
  });

  // 5. Column ordering: canonical spine first, then new column groups,
  // then any legacy pass-through key alphabetically for stability.
  const orderedNewCols = [
    "expected_candle_boundary",
    ...NEW_COLUMNS.map((c) => c.name),
  ];
  const seenCol = new Set<string>();
  const columns: string[] = [];
  for (const c of orderedNewCols) {
    if (emittedColumnSet.has(c) && !seenCol.has(c)) { columns.push(c); seenCol.add(c); }
  }
  const remaining = Array.from(emittedColumnSet).filter((k) => !seenCol.has(k)).sort();
  for (const c of remaining) { columns.push(c); seenCol.add(c); }

  // 6. Serialize CSV.
  const headerLine = columns.join(",");
  const bodyLines = outRows.map((r) => columns.map((c) => csvEscape(r[c])).join(","));
  const csv = `${headerLine}\n${bodyLines.join("\n")}\n`;

  // 7. Manifest.
  const manifest = buildManifest(columns, LEGACY_OUTCOME_NAMES, LEGACY_RESOLUTION_META_NAMES);

  return { csv, manifest, stats, rows: outRows, columns };
}
