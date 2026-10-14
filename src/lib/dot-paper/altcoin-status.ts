/** Honest altcoin collector labels. Never invents a metric the worker did not report. */
export type AltLabel = "OFF" | "CONNECTING" | "LIVE" | "STALE" | "ERROR" | "UNKNOWN";
export type AltHealthInput =
  | { ok: false }
  | {
      ok: true;
      data: {
        status?: string;
        mode?: string;
        altcoin?: {
          enabled: boolean;
          state?: string;
          last_error?: string | null;
          connects?: number;
          failures?: number;
          last_event_ms?: number | null;
        };
      };
    };
export const ALT_STALE_MS = 10_000;
export interface AltView {
  label: AltLabel;
  tone: "red" | "amber" | "mint";
  note: string;
  workerLive: boolean;
  mode: string | null;
  connects: number | null;
  failures: number | null;
  lastEventMs: number | null;
  ageMs: number | null;
  lastError: string | null;
}
export function deriveAltView(h: AltHealthInput | undefined, now: number): AltView {
  const empty: AltView = {
    label: "UNKNOWN", tone: "amber", note: "Awaiting collector data", workerLive: false,
    mode: null, connects: null, failures: null, lastEventMs: null, ageMs: null, lastError: null,
  };
  if (!h) return empty;
  if (!h.ok) return { ...empty, label: "ERROR", tone: "red", note: "Paper worker not reachable — not live. Awaiting collector data" };
  const workerLive = h.data.status === "OK";
  const a = h.data.altcoin;
  const base = { ...empty, workerLive, mode: h.data.mode ?? null };
  if (!workerLive) return { ...base, label: "ERROR", tone: "red", note: "Paper worker reports an error — not live" };
  if (!a) return base;
  const v = {
    ...base,
    connects: a.connects ?? null,
    failures: a.failures ?? null,
    lastError: a.last_error ?? null,
    lastEventMs: a.last_event_ms ?? null,
    ageMs: a.last_event_ms != null ? Math.max(0, now - a.last_event_ms) : null,
  };
  if (!a.enabled || a.state === "DISABLED") return { ...v, label: "OFF", tone: "amber", note: "Collector switched off" };
  if (a.state === "CONNECTING" || a.state === "IDLE") return { ...v, label: "CONNECTING", tone: "amber", note: "Connecting to public feed" };
  if (a.state === "BACKOFF") return { ...v, label: "ERROR", tone: "red", note: "Reconnecting after a failure" };
  if (a.state === "STOPPED") return { ...v, label: "OFF", tone: "amber", note: "Collector stopped" };
  if (v.ageMs != null) {
    return v.ageMs > ALT_STALE_MS
      ? { ...v, label: "STALE", tone: "amber", note: "No recent market events" }
      : { ...v, label: "LIVE", tone: "mint", note: "Receiving public events" };
  }
  return { ...v, note: "Collector running; latest event time not reported" };
}
