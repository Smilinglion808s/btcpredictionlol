import { buildKalshiEventTicker } from "./kalshi.server";

export const BTC_15M_TF_MS = 15 * 60 * 1000;
export const BTC_15M_PREDICTION_LEAD_MS = 20 * 1000;

export type Btc15mTiming = {
  serverNowMs: number;
  nextCloseMs: number;
  nextPredictionMs: number;
  timeSource: "coinbase";
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
  const coinbase = await fetchCoinbaseTime();
  const serverNowMs = coinbase.serverMs + coinbase.rttMs / 2;
  const utcNextCloseMs = Math.floor(serverNowMs / BTC_15M_TF_MS) * BTC_15M_TF_MS + BTC_15M_TF_MS;
  let nextCloseMs = utcNextCloseMs;
  let kalshiTicker: string | null = null;
  let closeSource: Btc15mTiming["closeSource"] = "coinbase_boundary";

  try {
    const kalshi = await fetchKalshiCloseTime(utcNextCloseMs);
    nextCloseMs = kalshi.closeMs;
    kalshiTicker = kalshi.ticker;
    closeSource = "kalshi";
  } catch {
    // Coinbase time still anchors the 15m UTC candle boundary.
  }

  return {
    serverNowMs,
    nextCloseMs,
    nextPredictionMs: nextCloseMs - BTC_15M_PREDICTION_LEAD_MS,
    timeSource: "coinbase",
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