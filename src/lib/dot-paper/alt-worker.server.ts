/** Read-only GET proxy to the standalone SOL/DOGE paper worker. Fixed origin + fixed paths only. */
import { z } from "zod";

const ORIGIN = "https://dot-alt-paper-worker-production.up.railway.app";
type R<T> = { ok: true; data: T } | { ok: false; code: "UNAVAILABLE" | "INVALID" };

const str = z.string().nullable().optional();
const num = z.number().nullable().optional();
export const altHealth = z.object({
  mode: str, state: str, last_event_ms: num, last_event_age_ms: num,
  connects: num, failures: num, last_error: str,
  symbols: z.record(z.object({ quote_state: str })).optional(),
});
const quote = z.object({ bid: str, ask: str, exchange_ms: num, receipt_ms: num, flags: z.array(z.string()).optional() });
export const altEvents = z.object({
  symbols: z.record(z.object({ quote: quote.optional() })),
});
const pos = z.object({ symbol: z.string(), side: str, qty: str, entry_price: str, mark: str, margin: str, unrealized_pnl: str });
export const altPaper = z.object({
  starting_balance: str, cash: str, equity: str, used_margin: str,
  positions: z.array(pos), trade_count: num,
  recent_trades: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(50),
  config: z.object({ strategy_enabled: z.boolean() }),
});

async function get<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<R<T>> {
  try {
    const res = await fetch(new URL(path, ORIGIN), {
      method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" }, cache: "no-store",
    });
    if (res.type === "opaqueredirect" || !res.ok) return { ok: false, code: "UNAVAILABLE" };
    const p = schema.safeParse(await res.json());
    return p.success ? { ok: true, data: p.data } : { ok: false, code: "INVALID" };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function readAltWorker() {
  const [health, events, paper] = await Promise.all([
    get("/health", altHealth), get("/events/latest", altEvents), get("/paper/status", altPaper),
  ]);
  return { health, events, paper };
}
export type AltWorkerRead = Awaited<ReturnType<typeof readAltWorker>>;
