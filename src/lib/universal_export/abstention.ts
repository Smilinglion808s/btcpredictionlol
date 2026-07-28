// Classify a model's non-directional outcome as STRATEGIC (an intentional
// abstain that reflects the model's decision surface) or OPERATIONAL
// (a pipeline/data/eligibility failure). Pure functions.

import { normalizePrediction, outputClassFor, type NormalizedPrediction } from "./normalize";

export type AbstainClass = "STRATEGIC" | "OPERATIONAL" | "NONE";

export interface Classification {
  output_class: "DIRECTIONAL" | "ABSTAIN" | "UNAVAILABLE";
  abstain_class: AbstainClass;
  normalized_reason: string | null;
}

function normalizeReasonString(raw: unknown): string {
  return raw == null ? "" : String(raw).trim().toLowerCase();
}

// ------------------------------ TD1-RC -----------------------------------
const TD1_STRATEGIC = new Set([
  "td1_turn_risk",
  "directional_containment",
  "containment_veto",
]);
const TD1_OPERATIONAL_PATTERNS = [
  "a2_ineligible",
  "a2_timing_failure",
  "a2_leakage_failure",
  "a2_probability_missing",
  "no_active_fit",
  "missing_canonical_ohlc_history",
  "a2_history_warmup_incomplete",
  "td1_rc_error",
  "containment_rpc_error",
  "shadow_error",
  "warmup",
];

export function classifyTd1(rawPrediction: unknown, rawReason: unknown): Classification {
  const pred = normalizePrediction(rawPrediction);
  const output_class = outputClassFor(pred);
  if (output_class !== "ABSTAIN") return { output_class, abstain_class: "NONE", normalized_reason: null };
  const reason = normalizeReasonString(rawReason);
  if (!reason) return { output_class, abstain_class: "OPERATIONAL", normalized_reason: "unspecified" };
  for (const s of TD1_STRATEGIC) if (reason.includes(s)) return { output_class, abstain_class: "STRATEGIC", normalized_reason: s };
  for (const p of TD1_OPERATIONAL_PATTERNS) if (reason.includes(p)) return { output_class, abstain_class: "OPERATIONAL", normalized_reason: p };
  return { output_class, abstain_class: "OPERATIONAL", normalized_reason: reason };
}

// ------------------------------ AAS96 ------------------------------------
const AAS96_STRATEGIC_PATTERNS = [
  "cleanup_veto",
  "cleanup veto",
  "selector_b_confirmation",
  "model_veto",
  "published_abstain_due_to_veto",
  "veto",
];
const AAS96_OPERATIONAL_PATTERNS = [
  "warmup_insufficient_rows",
  "no_active_fit",
  "timestamp_discontinuity",
  "snapshot_from_target_candle",
  "input_features_stale",
  "advance_check_failed",
  "no_partial_snapshot",
  "partial_minutes_lt_14",
  "input_candle_age_gt_930",
  "feature_dimension_mismatch",
  "aas96_error",
  "shadow_error",
  "warmup",
];

export function classifyAas96(rawPrediction: unknown, rawReason: unknown): Classification {
  const pred = normalizePrediction(rawPrediction);
  const output_class = outputClassFor(pred);
  if (output_class !== "ABSTAIN") return { output_class, abstain_class: "NONE", normalized_reason: null };
  const reason = normalizeReasonString(rawReason);
  if (!reason) return { output_class, abstain_class: "OPERATIONAL", normalized_reason: "unspecified" };
  for (const p of AAS96_STRATEGIC_PATTERNS) if (reason.includes(p)) return { output_class, abstain_class: "STRATEGIC", normalized_reason: "cleanup_veto_fired" };
  for (const p of AAS96_OPERATIONAL_PATTERNS) if (reason.includes(p)) return { output_class, abstain_class: "OPERATIONAL", normalized_reason: p };
  return { output_class, abstain_class: "OPERATIONAL", normalized_reason: reason };
}

// ------------------------------- a96 -------------------------------------
const A96_STRATEGIC_PATTERNS = ["agreement_veto", "agreement veto", "veto_fired"];
const A96_OPERATIONAL_PATTERNS = [
  "invalid candle data",
  "invalid_candle_data",
  "missing exact prior candle",
  "missing_exact_prior_candle",
  "unusable feature history",
  "unusable_feature_history",
  "missing base layer",
  "missing_base_layer",
  "provider mismatch",
  "provider_mismatch",
  "resolution data invalid",
  "resolution_data_invalid",
  "upstream skip",
  "upstream_skip",
];

export function classifyA96(
  rawPrediction: unknown,
  rawReason: unknown,
  agreementVetoFired: boolean | null | undefined,
): Classification {
  const pred = normalizePrediction(rawPrediction);
  const output_class = outputClassFor(pred);
  if (output_class !== "ABSTAIN") return { output_class, abstain_class: "NONE", normalized_reason: null };
  if (agreementVetoFired === true) return { output_class, abstain_class: "STRATEGIC", normalized_reason: "agreement_veto_fired" };
  const reason = normalizeReasonString(rawReason);
  if (!reason) return { output_class, abstain_class: "OPERATIONAL", normalized_reason: "unspecified" };
  for (const p of A96_STRATEGIC_PATTERNS) if (reason.includes(p)) return { output_class, abstain_class: "STRATEGIC", normalized_reason: "agreement_veto_fired" };
  for (const p of A96_OPERATIONAL_PATTERNS) if (reason.includes(p)) return { output_class, abstain_class: "OPERATIONAL", normalized_reason: p.replace(/ /g, "_") };
  return { output_class, abstain_class: "OPERATIONAL", normalized_reason: reason };
}

// -------------------------- Base (Model 6/A2) ----------------------------
// The base model in `predictions` uses status='pending'/'manual_review' when
// no directional prediction was actually made.  Treat all non-directional
// outcomes as OPERATIONAL unless the row explicitly recorded a strategic gate.
export function classifyBase(
  rawPrediction: unknown,
  rawReason: unknown,
  agreementGateApplied: boolean | null | undefined,
): Classification {
  const pred = normalizePrediction(rawPrediction);
  const output_class = outputClassFor(pred);
  if (output_class !== "ABSTAIN") return { output_class, abstain_class: "NONE", normalized_reason: null };
  if (agreementGateApplied === true) return { output_class, abstain_class: "STRATEGIC", normalized_reason: "agreement_gate_applied" };
  const reason = normalizeReasonString(rawReason);
  return { output_class, abstain_class: "OPERATIONAL", normalized_reason: reason || "no_directional_output" };
}

// ------------------------ Placeholder helpers ----------------------------
export function unavailable(): Classification {
  return { output_class: "UNAVAILABLE", abstain_class: "NONE", normalized_reason: null };
}
