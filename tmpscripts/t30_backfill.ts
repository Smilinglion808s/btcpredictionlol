// T30 PriceFlow Balanced — historical feature backfill.
//
// Streams Binance Global Spot BTCUSDT 1s daily archives, keeps offsets 0..29 of
// every 15-minute UTC candle, builds the frozen T30 feature vector and writes
// t30_features. Labels come from confirmed OKX 15m candles where available and
// from Binance spot 15m klines as a surrogate before OKX coverage begins.
//
// Usage: bun tmpscripts/t30_backfill.ts <startDate> <endDate>

import { createClient } from "@supabase/supabase-js";
import { buildT30Features, type T30SecondBar } from "@/lib/t30/features";
import {
  T30_DIAGNOSTIC_FEATURES,
  T30_FEATURE_ORDER,
  T30_FEATURE_ORDER_HASH,
  T30_FEATURE_SCHEMA,
} from "@/lib/t30/config";
import { upsertT30FeatureBatch } from "@/lib/t30/store.server";

const TF_MS = 15 * 60 * 1000;
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Binance moved kline timestamps to microseconds during 2025. */
function toMs(raw: string): number {
  const n = Number(raw);
  return n > 1e14 ? Math.round(n / 1000) : n;
}

async function fetchDay(day: string): Promise<Map<number, T30SecondBar[]> | null> {
  const url = `https://data.binance.vision/data/spot/daily/klines/BTCUSDT/1s/BTCUSDT-1s-${day}.zip`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  const proc = Bun.spawnSync(["funzip"], { stdin: buf, stdout: "pipe" });
  const text = new TextDecoder().decode(proc.stdout);
  const byTarget = new Map<number, T30SecondBar[]>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("open_time")) continue;
    const c = line.split(",");
    const openMs = toMs(c[0]);
    if (!Number.isFinite(openMs)) continue;
    const target = Math.floor(openMs / TF_MS) * TF_MS;
    const offset = Math.round((openMs - target) / 1000);
    if (offset < 0 || offset > 29) continue;
    const bar: T30SecondBar = {
      offsetSeconds: offset,
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5]),
      quoteVolume: Number(c[7]),
      tradeCount: Number(c[8]),
      takerBuyQuoteVolume: Number(c[10]),
    };
    const list = byTarget.get(target) ?? [];
    list.push(bar);
    byTarget.set(target, list);
  }
  return byTarget;
}

/** Binance spot 15m surrogate labels; OKX confirmed rows override them later. */
async function fetchBinanceLabels(fromMs: number, toMs_: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let start = fromMs; start <= toMs_; start += 1000 * TF_MS) {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&startTime=${start}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const rows = (await res.json()) as unknown[][];
    for (const r of rows) {
      const ts = new Date(Number(r[0])).toISOString();
      const o = Number(r[1]);
      const c = Number(r[4]);
      out.set(ts, c > o ? 1 : c < o ? -1 : 0);
    }
    if (rows.length < 1000) break;
  }
  return out;
}

async function fetchOkxLabels(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from("candles")
      .select("candle_ts, open, close")
      .eq("symbol", "BTC-USDT")
      .eq("timeframe", "15m")
      .eq("confirm", true)
      .order("candle_ts", { ascending: true })
      .range(off, off + 999);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      const o = Number(r.open);
      const c = Number(r.close);
      out.set(new Date(String(r.candle_ts)).toISOString(), c > o ? 1 : c < o ? -1 : 0);
    }
    if (rows.length < 1000) break;
  }
  return out;
}

async function main() {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) throw new Error("usage: t30_backfill.ts <start> <end>");

  console.log("[t30] loading labels…");
  const okx = await fetchOkxLabels();
  const binance = await fetchBinanceLabels(
    Date.parse(`${from}T00:00:00Z`),
    Date.parse(`${to}T23:59:59Z`),
  );
  console.log(`[t30] labels: okx=${okx.size} binance=${binance.size}`);

  let written = 0;
  let complete = 0;
  for (const day of days(from, to)) {
    const byTarget = await fetchDay(day);
    if (!byTarget) {
      console.log(`[t30] ${day} unavailable`);
      continue;
    }
    const rows: Record<string, unknown>[] = [];
    for (const [target, bars] of [...byTarget.entries()].sort((a, b) => a[0] - b[0])) {
      const ts = new Date(target).toISOString();
      const built = buildT30Features(bars);
      const subset: Record<string, unknown> = {};
      for (const k of [...T30_FEATURE_ORDER, ...T30_DIAGNOSTIC_FEATURES]) {
        const v = built.values[k];
        subset[k] = typeof v === "number" && Number.isFinite(v) ? v : null;
      }
      const label = okx.get(ts) ?? binance.get(ts) ?? null;
      if (built.featureComplete) complete++;
      rows.push({
        target_ts: ts,
        feature_version: T30_FEATURE_SCHEMA,
        feature_order_hash: T30_FEATURE_ORDER_HASH,
        seconds_present: built.secondsPresent,
        first_offset_s: built.values.t30_first_offset_s ?? null,
        last_offset_s: built.values.t30_last_offset_s ?? null,
        spot_complete: built.spotComplete,
        feature_complete: built.featureComplete,
        invalid_reason: built.invalidReason,
        features: subset,
        vector: built.vector,
        label,
        label_source: okx.has(ts) ? "OKX:BTC-USDT:15m:confirmed" : "BINANCE_SPOT_SURROGATE",
        source: "BACKFILL",
      });
    }
    written += await upsertT30FeatureBatch(sb as never, rows);
    console.log(`[t30] ${day} rows=${rows.length} total=${written} complete=${complete}`);
  }
  console.log(`[t30] done written=${written} complete=${complete}`);
}

void main();
