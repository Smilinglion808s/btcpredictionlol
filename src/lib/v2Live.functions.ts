// V2 Final R1 dashboard status. Read-only; public like the other tile feeds
// (see the access note in v12Live.functions.ts). Status only — no secrets.
import { createServerFn } from "@tanstack/react-start";
import { sanitizeStatus } from "./v2/contract";

export const getV2Live = createServerFn({ method: "POST" }).handler(async () => {
  const { serviceClient } = await import("./c85/ops.server");
  const sb = serviceClient();
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  const [rt, cps, intents] = await Promise.all([
    sb.from("v2_worker_runtime").select("worker_id,status,updated_at").order("updated_at", { ascending: false }).limit(3),
    sb.from("v2_checkpoints")
      .select("candle_open,checkpoint,sleeve,side,probability,eligible,features_ready,reason,decision_at,received_at,receipt_latency_ms,sleeve_name:payload->>sleeve_name")
      .gte("candle_open", since).order("received_at", { ascending: false }).limit(60),
    sb.from("v2_candle_intents").select("candle_open,sleeve,side,execution,created_at")
      .gte("candle_open", since).order("candle_open", { ascending: false }).limit(24),
  ]);
  const record = await buildRecord(sb).catch(() => null);
  return {
    serverNow: Date.now(),
    runtime: (rt.data ?? []).map((r: any) => ({ worker_id: r.worker_id, updated_at: r.updated_at, status: sanitizeStatus(r.status) as Record<string, any> })),
    checkpoints: (cps.data ?? []) as any[],
    intents: (intents.data ?? []) as any[],
    record,
    error: rt.error || cps.error || intents.error ? "READ_FAILED" : null,
  };
});

// Prediction record (not bets): each chosen call graded against the stored
// 15-minute candle (close vs open). Coverage = intervals with a chosen call /
// intervals the worker recorded. "Today" is the Boise calendar day.
const boiseDay = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Boise" }).format(new Date(ms));

async function buildRecord(sb: any) {
  const [ints, cps] = await Promise.all([
    sb.from("v2_candle_intents").select("candle_open,side").order("candle_open", { ascending: false }).limit(5000),
    sb.from("v2_checkpoints").select("candle_open").eq("checkpoint", "T8").order("candle_open", { ascending: false }).limit(10000),
  ]);
  if (ints.error || cps.error) return null;
  const intents: { candle_open: string; side: number }[] = ints.data ?? [];
  const intervals = new Set<number>((cps.data ?? []).map((c: any) => Date.parse(c.candle_open)));
  const opens = intents.map((i) => new Date(i.candle_open).toISOString());
  const candles = new Map<number, { open: number; close: number }>();
  for (let k = 0; k < opens.length; k += 200) {
    const { data } = await sb.from("candles").select("candle_ts,open,close")
      .eq("timeframe", "15m").eq("confirm", true).in("candle_ts", opens.slice(k, k + 200));
    for (const c of data ?? []) {
      const t = Date.parse(c.candle_ts);
      if (!candles.has(t)) candles.set(t, { open: Number(c.open), close: Number(c.close) });
    }
  }
  const today = boiseDay(Date.now());
  const tally = () => ({ calls: 0, wins: 0, losses: 0, pending: 0 });
  const all = tally(), day = tally();
  let dayIntervals = 0;
  for (const t of intervals) if (boiseDay(t) === today) dayIntervals++;
  for (const i of intents) {
    const t = Date.parse(i.candle_open);
    const buckets = boiseDay(t) === today ? [all, day] : [all];
    const c = candles.get(t);
    for (const b of buckets) {
      b.calls++;
      if (!c) b.pending++;
      else if (c.close === c.open) continue;
      else if ((c.close > c.open ? 1 : -1) === i.side) b.wins++;
      else b.losses++;
    }
  }
  const rate = (b: ReturnType<typeof tally>) => (b.wins + b.losses ? b.wins / (b.wins + b.losses) : null);
  return {
    total: { ...all, winRate: rate(all), net: all.wins - all.losses },
    today: { ...day, winRate: rate(day), net: day.wins - day.losses },
    coverage: intervals.size ? all.calls / intervals.size : null,
    intervals: intervals.size,
    dayIntervals,
  };
}
