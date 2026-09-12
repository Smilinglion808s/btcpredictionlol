// Head binding, future-fit refusal, rank/availability clocks. Pure module: no
// database, no network.

import { describe, expect, it } from "vitest";
import {
  fitV11Head,
  v11Availability,
  v11ConfidenceRank,
  v11HeadCertified,
  v11Probability,
  type V11Head,
  type V11TrainingRow,
} from "../head";
import {
  V11_CONFIG_FINGERPRINT,
  V11_FEATURE_ORDER,
  V11_FEATURE_ORDER_HASH,
} from "../config";

const N = V11_FEATURE_ORDER.length;

function rows(count: number, day: string): V11TrainingRow[] {
  const base = Date.parse(`${day}T00:00:00.000Z`);
  return [...new Array(count).keys()].map((i) => ({
    targetTs: new Date(base + i * 900_000).toISOString(),
    vector: [...new Array(N).keys()].map((j) => ((i + j) % 7) - 3),
    label: i % 2 === 0 ? 1 : -1,
    settlementTs: new Date(base + i * 900_000 + 300_000).toISOString(),
  }));
}

function head(over: Partial<V11Head> = {}): V11Head {
  return {
    fitDate: "2026-09-11",
    expiresAt: "2026-09-12T00:00:00.000Z",
    cutoffTs: "2026-09-11T00:00:00.000Z",
    featureOrderHash: V11_FEATURE_ORDER_HASH,
    configFingerprint: V11_CONFIG_FINGERPRINT,
    maxTrainingSettlementTs: "2026-09-10T23:45:00.000Z",
    quarantined: false,
    quarantineReason: null,
    scaler: {
      center: new Array(N).fill(0),
      scale: new Array(N).fill(1),
    },
    coefficients: new Array(N).fill(0.01),
    intercept: 0,
    converged: true,
    iterations: 11,
    gradientNorm: 1e-6,
    trainingRowCount: 3000,
    ...over,
  } as V11Head;
}

describe("head fitting refuses dishonest heads", () => {
  it("refuses a head whose midnight cutoff has not happened yet", () => {
    const fitted = fitV11Head(
      "2026-09-14",
      rows(4000, "2026-07-01"),
      new Date("2026-09-12T10:00:00.000Z"),
    );
    expect(fitted).toBeNull();
  });

  it("binds a fitted head to this feature order and configuration", () => {
    const fitted = fitV11Head(
      "2026-09-11",
      rows(4000, "2026-07-01"),
      new Date("2026-09-11T10:00:00.000Z"),
    );
    expect(fitted).not.toBeNull();
    expect(fitted!.featureOrderHash).toBe(V11_FEATURE_ORDER_HASH);
    expect(fitted!.configFingerprint).toBe(V11_CONFIG_FINGERPRINT);
    expect(Date.parse(fitted!.maxTrainingSettlementTs!)).toBeLessThan(
      Date.parse(fitted!.cutoffTs!),
    );
  });

  it("refuses labels that are not exactly +1 or -1", () => {
    const bad = rows(4000, "2026-07-01").map((r) => ({ ...r, label: 0 }));
    expect(
      fitV11Head("2026-09-11", bad, new Date("2026-09-11T10:00:00.000Z")),
    ).toBeNull();
  });
});

describe("certification", () => {
  const now = new Date("2026-09-11T12:00:00.000Z");

  it("accepts a well-formed current head", () => {
    expect(v11HeadCertified(head(), now)).toBe(true);
  });

  it("rejects a quarantined head", () => {
    expect(v11HeadCertified(head({ quarantined: true }), now)).toBe(false);
  });

  it("rejects a head fitted for a different feature order or configuration", () => {
    expect(v11HeadCertified(head({ featureOrderHash: "deadbeefdeadbeef" }), now)).toBe(
      false,
    );
    expect(v11HeadCertified(head({ configFingerprint: "deadbeefdeadbeef" }), now)).toBe(
      false,
    );
  });

  it("rejects a head cut at a midnight that has not arrived", () => {
    expect(
      v11HeadCertified(head({ cutoffTs: "2026-09-14T00:00:00.000Z" }), now),
    ).toBe(false);
  });

  it("rejects a head trained on a settlement at or after its own cutoff", () => {
    expect(
      v11HeadCertified(
        head({ maxTrainingSettlementTs: "2026-09-11T00:30:00.000Z" }),
        now,
      ),
    ).toBe(false);
  });

  it("rejects a mis-shaped scaler", () => {
    expect(
      v11HeadCertified(
        head({ scaler: { center: [0], scale: new Array(N).fill(1) } }),
        now,
      ),
    ).toBe(false);
  });
});

describe("probability", () => {
  it("refuses a wrong-length or non-finite vector rather than scoring it", () => {
    expect(Number.isNaN(v11Probability(head(), [1, 2, 3]))).toBe(true);
    const v = new Array(N).fill(1);
    v[3] = NaN;
    expect(Number.isNaN(v11Probability(head(), v))).toBe(true);
  });
});

describe("rank and availability are two different clocks", () => {
  it("ranks against the newest 768 FINITE confidences even with more mixed rows", () => {
    // 1200 opportunities, every other one unscored. Only finite ones may count.
    const mixed: (number | null)[] = [];
    for (let i = 0; i < 1200; i++) mixed.push(i % 2 === 0 ? i / 10000 : null);
    const { rank, historyCount } = v11ConfidenceRank(999, mixed);
    expect(historyCount).toBe(600); // finite count, capped at 768
    expect(rank).toBe(1);
  });

  it("counts availability over official opportunities INCLUDING the invalid ones", () => {
    const opps: (number | null)[] = [];
    for (let i = 0; i < 768; i++) opps.push(i < 384 ? 0.1 : null);
    const { availability } = v11Availability(opps);
    expect(availability).toBeCloseTo(0.5, 12);
  });

  it("reports no availability at all when nothing in the window was scored", () => {
    const { availability } = v11Availability(new Array(768).fill(null));
    expect(availability).toBe(0);
  });
});
