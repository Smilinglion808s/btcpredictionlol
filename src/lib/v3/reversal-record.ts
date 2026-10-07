// Pure dashboard transition guard. No database, sender or trading side effects.
export function allowV3RecordTransition(prev: any, d: any, openMs: number): boolean {
  // New policy intents are authenticated by the existing raw-body signature upstream.
  // Keep terminal calibration records immutable against older baseline heartbeats.
  const actions = new Set(["KEEP_BASELINE", "SKIP_BASELINE", "ADD_LOWER60", "DECLINE_LOWER60"]);
  const finalCalibration = (x: any) => actions.has(x?.reason) ||
    (x?.status === "FAIL_CLOSED" && String(x.reason).startsWith("CALIBRATION_"));
  const same = prev?.direction === d.direction && prev?.checkpoint === d.checkpoint;
  if (finalCalibration(prev)) return same && d.reason === prev.reason &&
    (d.status === prev.status || (prev.status === "SELECTED" && d.status === "EXPIRED_UNSENT"));
  const cal = d.calibration_filter;
  if (cal?.mode === "enforce" && cal.version === "v3-calibrated-risk-r3-r1" &&
      cal.lineage === "v3-okx-core-kalshi-official-r1") {
    const timestamp = Number.isFinite(cal.evaluated_at_ms) && cal.evaluated_at_ms >= openMs+45_000;
    if (cal.status === "INVALID") return timestamp && d.status === "FAIL_CLOSED" &&
      d.reason === cal.reason && (!prev?.direction || same);
    const valid = timestamp && cal.evaluated_at_ms < openMs+46_000 &&
      cal.feature_asof_ms === openMs+44_999 && /^[a-f0-9]{64}$/.test(cal.head_sha256) &&
      Number.isFinite(cal.p_correct) && cal.p_correct >= 0 && cal.p_correct <= 1 && d.reason === cal.reason;
    if (!valid) return false;
    const originalMatches = !prev?.direction || (prev.direction === cal.original_selected_side &&
      prev.checkpoint === cal.original_selected_checkpoint);
    if (!originalMatches) return false;
    if (cal.reason === "SKIP_BASELINE") return cal.status === "SKIP" && d.status === "NO_CALL" &&
      cal.p_correct < .55 && cal.baseline_side === d.direction && (!prev?.direction || same);
    if (cal.reason === "DECLINE_LOWER60") return cal.status === "SKIP" && d.status === "NO_CALL" &&
      cal.p_correct < .64 && cal.baseline_side === 0 && (!prev?.direction || same);
    const risk = d.reversal_risk;
    const pass = cal.status === "PASS" && ["SELECTED", "EXPIRED_UNSENT"].includes(d.status) &&
      [-1,1].includes(d.direction) && [15,30].includes(d.checkpoint) &&
      cal.candidate_side === d.direction && cal.candidate_checkpoint === d.checkpoint &&
      risk?.status === "PASS" && risk.version === "v3-reversal-risk-t45-r1";
    if (cal.reason === "KEEP_BASELINE") return pass && cal.p_correct >= .55 &&
      cal.baseline_side === d.direction && (!prev?.direction || same);
    if (cal.reason === "ADD_LOWER60") return pass && cal.p_correct >= .64 && cal.baseline_side === 0 &&
      cal.candidate_rank >= .60 && (!prev?.direction || cal.original_risk_status === "SKIP");
    return false;
  }
  // Explicit calibration actions must pass the checks above. Shadow metadata on
  // an otherwise unchanged baseline record still uses the original guard.
  if (finalCalibration(d)) return false;
  if (prev?.direction != null && d.direction != null && prev.direction !== d.direction) return false;
  const finalRisk = (x: any) =>
    (x?.status === "NO_CALL" && x.reason === "REVERSAL_RISK_SKIP") ||
    (x?.status === "FAIL_CLOSED" && x.reason === "REVERSAL_RISK_UNAVAILABLE");
  if (finalRisk(prev)) return d.status === prev.status && d.reason === prev.reason && d.checkpoint === prev.checkpoint;
  if (prev?.status !== "SELECTED") return true;
  if (d.checkpoint !== prev.checkpoint) return false;
  if (d.status === "SELECTED" || d.status === "EXPIRED_UNSENT") return true;
  const risk = d.reversal_risk;
  return finalRisk(d) && d.direction === prev.direction &&
    risk?.version === "v3-reversal-risk-t45-r1" &&
    risk.feature_schema === "reversal50-v3-side-rank-t45-r1" &&
    Number.isFinite(risk.evaluated_at_ms) &&
    risk.evaluated_at_ms >= openMs + 45_000 && risk.evaluated_at_ms < openMs + 49_000 &&
    ((d.status === "NO_CALL" && risk.status === "SKIP") ||
     (d.status === "FAIL_CLOSED" && risk.status === "INVALID"));
}
