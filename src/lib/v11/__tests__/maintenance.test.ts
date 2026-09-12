// Maintenance must work from an EMPTY checkpoint (cold bootstrap) and must
// only ever fill labels in, never overwrite them.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store.server", () => ({
  readState: vi.fn(),
  upsertContextRow: vi.fn(),
  readContextRow: vi.fn(),
  readLiveContext: vi.fn(),
}));
vi.mock("../fit.server", () => ({
  backfillV11Vectors: vi.fn(),
  ensureV11Head: vi.fn(),
}));
vi.mock("../observer.server", () => ({ observeV11Target: vi.fn() }));
vi.mock("@/lib/kalshi.server", () => ({ fetchKalshiResolution: vi.fn() }));

import { runV11Maintenance } from "../maintenance.server";
import * as store from "../store.server";
import * as fit from "../fit.server";
import * as observer from "../observer.server";

const m = {
  readState: store.readState as any,
  upsertContextRow: store.upsertContextRow as any,
  readContextRow: store.readContextRow as any,
  readLiveContext: store.readLiveContext as any,
  backfill: fit.backfillV11Vectors as any,
  ensureHead: fit.ensureV11Head as any,
  observe: observer.observeV11Target as any,
};

const NOW = new Date("2026-09-12T03:07:00.000Z");
const CTX = [
  { target_ts: "2026-09-12T01:00:00.000Z" },
  { target_ts: "2026-09-12T01:15:00.000Z" },
  { target_ts: "2026-09-12T01:30:00.000Z" },
];

/** Stand-in for the query builder; returns per-table canned rows. */
function fakeSb(rows: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const chain: any = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") {
              return (res: any) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(res);
            }
            return () => chain;
          },
        },
      );
      return chain;
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.readContextRow.mockResolvedValue({ target_ts: "x", label: null });
  m.readLiveContext.mockResolvedValue(null);
  m.backfill.mockResolvedValue({ written: 0 });
  m.ensureHead.mockResolvedValue({ head: null, reason: "NOT_ENOUGH_ROWS" });
  m.observe.mockResolvedValue({ processed: true, duplicate: false });
});

describe("cold bootstrap", () => {
  it("scores from the very first opportunity when there is no checkpoint", async () => {
    m.readState.mockResolvedValue({ lastProcessedTs: null, stateVersion: null });
    const report = await runV11Maintenance(fakeSb({ v11_context_rows: CTX }), {
      now: NOW,
      recoverLimit: 10,
      kalshiLimit: 0,
    });
    expect(m.observe).toHaveBeenCalledTimes(3);
    expect(m.observe.mock.calls[0][1]).toBe("2026-09-12T01:00:00.000Z");
    expect(report.bootstrapped).toBe(true);
    expect(report.recovered).toBe(3);
    expect(report.lastProcessedTs).toBe("2026-09-12T01:30:00.000Z");
  });

  it("stops instead of marching past a refused commit", async () => {
    m.readState.mockResolvedValue({ lastProcessedTs: null, stateVersion: null });
    m.observe
      .mockResolvedValueOnce({ processed: true, duplicate: false })
      .mockResolvedValueOnce({ processed: false, duplicate: false });
    const report = await runV11Maintenance(fakeSb({ v11_context_rows: CTX }), {
      now: NOW,
      recoverLimit: 10,
      kalshiLimit: 0,
    });
    expect(report.recovered).toBe(1);
    expect(m.observe).toHaveBeenCalledTimes(2);
  });

  it("reports an existing checkpoint as NOT a bootstrap", async () => {
    m.readState.mockResolvedValue({
      lastProcessedTs: "2026-09-12T00:45:00.000Z",
      stateVersion: 7,
    });
    const report = await runV11Maintenance(fakeSb({ v11_context_rows: CTX }), {
      now: NOW,
      recoverLimit: 10,
      kalshiLimit: 0,
    });
    expect(report.bootstrapped).toBe(false);
    expect(report.recovered).toBe(3);
  });
});

describe("labels are filled in, never overwritten", () => {
  it("skips a context row that already carries a label", async () => {
    m.readState.mockResolvedValue({ lastProcessedTs: null, stateVersion: null });
    m.readContextRow.mockResolvedValue({ target_ts: "x", label: 1 });
    const report = await runV11Maintenance(fakeSb({ v11_context_rows: CTX }), {
      now: NOW,
      recoverLimit: 0,
      kalshiLimit: 0,
    });
    expect(report.labelsRefreshed).toBe(0);
    expect(m.upsertContextRow).not.toHaveBeenCalled();
  });
});
