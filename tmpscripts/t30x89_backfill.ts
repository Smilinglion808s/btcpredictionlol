// T30 Cross89 Balanced R1 — historical source backfill.
//
// Streams Binance Global Spot BTCUSDT 1s daily archives (offsets 0..29 of each
// 15-minute UTC candle), joins the prior-completed Binance Spot 15m and
// Binance USD-M perpetual 15m technical blocks, labels with confirmed OKX
// 15m candles, and writes t30_cross89_features.
//
// Usage: bun tmpscripts/t30x89_backfill.ts <startDate> <endDate>

import { createClient } from "@supabase/supabase-js";
import {
  T30X_DIAGNOSTIC_FEATURES,
  T30X_FEATURE_ORDER,
  T30X_FEATURE_ORDER_HASH,
  T30X_FEATURE_SCHEMA,
  TF_MS,
} from "@/lib/t30x89/config";
import {
  baseDirectionOf,
  buildCross89Features,
  buildPacketStats,
  type X89SecondBar,
} from "@/lib/t30x89/features";
import { TECH_MIN_HISTORY, techAt, type Tech15mCandle } from "@/lib/t30x89/technicals";
import { upsertX89Features } from "@/lib/t30x89/store.server";

const sb = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Binance moved kline timestamps to microseconds during 2025. */
function toMs(raw: string | number): number {
  const n = Number(raw);
  return n > 1e14 ? Math.round(n / 1000) : n;
}

async function fetchSecondBars(day: string): Promise<Map<number, X89SecondBar[]> | null> {
  const url = `https://data.binance.vision/data/spot/daily/klines/BTCUSDT/1s/BTCUSDT-1s-${day}.zip`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  const proc = Bun.spawnSync(["funzip"], { stdin: buf, stdout: "pipe" });
  const text = new TextDecoder().decode(proc.stdout);
  const byTarget = new Map<number, X89SecondBar[]>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("open_time")) continue;
    const c = line.split(",");
    const openMs = toMs(c[0]);
    if (!Number.isFinite(openMs)) continue;
    const target = Math.floor(openMs / TF_MS) * TF_MS;
    const offset = Math.round((openMs - target) / 1000);
    if (offset < 0 || offset > 29) continue;
    const list = byTarget.get(target) ?? [];
    list.push({
      offsetSeconds: offset,
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5]),
      quoteVolume: Number(c[7]),
      tradeCount: Number(c[8]),
      takerBuyQuoteVolume: Number(c[10]),
    });
    byTarget.set(target, list);
  }
  return byTarget;
}

/** 15m klines from Binance REST for either venue. */
async function fetch15m(
  base: "https://api.binance.com/api/v3" | "https://fapi.binance.com/fapi/v1",
  fromMs: number,
  toMsEnd: number,
): Promise<Tech15mCandle[]> {
  const out: Tech15mCandle[] = [];
  let start = fromMs;
  while (start <= toMsEnd) {
    const url = `${base}/klines?symbol=BTCUSDT&interval=15m&startTime=${start}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const rows = (await res.json()) as unknown[][];
    if (rows.length === 0) break;
    for (const r of rows) {
      out.push({
        openMs: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
        quoteVolume: Number(r[7]),
        tradeCount: Number(r[8]),
        takerBuyQuoteVolume: Number(r[10]),
      });
    }
    start = Number(rows[rows.length - 1][0]) + TF_MS;
    if (rows.length < 1000) break;
  }
  return out.filter((c, i, a) => i === 0 || c.openMs !== a[i - 1].openMs);
}

type OkxRow = { o: number; h: number; l: number; c: number };

/**
 * Confirmed OKX BTC-USDT 15m candles straight from the venue history endpoint.
 * The project's own `candles` table only covers the recent live period, while
 * the frozen research window starts 2025-12-01.
 */
async function fetchOkxLabels(fromMs: number, toMsEnd: number): Promise<Map<string, OkxRow>> {
  const out = new Map<string, OkxRow>();
  let after = toMsEnd + TF_MS;
  for (let guard = 0; guard < 5000; guard++) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=15m&limit=100&after=${after}`;
    const res = await fetch(url);
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const body = (await res.json()) as { code: string; data: string[][] };
    const rows = body.data ?? [];
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r[8] !== "1") continue;
      const ms = Number(r[0]);
      out.set(new Date(ms).toISOString(), {
        o: Number(r[1]),
        h: Number(r[2]),
        l: Number(r[3]),
        c: Number(r[4]),
      });
    }
    after = Number(rows[rows.length - 1][0]);
    if (after <= fromMs) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  return out;
}


async function main() {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) throw new Error("usage: t30x89_backfill.ts <start> <end>");

  const warmupMs = TECH_MIN_HISTORY * TF_MS * 1.5;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMsEnd = Date.parse(`${to}T23:59:59Z`);

  console.log("[x89] loading 15m series…");
  const [spot15, fut15, okx] = await Promise.all([
    fetch15m("https://api.binance.com/api/v3", fromMs - warmupMs, toMsEnd),
    fetch15m("https://fapi.binance.com/fapi/v1", fromMs - warmupMs, toMsEnd),
    fetchOkxLabels(fromMs, toMsEnd),
  ]);
  console.log(`[x89] spot15=${spot15.length} fut15=${fut15.length} okx=${okx.size}`);

  const spotIdx = new Map(spot15.map((c, i) => [c.openMs, i]));
  const futIdx = new Map(fut15.map((c, i) => [c.openMs, i]));

  let written = 0;
  let complete = 0;
  for (const day of days(from, to)) {
    const byTarget = await fetchSecondBars(day);
    if (!byTarget) {
      console.log(`[x89] ${day} archive unavailable`);
      continue;
    }
    const rows: Record<string, unknown>[] = [];
    for (let t = Date.parse(`${day}T00:00:00Z`); t < Date.parse(`${day}T00:00:00Z`) + 86400_000; t += TF_MS) {
      const ts = new Date(t).toISOString();
      const bars = byTarget.get(t) ?? [];
      const packet = buildPacketStats(bars);
      const direction = packet.complete ? baseDirectionOf(packet) : 0;

      // Prior completed 15m candle = the one that closed exactly at T.
      const priorMs = t - TF_MS;
      const si = spotIdx.get(priorMs);
      const fi = futIdx.get(priorMs);
      const spot = si == null ? null : techAt(spot15, si);
      const fut = fi == null ? null : techAt(fut15, fi);
      const prevSpot = si == null ? null : spot15[si - 1];
      const prevFut = fi == null ? null : fut15[fi - 1];
      const prevBasis =
        prevSpot && prevFut ? Math.log(prevFut.close / prevSpot.close) * 10_000 : NaN;

      let features: Record<string, number | null> = {};
      let vector: number[] | null = null;
      let invalid: string | null = null;
      if (packet.complete && direction !== 0 && spot && fut && Number.isFinite(prevBasis)) {
        const built = buildCross89Features({
          targetTs: ts,
          packet,
          direction,
          spot,
          fut,
          prevBasisBps: prevBasis,
        });
        features = built.values;
        vector = built.vector;
        invalid = built.invalidFeature;
      } else {
        invalid = !packet.complete
          ? (packet.invalidReason ?? "PACKET_INCOMPLETE")
          : direction === 0
            ? "DIRECTION_ZERO"
            : !spot
              ? "SPOT_TECH_NOT_READY"
              : "FUTURES_TECH_NOT_READY";
      }

      const subset: Record<string, unknown> = {};
      for (const k of [...T30X_FEATURE_ORDER, ...T30X_DIAGNOSTIC_FEATURES]) {
        const v = features[k];
        subset[k] = typeof v === "number" && Number.isFinite(v) ? v : null;
      }

      const okxRow = okx.get(ts);
      const okxDir = okxRow ? (okxRow.c > okxRow.o ? 1 : okxRow.c < okxRow.o ? -1 : 0) : null;
      const label =
        direction === 0 || okxDir == null || okxDir === 0 ? null : direction === okxDir ? 1 : 0;
      if (vector) complete++;

      rows.push({
        target_ts: ts,
        feature_version: T30X_FEATURE_SCHEMA,
        feature_order_hash: T30X_FEATURE_ORDER_HASH,
        seconds_present: bars.length,
        first_offset_s: bars.length ? Math.min(...bars.map((b) => b.offsetSeconds)) : null,
        last_offset_s: bars.length ? Math.max(...bars.map((b) => b.offsetSeconds)) : null,
        packet_ready: packet.complete,
        packet_reason: packet.complete ? null : (packet.invalidReason ?? "PACKET_INCOMPLETE"),
        base_direction: direction,
        spot_tech_ready: !!spot,
        fut_tech_ready: !!fut,
        feature_complete: vector != null,
        invalid_reason: invalid,
        features: subset,
        vector,
        okx_open: okxRow?.o ?? null,
        okx_high: okxRow?.h ?? null,
        okx_low: okxRow?.l ?? null,
        okx_close: okxRow?.c ?? null,
        okx_direction: okxDir,
        label,
        label_source: okxRow ? "OKX:BTC-USDT:15m:confirmed" : null,
        source: "BACKFILL",
      });
    }
    written += await upsertX89Features(sb as never, rows);
    console.log(`[x89] ${day} rows=${rows.length} total=${written} complete=${complete}`);
  }
  console.log(`[x89] done written=${written} complete=${complete}`);
}

void main();
