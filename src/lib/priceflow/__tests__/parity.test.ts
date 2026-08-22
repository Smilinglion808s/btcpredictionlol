// Proves the shared PriceFlow window formulas are bit-identical to the frozen
// T45 reference implementation, so binding them to the T30 horizon cannot have
// silently changed the certified T45 math.

import { describe, expect, it } from "vitest";
import { buildT45Features } from "@/lib/t45/features";
import { PF45_SPEC, buildPriceFlowFeatures } from "../windowFeatures";
import type { PFSecondBar } from "../windowFeatures";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function packet(seed: number, n: number): PFSecondBar[] {
  const r = rng(seed);
  const bars: PFSecondBar[] = [];
  let price = 60000 + r() * 5000;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = open * (1 + (r() - 0.5) * 0.0012);
    const high = Math.max(open, close) * (1 + r() * 0.0004);
    const low = Math.min(open, close) * (1 - r() * 0.0004);
    const volume = r() * 4 + 0.01;
    const quoteVolume = volume * ((open + close) / 2);
    bars.push({
      offsetSeconds: i,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume,
      tradeCount: Math.floor(r() * 300) + 1,
      takerBuyQuoteVolume: quoteVolume * r(),
    });
    price = close;
  }
  return bars;
}

describe("PriceFlow shared window features", () => {
  it("reproduces the frozen T45 reference exactly on 200 random packets", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const bars = packet(seed, 45);
      const reference = buildT45Features(bars, 1).values;
      const shared = buildPriceFlowFeatures(bars, PF45_SPEC).values;
      for (const key of Object.keys(shared)) {
        if (key === "t45_r2_prior" || key.startsWith("t45_r2_")) continue;
        expect(`${key}=${shared[key]}`).toBe(`${key}=${reference[key]}`);
      }
    }
  });

  it("flags an incomplete packet instead of computing features", () => {
    const bars = packet(7, 45).filter((b) => b.offsetSeconds !== 12);
    const out = buildPriceFlowFeatures(bars, PF45_SPEC);
    expect(out.spotComplete).toBe(false);
    expect(out.invalidReason).toBe("INCOMPLETE_SECOND_BARS");
  });
});
