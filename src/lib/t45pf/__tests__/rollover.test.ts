// T45 PriceFlow — 96-row fit rollover regression tests.
//
// These lock the failure that stalled production at absolute index 25152:
// the training window read was truncated to 1,000 rows, so every fit at a new
// block boundary failed the minimum-rows gate and the model abstained with
// FIT_NOT_READY forever.

import { describe, expect, it } from "vitest";
import { T45PF_BLOCK_SIZE, T45PF_FEATURE_ORDER, T45PF_TRAIN_WINDOW } from "../config";
import { fitPFHead, pfBlockStart, pfFitCertified, type PFTrainingRow } from "../head";
import { pfArtifactHash, pfFitId, pfStableArtifactHash } from "../replay";
import { ensurePFFit, headFromFitRow } from "../fitService.server";

// ---------------------------------------------------------------- fake store

type Row = Record<string, unknown>;

function makeRows(blockStart: number, n: number): PFTrainingRow[] {
  const rows: PFTrainingRow[] = [];
  for (let i = 0; i < n; i++) {
    const index = blockStart - n + i;
    const t = i / n;
    const vector = T45PF_FEATURE_ORDER.map((_, j) => Math.sin((i + 1) * (j + 1) * 0.017));
    rows.push({
      targetTs: new Date(Date.UTC(2026, 0, 1) + index * 900_000).toISOString(),
      index,
      vector,
      label: Math.sin(i * 0.31) + t > 0.4 ? 1 : -1,
    });
  }
  return rows;
}

/** Minimal Supabase stand-in covering exactly the calls ensurePFFit makes. */
function fakeSb(opts: {
  fits?: Row[];
  training: PFTrainingRow[];
  onInsert?: (row: Row) => void;
  failInsert?: boolean;
}) {
  const fits: Row[] = [...(opts.fits ?? [])];
  const calls = { inserts: 0, trainingLoads: 0 };
  const sb = {
    from(table: string) {
      if (table === "t45_pf_fits") {
        return {
          _eq: null as string | null,
          select() {
            return this;
          },
          eq(_col: string, val: string) {
            this._eq = val;
            return this;
          },
          async maybeSingle() {
            return { data: fits.find((f) => f.fit_id === this._eq) ?? null };
          },
          async upsert(row: Row) {
            calls.inserts++;
            opts.onInsert?.(row);
            if (opts.failInsert) return { error: { message: "duplicate" } };
            if (!fits.some((f) => f.fit_id === row.fit_id)) fits.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { sb: sb as never, fits, calls };
}

// Route loadPFTrainingRows through the fake by stubbing the module.
import * as store from "../store.server";

function withTraining(rows: PFTrainingRow[], fn: () => Promise<void>) {
  const original = store.loadPFTrainingRows;
  (store as { loadPFTrainingRows: unknown }).loadPFTrainingRows = async () => rows;
  return fn().finally(() => {
    (store as { loadPFTrainingRows: unknown }).loadPFTrainingRows = original;
  });
}

// ------------------------------------------------------------------- boundary

describe("block boundary selection", () => {
  it("uses the previous completed block at 25151 and rolls over at 25152", () => {
    expect(pfBlockStart(25151)).toBe(25056);
    expect(pfBlockStart(25152)).toBe(25152);
    expect(pfBlockStart(25153)).toBe(25152);
    expect(25152 % T45PF_BLOCK_SIZE).toBe(0);
  });

  it("fit ids are stable and unique per boundary", () => {
    expect(pfFitId(25152)).toBe("t45-price-flow-q375-r1::block=25152");
    expect(pfFitId(25056)).not.toBe(pfFitId(25152));
  });
});

describe("training window bounds", () => {
  it("is strictly past-only and exactly one lookback window wide", () => {
    const blockStart = 25152;
    const lo = blockStart - T45PF_TRAIN_WINDOW;
    const rows = makeRows(blockStart, T45PF_TRAIN_WINDOW);
    expect(rows[0].index).toBe(lo);
    expect(rows[rows.length - 1].index).toBe(blockStart - 1);
    expect(rows.every((r) => r.index < blockStart)).toBe(true);
  });

  it("a truncated 1,000-row read cannot produce a fit (the production failure)", () => {
    const head = fitPFHead(25152, makeRows(25152, 1000));
    expect(head).toBeNull();
  });

  it("a full window produces a certified, deterministic fit", () => {
    const rows = makeRows(25152, 8278);
    const a = fitPFHead(25152, rows);
    const b = fitPFHead(25152, rows);
    expect(a).not.toBeNull();
    expect(pfFitCertified(a!)).toBe(true);
    expect(pfArtifactHash(a!)).toBe(pfArtifactHash(b!));
    expect(a!.blockStartIndex).toBe(25152);
  });
});

describe("stable verification hash", () => {
  it("survives a 15-significant-digit database round-trip", () => {
    const head = fitPFHead(25152, makeRows(25152, 8278))!;
    const roundTripped = {
      ...head,
      intercept: Number(head.intercept.toPrecision(15)),
      coefficients: head.coefficients.map((c) => Number(c.toPrecision(15))),
      scaler: {
        center: head.scaler.center.map((c) => Number(c.toPrecision(15))),
        scale: head.scaler.scale.map((c) => Number(c.toPrecision(15))),
      },
    };
    expect(pfStableArtifactHash(roundTripped)).toBe(pfStableArtifactHash(head));
  });
});

describe("ensurePFFit", () => {
  const rows = makeRows(25152, 8278);

  it("mints at a rollover, then loads the same artifact idempotently", async () => {
    await withTraining(rows, async () => {
      const { sb, calls } = fakeSb({ training: rows });
      const first = await ensurePFFit(sb, 25152);
      expect(first.status).toBe("MINTED");
      expect(first.certified).toBe(true);
      const second = await ensurePFFit(sb, 25152);
      expect(second.status).toBe("LOADED");
      expect(second.minted).toBe(false);
      expect(second.artifactHash).toBe(first.artifactHash);
      expect(calls.inserts).toBe(1);
    });
  });

  it("concurrent mints converge on one stored artifact", async () => {
    await withTraining(rows, async () => {
      const { sb, fits } = fakeSb({ training: rows });
      const [a, b] = await Promise.all([ensurePFFit(sb, 25152), ensurePFFit(sb, 25152)]);
      expect(fits.filter((f) => f.block_start_index === 25152)).toHaveLength(1);
      expect(a.artifactHash).toBe(b.artifactHash);
      expect(a.certified && b.certified).toBe(true);
    });
  });

  it("rejects a conflicting stored artifact and fails closed", async () => {
    const head = fitPFHead(25152, rows)!;
    const bad: Row = {
      fit_id: pfFitId(25152),
      model_version: "t45-price-flow-q375-r1",
      config_hash: (await import("../config")).T45PF_CONFIG_HASH,
      feature_order_hash: (await import("../config")).T45PF_FEATURE_ORDER_HASH,
      block_index: head.blockIndex,
      block_start_index: 25152,
      training_row_count: head.trainingRowCount,
      training_fingerprint: head.trainingFingerprint,
      scaler_center: head.scaler.center,
      scaler_scale: head.scaler.scale,
      coefficients: head.coefficients,
      intercept: head.intercept,
      converged: true,
      artifact_stable_hash: "deadbeefdeadbeef",
    };
    const { sb } = fakeSb({ training: rows, fits: [bad] });
    const res = await ensurePFFit(sb, 25152);
    expect(res.status).toBe("CONFLICTING_ARTIFACT");
    expect(res.certified).toBe(false);
    expect(res.head).toBeNull();
  });

  it("fails closed when the window is too small to certify", async () => {
    const short = makeRows(25152, 1000);
    await withTraining(short, async () => {
      const { sb } = fakeSb({ training: short });
      const res = await ensurePFFit(sb, 25152);
      expect(res.status).toBe("UNTRAINABLE");
      expect(res.certified).toBe(false);
      expect(res.error).toContain("insufficient_training_rows");
    });
  });

  it("never mints when minting is disabled", async () => {
    await withTraining(rows, async () => {
      const { sb, calls } = fakeSb({ training: rows });
      const res = await ensurePFFit(sb, 25152, { allowMint: false });
      expect(res.status).toBe("UNTRAINABLE");
      expect(calls.inserts).toBe(0);
    });
  });

  it("a stored uncertified fit stays uncertified", async () => {
    const head = fitPFHead(25152, rows)!;
    const row: Row = {
      fit_id: pfFitId(25152),
      model_version: "t45-price-flow-q375-r1",
      config_hash: (await import("../config")).T45PF_CONFIG_HASH,
      feature_order_hash: (await import("../config")).T45PF_FEATURE_ORDER_HASH,
      block_index: head.blockIndex,
      block_start_index: 25152,
      training_row_count: head.trainingRowCount,
      training_fingerprint: head.trainingFingerprint,
      scaler_center: head.scaler.center,
      scaler_scale: head.scaler.scale,
      coefficients: head.coefficients,
      intercept: head.intercept,
      converged: false,
      iterations: 1,
      gradient_norm: 5,
    };
    const { sb } = fakeSb({ training: rows, fits: [row] });
    const res = await ensurePFFit(sb, 25152);
    expect(res.status).toBe("UNCERTIFIED");
    expect(res.certified).toBe(false);
    expect(headFromFitRow(row).converged).toBe(false);
  });
});
