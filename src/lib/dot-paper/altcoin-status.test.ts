import { describe, expect, it } from "vitest";
import { deriveAltView } from "./altcoin-status";

const now = 1_000_000;
describe("deriveAltView", () => {
  it("no data -> UNKNOWN awaiting", () => {
    const v = deriveAltView(undefined, now);
    expect(v.label).toBe("UNKNOWN");
    expect(v.note).toBe("Awaiting collector data");
    expect(v.connects).toBeNull();
  });
  it("unreachable worker (ledger startup failure) -> ERROR, not live", () => {
    const v = deriveAltView({ ok: false }, now);
    expect(v.label).toBe("ERROR");
    expect(v.tone).toBe("red");
    expect(v.workerLive).toBe(false);
  });
  it("worker error status is never green", () => {
    const v = deriveAltView({ ok: true, data: { status: "ERROR", altcoin: { enabled: true, state: "CONNECTING", last_event_ms: now } } }, now);
    expect(v.label).toBe("ERROR");
  });
  it("healthy worker without altcoin fields -> awaiting", () => {
    expect(deriveAltView({ ok: true, data: { status: "OK" } }, now).note).toBe("Awaiting collector data");
  });
  it("disabled -> OFF", () => {
    expect(deriveAltView({ ok: true, data: { status: "OK", altcoin: { enabled: false } } }, now).label).toBe("OFF");
  });
  it("backoff -> ERROR with counters passed through", () => {
    const v = deriveAltView({ ok: true, data: { status: "OK", altcoin: { enabled: true, state: "BACKOFF", connects: 4, failures: 3, last_error: "OSError" } } }, now);
    expect([v.label, v.connects, v.failures, v.lastError]).toEqual(["ERROR", 4, 3, "OSError"]);
  });
  it("stale vs fresh events; running without timestamp stays UNKNOWN", () => {
    const run = (t?: number) => deriveAltView({ ok: true, data: { status: "OK", altcoin: { enabled: true, state: "RUNNING", last_event_ms: t } } }, now).label;
    expect(run(now - 20_000)).toBe("STALE");
    expect(run(now - 1_000)).toBe("LIVE");
    expect(run(undefined)).toBe("UNKNOWN");
  });
});
