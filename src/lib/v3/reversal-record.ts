// Pure dashboard transition guard. No database, sender or trading side effects.
export function allowV3RecordTransition(prev: any, d: any, openMs: number): boolean {
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
