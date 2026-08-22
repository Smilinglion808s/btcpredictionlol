// T45 PriceFlow — 96-row fit rollover regression tests.
//
// These lock the failure that stalled production at absolute index 25152:
// the training window read was truncated to 1,000 rows, so every fit at a new
// block boundary failed the minimum-rows gate and the model abstained with
// FIT_NOT_READY forever.

import { describe, expect, it, vi } from "vitest";
import {
  MODEL_VERSION,
  T45PF_BLOCK_SIZE,
  T45PF_CONFIG_HASH,
  T45PF_FEATURE_ORDER,
  T45PF_FEATURE_ORDER_HASH,
  T45PF_TRAIN_WINDOW,
} from "../config";
import { fitPFHead, pfBlockStart, pfFitCertified, type PFTrainingRow } from "../head";
import { pfArtifactHash, pfFitId, pfStableArtifactHash } from "../replay";
import { ensurePFFit, headFromFitRow } from "../fitService.server";

// ---------------------------------------------------------------- fake store

type Row = Record<string, unknown>;

const state = {
  fits: [] as Row[],
  training: [] as PFTrainingRow[],
  inserts: 0,
};

vi.mock("../store.server", () => ({
  loadPFTrainingRows: async () => state.training,
  readPFFit: async (_sb: unknown, fitId: string) =>
    state.fits.find((f) => f.fit_id === fitId) ?? null,
  insertPFFit: async (_sb: unknown, row: Row) => {
    state.inserts++;
    // Mirrors the database uniqueness constraint on (model_version, block).
    if (!state.fits.some((f) => f.fit_id === row.fit_id)) state.fits.push(row);
  },
}));

const sb = {} as never;

function reset(training: PFTrainingRow[], fits: Row[] = []) {
  state.fits = [...fits];
  state.training = training;
  state.inserts = 0;
}

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
    reset(rows);
    const first = await ensurePFFit(sb, 25152);
    expect(first.status).toBe("MINTED");
    expect(first.certified).toBe(true);
    const second = await ensurePFFit(sb, 25152);
    expect(second.status).toBe("LOADED");
    expect(second.minted).toBe(false);
    expect(second.artifactHash).toBe(first.artifactHash);
    expect(state.inserts).toBe(1);
  });

  it("concurrent mints converge on one stored artifact", async () => {
    reset(rows);
    const [a, b] = await Promise.all([ensurePFFit(sb, 25152), ensurePFFit(sb, 25152)]);
    expect(state.fits.filter((f) => f.block_start_index === 25152)).toHaveLength(1);
    expect(a.artifactHash).toBe(b.artifactHash);
    expect(a.certified && b.certified).toBe(true);
  });

  it("rejects a conflicting stored artifact and fails closed", async () => {
    const head = fitPFHead(25152, rows)!;
    reset(rows, [{ ...storedRowFor(head), artifact_stable_hash: "deadbeefdeadbeef" }]);
    const res = await ensurePFFit(sb, 25152);
    expect(res.status).toBe("CONFLICTING_ARTIFACT");
    expect(res.certified).toBe(false);
    expect(res.head).toBeNull();
  });

  it("fails closed when the window is too small to certify", async () => {
    reset(makeRows(25152, 1000));
    const res = await ensurePFFit(sb, 25152);
    expect(res.status).toBe("UNTRAINABLE");
    expect(res.certified).toBe(false);
    expect(res.error).toContain("insufficient_training_rows");
  });

  it("never mints when minting is disabled", async () => {
    reset(rows);
    const res = await ensurePFFit(sb, 25152, { allowMint: false });
    expect(res.status).toBe("UNTRAINABLE");
    expect(state.inserts).toBe(0);
  });

  it("a stored uncertified fit stays uncertified", async () => {
    const head = fitPFHead(25152, rows)!;
    const row = { ...storedRowFor(head), converged: false, gradient_norm: 5 };
    reset(rows, [row]);
    const res = await ensurePFFit(sb, 25152);
    expect(res.status).toBe("UNCERTIFIED");
    expect(res.certified).toBe(false);
    expect(headFromFitRow(row).converged).toBe(false);
  });
});

function storedRowFor(head: ReturnType<typeof fitPFHead> & object): Row {
  const h = head!;
  return {
    fit_id: pfFitId(h.blockStartIndex),
    model_version: MODEL_VERSION,
    config_hash: T45PF_CONFIG_HASH,
    feature_order_hash: T45PF_FEATURE_ORDER_HASH,
    block_index: h.blockIndex,
    block_start_index: h.blockStartIndex,
    training_row_count: h.trainingRowCount,
    training_fingerprint: h.trainingFingerprint,
    scaler_center: h.scaler.center,
    scaler_scale: h.scaler.scale,
    coefficients: h.coefficients,
    intercept: h.intercept,
    converged: h.converged,
    iterations: h.iterations,
    gradient_norm: h.gradientNorm,
    artifact_stable_hash: pfStableArtifactHash(h),
  };
}
