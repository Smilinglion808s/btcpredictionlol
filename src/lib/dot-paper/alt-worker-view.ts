/** Pure, honest view derivation for the standalone alt worker. Green only with fresh, flag-free quotes. */
export const ALT_SYMBOLS = ["SOLUSDT", "DOGEUSDT"] as const;
export const QUOTE_STALE_MS = 10_000;
type Res<T> = { ok: true; data: T } | { ok: false; code: string };
type Num = number | null | undefined;
type Str = string | null | undefined;
export interface AltWorkerInput {
  health: Res<{ state?: Str; last_error?: Str; connects?: Num; failures?: Num; symbols?: Record<string, { quote_state?: Str }> }>;
  events: Res<{ symbols: Record<string, { quote?: { bid?: Str; ask?: Str; receipt_ms?: Num; flags?: string[] } }> }>;
  paper: Res<{
    starting_balance?: Str; cash?: Str; equity?: Str; used_margin?: Str; trade_count?: Num;
    positions: Array<Record<string, unknown> & { symbol: string }>;
    recent_trades: Array<Record<string, unknown>>;
    config: { strategy_enabled: boolean };
  }>;
}
export type Tone = "red" | "amber" | "mint";
export interface SymbolView { symbol: string; label: string; tone: Tone; bid: string | null; ask: string | null; quoteMs: number | null; ageMs: number | null }
export interface AltWorkerView {
  label: string; tone: Tone; note: string; lastError: string | null;
  connects: number | null; failures: number | null;
  symbols: SymbolView[];
  paper: null | { reason: string } | {
    starting: string | null; cash: string | null; equity: string | null; usedMargin: string | null;
    strategy: "ENABLED" | "DISABLED"; tradeCount: number | null;
    positions: Array<Record<string, unknown>>; trades: Array<Record<string, unknown>>;
  };
}

export function deriveAltWorkerView(input: AltWorkerInput | undefined, now: number): AltWorkerView {
  const unknownSym = (s: string): SymbolView => ({ symbol: s, label: "UNKNOWN", tone: "amber", bid: null, ask: null, quoteMs: null, ageMs: null });
  if (!input) return { label: "UNKNOWN", tone: "amber", note: "Awaiting collector data", lastError: null, connects: null, failures: null, symbols: ALT_SYMBOLS.map(unknownSym), paper: null };
  const h = input.health;
  const ev = input.events.ok ? input.events.data.symbols : undefined;
  const state = h.ok ? (h.data.state ?? null) : null;
  const symbols = ALT_SYMBOLS.map((s): SymbolView => {
    const q = ev?.[s]?.quote;
    const quoteMs = typeof q?.receipt_ms === "number" ? q.receipt_ms : null;
    const ageMs = quoteMs == null ? null : Math.max(0, now - quoteMs);
    const base = { ...unknownSym(s), bid: q?.bid ?? null, ask: q?.ask ?? null, quoteMs, ageMs };
    if (!h.ok) return { ...base, label: "UNREACHABLE", tone: "red" };
    const ws = h.data.symbols?.[s]?.quote_state;
    if (quoteMs == null || ws == null) return base;
    if (ws === "NO_DATA") return { ...base, label: "NO DATA" };
    if (ws !== "FRESH" || ageMs! > QUOTE_STALE_MS || (q?.flags?.length ?? 0) > 0) return { ...base, label: "STALE" };
    if (state !== "RUNNING") return base;
    return { ...base, label: "LIVE", tone: "mint" };
  });
  let label: string, tone: Tone, note: string;
  if (!h.ok) { label = "UNREACHABLE"; tone = "red"; note = "Alt paper worker not reachable — not live"; }
  else if (state === "RUNNING" && symbols.every((s) => s.label === "LIVE")) { label = "LIVE"; tone = "mint"; note = "Receiving fresh public quotes"; }
  else if (state === "BACKOFF") { label = "ERROR"; tone = "red"; note = "Reconnecting after a failure"; }
  else if (state === "STALE" || symbols.some((s) => s.label === "STALE")) { label = "STALE"; tone = "amber"; note = "No recent market events"; }
  else if (state === "CONNECTING" || state === "IDLE") { label = "CONNECTING"; tone = "amber"; note = "Connecting to public feed"; }
  else { label = "UNKNOWN"; tone = "amber"; note = "Collector state not confirmed"; }
  const p = input.paper;
  const paper: AltWorkerView["paper"] = p.ok
    ? {
        starting: p.data.starting_balance ?? null, cash: p.data.cash ?? null, equity: p.data.equity ?? null,
        usedMargin: p.data.used_margin ?? null, strategy: p.data.config.strategy_enabled ? "ENABLED" : "DISABLED",
        tradeCount: p.data.trade_count ?? null, positions: p.data.positions, trades: p.data.recent_trades.slice(0, 5),
      }
    : { reason: p.code === "INVALID" ? "Paper ledger response invalid" : "Paper ledger unavailable" };
  return {
    label, tone, note, symbols, paper,
    lastError: h.ok ? (h.data.last_error ?? null) : null,
    connects: h.ok ? (h.data.connects ?? null) : null,
    failures: h.ok ? (h.data.failures ?? null) : null,
  };
}
