// Depth/imbalance metrics — mirrors src/lib/b4x4es1/binanceOb/features.ts.

export const DEPTH_BANDS_BPS = [1, 2, 5, 10];

export function computeBookMetrics(bidLevels, askLevels) {
  const out = {
    bestBid: bidLevels[0]?.[0] ?? null,
    bestBidQtyBtc: bidLevels[0]?.[1] ?? null,
    bestAsk: askLevels[0]?.[0] ?? null,
    bestAskQtyBtc: askLevels[0]?.[1] ?? null,
    midPrice: null,
    spreadBps: null,
    microprice: null,
    micropriceDisplacementBps: null,
    crossed: false,
    bands: {},
  };
  for (const d of DEPTH_BANDS_BPS) {
    out.bands[d] = {
      bidDepthBtc: 0,
      askDepthBtc: 0,
      totalDepthBtc: 0,
      bidDepthUsd: 0,
      askDepthUsd: 0,
      totalDepthUsd: 0,
      imbalance: null,
    };
  }
  if (out.bestBid == null || out.bestAsk == null) return out;
  if (out.bestBid >= out.bestAsk) {
    out.crossed = true;
    return out;
  }

  const mid = (out.bestBid + out.bestAsk) / 2;
  out.midPrice = mid;
  out.spreadBps = ((out.bestAsk - out.bestBid) / mid) * 10000;
  const bq = out.bestBidQtyBtc ?? 0;
  const aq = out.bestAskQtyBtc ?? 0;
  if (bq + aq > 0) {
    out.microprice = (out.bestAsk * bq + out.bestBid * aq) / (bq + aq);
    out.micropriceDisplacementBps = ((out.microprice - mid) / mid) * 10000;
  }

  for (const d of DEPTH_BANDS_BPS) {
    const bidFloor = mid * (1 - d / 10000);
    const askCeiling = mid * (1 + d / 10000);
    let bb = 0;
    let bu = 0;
    for (const [price, qty] of bidLevels) {
      if (price < bidFloor) break;
      bb += qty;
      bu += price * qty;
    }
    let ab = 0;
    let au = 0;
    for (const [price, qty] of askLevels) {
      if (price > askCeiling) break;
      ab += qty;
      au += price * qty;
    }
    const total = bb + ab;
    out.bands[d] = {
      bidDepthBtc: bb,
      askDepthBtc: ab,
      totalDepthBtc: total,
      bidDepthUsd: bu,
      askDepthUsd: au,
      totalDepthUsd: bu + au,
      imbalance: total > 0 ? (bb - ab) / total : null,
    };
  }
  return out;
}
