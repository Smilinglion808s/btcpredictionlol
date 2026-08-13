import { buildKalshiEventTicker } from "./kalshi.server";

export const BTC_15M_TF_MS = 15 * 60 * 1000;
/**
 * How far before the boundary the prediction pass starts. Raised from 20s to
 * 40s: at 20s a slow exchange-time / Kalshi round trip could push the actual
 * insert past the boundary, which silently retargeted the run one candle
 * ahead and dropped a candle entirely.
 */
export const BTC_15M_PREDICTION_LEAD_MS = 40 * 1000;

export type Btc15mTiming = {
  serverNowMs: number;
  nextCloseMs: number;
  nextPredictionMs: number;
  timeSource: "coinbase" | "okx" | "local";
  closeSource: "kalshi" | "coinbase_boundary";
  kalshiTicker: string | null;
};


async function fetchCoinbaseTime() {
  const t0 = Date.now();
  const r = await fetch("https://api.exchange.coinbase.com/time", {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const t1 = Date.now();
  if (!r.ok) throw new Error(`Coinbase time ${r.status}`);
  const json = (await r.json()) as { iso?: string; epoch?: number };
  const serverMs = Number.isFinite(json.epoch)
    ? Number(json.epoch) * 1000
    : new Date(json.iso ?? "").getTime();
  if (!Number.isFinite(serverMs)) throw new Error("Coinbase time invalid");
  return { serverMs, rttMs: t1 - t0 };
}

async function fetchOkxTime() {
  const t0 = Date.now();
  const r = await fetch("https://www.okx.com/api/v5/public/time", {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const t1 = Date.now();
  if (!r.ok) throw new Error(`OKX time ${r.status}`);
  const json = (await r.json()) as { data?: Array<{ ts?: string }> };
  const serverMs = Number(json.data?.[0]?.ts);
  if (!Number.isFinite(serverMs)) throw new Error("OKX time invalid");
  return { serverMs, rttMs: t1 - t0 };
}


async function fetchKalshiCloseTime(nextCloseMs: number) {
  const candleStartIso = new Date(nextCloseMs - BTC_15M_TF_MS).toISOString();
  const ticker = buildKalshiEventTicker(candleStartIso);
  const r = await fetch(`https://api.elections.kalshi.com/trade-api/v2/events/${ticker}`, {
    cache: "no-store",
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; BTC15mDashboard/1.0)" },
  });
  if (!r.ok) throw new Error(`Kalshi event ${r.status}`);
  const json = (await r.json()) as { markets?: Array<{ close_time?: string }> };
  const closeMs = new Date(json.markets?.[0]?.close_time ?? "").getTime();
  if (!Number.isFinite(closeMs)) throw new Error("Kalshi close_time invalid");
  return { closeMs, ticker };
}

export async function getBtc15mExchangeTiming(): Promise<Btc15mTiming> {
  let serverNowMs = Date.now();
  let timeSource: Btc15mTiming["timeSource"] = "local";
  try {
    const cb = await fetchCoinbaseTime();
    serverNowMs = cb.serverMs + cb.rttMs / 2;
    timeSource = "coinbase";
  } catch (cbErr) {
    try {
      const okx = await fetchOkxTime();
      serverNowMs = okx.serverMs + okx.rttMs / 2;
      timeSource = "okx";
    } catch {
      console.warn("timing: falling back to local Date.now()", cbErr);
    }
  }

  const utcNextCloseMs = Math.floor(serverNowMs / BTC_15M_TF_MS) * BTC_15M_TF_MS + BTC_15M_TF_MS;
  // The canonical prediction target is always the next UTC 15-minute candle
  // boundary. Kalshi metadata is audit-only: its market close timestamp has
  // occasionally described the following settlement boundary, which shifted
  // the target one full candle ahead and left downstream models waiting until
  // the server request timed out.
  const nextCloseMs = utcNextCloseMs;
  let kalshiTicker: string | null = null;
  let closeSource: Btc15mTiming["closeSource"] = "coinbase_boundary";

  try {
    const kalshi = await fetchKalshiCloseTime(utcNextCloseMs);
    kalshiTicker = kalshi.ticker;
    // Only label Kalshi as the corroborating source when it agrees with the
    // canonical boundary. It must never move the target timestamp.
    if (Math.abs(kalshi.closeMs - utcNextCloseMs) < 1_000) {
      closeSource = "kalshi";
    }
  } catch {
    // Exchange time still anchors the 15m UTC candle boundary.
  }

  return {
    serverNowMs,
    nextCloseMs,
    nextPredictionMs: nextCloseMs - BTC_15M_PREDICTION_LEAD_MS,
    timeSource,
    closeSource,
    kalshiTicker,
  };
}


export async function waitForBtc15mPredictionWindow(maxWaitMs = 70_000) {
  const timing = await getBtc15mExchangeTiming();
  const waitMs = Math.ceil(timing.nextPredictionMs - timing.serverNowMs);
  if (waitMs > 0 && waitMs <= maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return getBtc15mExchangeTiming();
  }
  return timing;
}