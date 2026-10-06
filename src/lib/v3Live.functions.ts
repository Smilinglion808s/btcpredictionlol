// V3 PF-E008 dashboard feed. Read-only, status only, no secrets.
// Record = predictions (not bets): each SELECTED call graded against the confirmed
// 15-minute dashboard candle (close vs open). "Today" is the Boise calendar day.
import { createServerFn } from "@tanstack/react-start";

const boiseDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Boise" }).format(new Date(ms));

export const getV3Live = createServerFn({ method: "POST" }).handler(async () => {
  const { serviceClient } = await import("./c85/ops.server");
  const sb = serviceClient();
  const [rt, recent, all] = await Promise.all([
    sb.from("v3_worker_runtime").select("worker_id,status,updated_at").order("updated_at", { ascending: false }).limit(1),
    sb.from("v3_decisions").select("candle_open,status,reason,checkpoint,direction,rank,t15_rank,t30_rank,decision_at,delivery")
      .order("candle_open", { ascending: false }).limit(24),
    sb.from("v3_decisions").select("candle_open,status,direction").order("candle_open", { ascending: false }).limit(10000),
  ]);
  const rows = (all.data ?? []) as { candle_open: string; status: string; direction: number | null }[];
  const picks = rows.filter((r) => r.direction != null && (r.status === "SELECTED" || r.status === "EXPIRED_UNSENT"));
  const opens = picks.map((r) => new Date(r.candle_open).toISOString());
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
  const tot = tally(), day = tally();
  const byDay = new Map<string, ReturnType<typeof tally>>();
  const streak: ("W" | "L")[] = [];
  for (const p of picks) {
    const t = Date.parse(p.candle_open);
    const c = candles.get(t);
    const res = !c ? "P" : c.close === c.open ? "F" : (c.close > c.open ? 1 : -1) === p.direction ? "W" : "L";
    if ((res === "W" || res === "L") && streak.length < 20) streak.push(res);
    const dk = boiseDay(t);
    if (!byDay.has(dk)) byDay.set(dk, tally());
    for (const b of dk === today ? [tot, day, byDay.get(dk)!] : [tot, byDay.get(dk)!]) {
      b.calls++;
      if (res === "P") b.pending++;
      else if (res === "W") b.wins++;
      else if (res === "L") b.losses++;
    }
  }
  }
  const rate = (b: ReturnType<typeof tally>) => (b.wins + b.losses ? b.wins / (b.wins + b.losses) : null);
  const dayIntervals = rows.filter((r) => boiseDay(Date.parse(r.candle_open)) === today).length;
  return {
    serverNow: Date.now(),
    runtime: (rt.data ?? [])[0] ?? null,
    decisions: (recent.data ?? []) as any[],
    record: {
      total: { ...tot, winRate: rate(tot), net: tot.wins - tot.losses },
      today: { ...day, winRate: rate(day), net: day.wins - day.losses },
      coverage: rows.length ? picks.length / rows.length : null,
      intervals: rows.length,
      dayIntervals,
      streak,
    },
    error: rt.error || recent.error || all.error ? "READ_FAILED" : null,
  };
});
