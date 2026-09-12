// Two bounded recovery guarantees:
//
// A) Catch-up is anchored to the COMMITTED CHECKPOINT, not to the newest
//    imported context row. The signed live observer inserts its own newest
//    context row, so resuming from MAX(target_ts) would step over an interval
//    that was never imported and skip it forever.
// B) A daily fit writes ONLY the fit date. It must never read-then-rewrite the
//    checkpoint, or an observation committing in between is regressed.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store.server", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    readState: vi.fn(),
    upsertContextRow: vi.fn(),
    readContextRow: vi.fn(),
    readLiveContext: vi.fn(),
  };
});
vi.mock("../fit.server", () => ({
  backfillV11Vectors: vi.fn(),
  ensureV11Head: vi.fn(),
}));
vi.mock("../observer.server", () => ({ observeV11Target: vi.fn() }));
vi.mock("@/lib/kalshi.server", () => ({ fetchKalshiResolution: vi.fn() }));
vi.mock("../kalshi.server", () => ({ fetchV11NativeResolution: vi.fn() }));

import { runV11Maintenance } from "../maintenance.server";
import * as store from "../store.server";
import * as fit from "../fit.server";
import * as observer from "../observer.server";

const CHECKPOINT = "2026-09-12T01:00:00.000Z";
const MISSING = "2026-09-12T01:15:00.000Z"; // real V1 opportunity, never imported
const LIVE = "2026-09-12T01:30:00.000Z"; // inserted by the signed live observer
const NOW = new Date("2026-09-12T02:00:00.000Z");

interface Filters {
  table: string;
  gte?: string;
  gt?: string;
  lt?: string;
}

/** Fake query builder that records the filters each table query received. */
function fakeSb(rows: Record<string, unknown[]>, seen: Filters[]) {
  return {
    from(table: string) {
      const f: Filters = { table };
      seen.push(f);
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        in: () => chain,
        not: () => chain,
        update: () => chain,
        upsert: () => chain,
        order: () => chain,
        limit: () => chain,
        gte: (_c: string, v: string) => ((f.gte = v), chain),
        gt: (_c: string, v: string) => ((f.gt = v), chain),
        lt: (_c: string, v: string) => ((f.lt = v), chain),
        then: (res: any) =>
          Promise.resolve({ data: rows[table] ?? [], error: null }).then(res),
      };
      return chain;
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  (store.readLiveContext as any).mockResolvedValue(null);
  (store.upsertContextRow as any).mockResolvedValue(undefined);
  (fit.backfillV11Vectors as any).mockResolvedValue({ written: 0 });
  (fit.ensureV11Head as any).mockResolvedValue({ head: null, reason: "NOT_ENOUGH_ROWS" });
  (observer.observeV11Target as any).mockResolvedValue({ processed: true, duplicate: false });
});

describe("A) authoritative catch-up from the checkpoint", () => {
  it("imports a middle opportunity that only exists in the V1 ledger, then scores it", async () => {
    // Shadow context already holds the NEWER live row but not the middle one.
    const contextRows = [{ target_ts: LIVE }];
    (store.readState as any).mockResolvedValue({
      lastProcessedTs: CHECKPOINT,
      stateVersion: 1,
    });
    // Only the missing interval is absent from v11_context_rows.
    (store.readContextRow as any).mockImplementation(async (_sb: unknown, ts: string) =>
      ts === MISSING ? null : { target_ts: ts, label: null },
    );
    (store.readLiveContext as any).mockImplementation(async (_sb: unknown, ts: string) =>
      ts === MISSING ? { target_ts: ts, ticker: "T", label: null } : null,
    );

    const seen: Filters[] = [];
    const sb = fakeSb(
      {
        // MAX(context) is the newer live row...
        v11_context_rows: contextRows,
        // ...but the V1 ledger says the middle interval is a real opportunity.
        c85_targets: [
          { target_open_utc: MISSING },
          { target_open_utc: LIVE },
        ],
      },
      seen,
    );

    const report = await runV11Maintenance(sb, {
      now: NOW,
      kalshiLimit: 0,
      recoverLimit: 10,
    });

    // The ledger scan is anchored to the checkpoint, NOT to MAX(context)=01:30.
    const ledgerScan = seen.find((f) => f.table === "c85_targets");
    expect(ledgerScan?.gte).toBe(CHECKPOINT);
    // The skipped middle interval was imported.
    expect(report.contextAdded).toBe(1);
    expect((store.upsertContextRow as any).mock.calls[0][1].target_ts).toBe(MISSING);
  });

  it("never anchors the ledger scan past the checkpoint even when context is far ahead", async () => {
    (store.readState as any).mockResolvedValue({
      lastProcessedTs: CHECKPOINT,
      stateVersion: 1,
    });
    (store.readContextRow as any).mockResolvedValue({ target_ts: "x", label: null });
    const seen: Filters[] = [];
    await runV11Maintenance(
      fakeSb(
        {
          v11_context_rows: [{ target_ts: "2026-09-12T01:45:00.000Z" }],
          c85_targets: [],
        },
        seen,
      ),
      { now: NOW, kalshiLimit: 0, recoverLimit: 0 },
    );
    const ledgerScan = seen.find((f) => f.table === "c85_targets");
    expect(Date.parse(ledgerScan!.gte!)).toBeLessThanOrEqual(Date.parse(CHECKPOINT));
  });
});

describe("B) fit-date write cannot regress the checkpoint", () => {
  it("updates only last_fit_date and never writes last_processed_ts", async () => {
    const actual = await vi.importActual<typeof import("../store.server")>("../store.server");
    const updates: Record<string, unknown>[] = [];
    let reads = 0;
    const sb = {
      from() {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => {
            reads++;
            return chain;
          },
          update: (patch: Record<string, unknown>) => {
            updates.push(patch);
            return chain;
          },
          upsert: () => chain,
          then: (res: any) =>
            Promise.resolve({ data: [{ state_key: "v11-shadow" }], error: null }).then(res),
        };
        return chain;
      },
    } as any;

    await actual.setLastFitDate(sb, "2026-09-12");

    expect(updates).toHaveLength(1);
    expect(updates[0]).toHaveProperty("last_fit_date", "2026-09-12");
    expect(updates[0]).not.toHaveProperty("last_processed_ts");
    expect(reads).toBe(0); // no read-modify-write window at all
  });

  it("a concurrent observation checkpoint survives a fit-date write", async () => {
    const actual = await vi.importActual<typeof import("../store.server")>("../store.server");
    // Simulated single-row state table.
    const row = { state_key: "v11-shadow", last_processed_ts: CHECKPOINT, last_fit_date: null as string | null };
    const sb = {
      from() {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          update: (patch: Record<string, unknown>) => {
            Object.assign(row, patch);
            return chain;
          },
          upsert: () => chain,
          then: (res: any) =>
            Promise.resolve({ data: [{ state_key: "v11-shadow" }], error: null }).then(res),
        };
        return chain;
      },
    } as any;

    // Observation commits a newer checkpoint mid-flight.
    const fitWrite = actual.setLastFitDate(sb, "2026-09-12");
    row.last_processed_ts = LIVE;
    await fitWrite;

    expect(row.last_processed_ts).toBe(LIVE); // NOT regressed to CHECKPOINT
    expect(row.last_fit_date).toBe("2026-09-12");
  });
});
