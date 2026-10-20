// V3 PF-E008 dashboard feed. Status only, no secrets.
// Record = predictions (not bets): each SELECTED/EXPIRED_UNSENT call graded only
// against the official finalized Kalshi KXBTC15M outcome (cached server-side in
// v3_kalshi_settlements); unresolved stays pending. "Today" = Boise calendar day.
import { createServerFn } from "@tanstack/react-start";

const boiseDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Boise" }).format(new Date(ms));

export const getV3Live = createServerFn({ method: "POST" }).handler(async () => {
  // Shared 60s server cache: many viewers collapse into one database read.
  const { cachedStats } = await import("./statsCache.server");
  return cachedStats("v3-live", async () => {
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
  const K = await import("./v3/kalshi-grade");
  const { supabaseGradeDeps } = await import("./v3/kalshi-cache.server");
  const opens = picks.map((r) => Date.parse(r.candle_open));
  const graded = await K.refreshAndResolve(opens, Date.now(), supabaseGradeDeps(sb));
  const outcomeOf = (t: number) => graded.outcomes.get(t) ?? null;
  const today = boiseDay(Date.now());
  const tally = () => ({ calls: 0, wins: 0, losses: 0, pending: 0 });
  const tot = tally(), day = tally();
  const byDay = new Map<string, ReturnType<typeof tally>>();
  const streak: ("W" | "L")[] = [];
  for (const p of picks) {
    const t = Date.parse(p.candle_open);
    const res = K.gradeV3(p.direction, outcomeOf(t));
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
  const rate = (b: ReturnType<typeof tally>) => (b.wins + b.losses ? b.wins / (b.wins + b.losses) : null);
  const dayIntervals = rows.filter((r) => boiseDay(Date.parse(r.candle_open)) === today).length;
  return {
    serverNow: Date.now(),
    runtime: (rt.data ?? [])[0] ?? null,
    decisions: (recent.data ?? []) as any[],
    record: graded.unavailable ? null : {
      total: { ...tot, winRate: rate(tot), net: tot.wins - tot.losses },
      today: { ...day, winRate: rate(day), net: day.wins - day.losses },
      coverage: rows.length ? picks.length / rows.length : null,
      intervals: rows.length,
      dayIntervals,
      streak,
      daily: [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([d, b]) => ({ day: d, ...b, net: b.wins - b.losses, winRate: rate(b) })),
    },
    error: rt.error || recent.error || all.error ? "READ_FAILED" : graded.unavailable ? "GRADING_UNAVAILABLE" : null,
  };
}, 60_000);
});
