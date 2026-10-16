// Canonical read-only Solana paper-trade contract. No feed is connected yet.
export const SOLANA_PAPER_SCHEMA_VERSION = "solana-paper/1" as const;

export type EvidenceKind = "offline_synthetic" | "observed_estimated_paper" | "observed_protocol_paper";
export type FeedStatus = "not_started" | "running" | "stopped" | "degraded";
export type PricingMode = "estimated_market_snapshot" | "protocol_quote" | "unavailable";
export type MarkStatus = "fresh" | "stale" | "missing";
export type PositionStatus = "open" | "closed" | "unresolved";

/** Integer amounts are decimal strings (lamports / raw token units). */
export type SolanaPaperValuation = {
  pricing_mode: PricingMode;
  mark_status: MarkStatus;
  observed_at: string | null;
  received_at: string | null;
  source: string | null;
  provider: string | null;
  price_basis: string | null;
  liquidity_value: string | null;
  liquidity_currency: string | null;
  market_cap: string | null;
  fee_assumption_bps: number | null;
  slippage_assumption_bps: number | null;
  execution_model_version: string | null;
  /** Lamports received after ALL modeled exit costs (fees, slippage). Used when pricing_mode = estimated_market_snapshot. */
  estimated_liquidation_net_lamports: string | null;
  /** Net after exit costs from a validated full-size quote. Used only when pricing_mode = protocol_quote. */
  full_size_liquidation_net_lamports: string | null;
  unresolved_reason: string | null;
};

export type SolanaPaperTrade = {
  position_id: string;
  source_wallet: string;
  mint: string;
  symbol: string | null;
  name: string | null;
  /** All-in simulated entry cost in lamports, INCLUDING entry fees and slippage, EXCLUDING refundable locked rent. */
  entry_input_lamports: string;
  acquired_tokens_raw: string | null;
  decimals: number | null;
  entry_at: string;
  exit_at: string | null;
  position_status: PositionStatus;
  /** Informational only; already included in entry_input_lamports / liquidation nets. Never subtract again. */
  fees_lamports: string | null;
  /** Refundable rent; not part of entry cost or PnL. */
  locked_rent_lamports: string | null;
  /** Closed positions: final net paper PnL after all modeled costs; never the source wallet's PnL; does not expire. */
  realized_net_pnl_lamports: string | null;
  valuation: SolanaPaperValuation;
};

export type SolanaPaperFeed = {
  schema_version: typeof SOLANA_PAPER_SCHEMA_VERSION;
  run_id: string | null;
  evidence_kind: EvidenceKind;
  status: FeedStatus;
  data_as_of: string | null;
  start_utc: string | null;
  end_utc: string | null;
  heartbeat_utc: string | null;
  coverage: { expected_intervals: number | null; observed_intervals: number | null; gap_count: number | null; largest_gap_seconds: number | null; summary: string | null };
  trades: SolanaPaperTrade[];
};

export type SolanaPaperLoad = { state: "not_started" } | { state: "error"; message: string } | { state: "ready"; feed: SolanaPaperFeed };

/** Seam for a future read-only feed. Nothing is deployed, so this reports not started. */
export async function loadSolanaPaperFeed(): Promise<SolanaPaperLoad> {
  return { state: "not_started" };
}

export const MAX_MARK_AGE_MS = 60_000;
export const MAX_RAW_DIGITS = 60;

// ---------- display helpers (contract values stay raw) ----------
const INT = /^-?\d{1,60}$/;
export const walletTail = (w: string | null | undefined) => (w && w.length >= 4 ? `…${w.slice(-4)}` : "—");
/** Stable React key: full identity, never the displayed suffix. */
export const tradeKey = (t: SolanaPaperTrade) => `${t.position_id}:${t.source_wallet}:${t.mint}`;

export function rawToDecimal(raw: string | null | undefined, decimals: number | null | undefined, maxFrac: number, sign = false): string {
  if (raw == null || !INT.test(raw) || decimals == null || !Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !Number.isInteger(maxFrac) || maxFrac < 0 || maxFrac > 9) return "—";
  let n = BigInt(raw);
  const neg = n < 0n;
  if (neg) n = -n;
  const base = 10n ** BigInt(decimals);
  let whole = n / base;
  let frac = (n % base).toString().padStart(decimals, "0");
  if (maxFrac === 0) { if (Number(frac[0] ?? "0") >= 5) whole += 1n; frac = ""; }
  else if (frac.length > maxFrac) {
    const keep = BigInt(frac.slice(0, maxFrac) || "0") + (Number(frac[maxFrac]) >= 5 ? 1n : 0n);
    let k = keep.toString().padStart(maxFrac, "0");
    if (k.length > maxFrac) { whole += 1n; k = k.slice(1); }
    frac = k;
  }
  frac = frac.replace(/0+$/, "");
  const tiny = n > 0n && whole === 0n && frac === "";
  const body = tiny ? (maxFrac === 0 ? "<1" : `<0.${"0".repeat(maxFrac - 1)}1`) : `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? "." + frac : ""}`;
  const prefix = neg ? "−" : sign && n > 0n ? "+" : "";
  return prefix + body;
}
export const lamportsToSol = (v: string | null | undefined, sign = false) => rawToDecimal(v, 9, 4, sign);

export function toneOf(v: string | null | undefined) {
  if (v == null || !INT.test(v)) return "text-muted-foreground";
  const n = BigInt(v);
  return n > 0n ? "text-bull" : n < 0n ? "text-bear" : "";
}

export function ageLabel(iso: string | null, nowMs: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
}

export type PnlView = { label: string; lamports: string | null; pctText: string; note: string; mark: MarkStatus | "unavailable" };

/** Effective mark status: fresh only if declared fresh AND observed_at valid, not future, within MAX_MARK_AGE_MS. */
export function effectiveMark(t: SolanaPaperTrade, nowMs: number): MarkStatus | "unavailable" {
  const v = t.valuation;
  if (v.pricing_mode === "unavailable") return "unavailable";
  if (v.mark_status !== "fresh") return v.mark_status;
  const ts = v.observed_at ? Date.parse(v.observed_at) : NaN;
  if (!Number.isFinite(ts) || ts > nowMs + 2_000) return "missing";
  return nowMs - ts > MAX_MARK_AGE_MS ? "stale" : "fresh";
}

function pct(net: string, entry: string) {
  if (!INT.test(entry) || BigInt(entry) <= 0n) return "—";
  const bp = (BigInt(net) * 10000n) / BigInt(entry);
  const a = bp < 0n ? -bp : bp;
  return `${bp > 0n ? "+" : bp < 0n ? "−" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}%`;
}

/** Only PnL we may show. Open: liquidation net (per declared pricing_mode) − all-in entry; stale/missing/future marks yield none. */
export function pnlView(t: SolanaPaperTrade, nowMs: number): PnlView {
  const v = t.valuation;
  const protocol = v.pricing_mode === "protocol_quote";
  if (t.position_status === "closed") {
    const r = t.realized_net_pnl_lamports;
    const label = protocol ? "Paper PnL (realized)" : "Estimated paper PnL (realized)";
    if (r == null || !INT.test(r)) return { label, lamports: null, pctText: "—", note: "Result unavailable", mark: "missing" };
    return { label, lamports: r, pctText: pct(r, t.entry_input_lamports), note: protocol ? "Protocol quote" : "Modeled fills and costs", mark: "fresh" };
  }
  const mark = effectiveMark(t, nowMs);
  const label = protocol ? "Paper PnL (full-size quote)" : "Estimated paper PnL";
  const none = (note: string): PnlView => ({ label, lamports: null, pctText: "—", note: v.unresolved_reason ?? note, mark });
  if (t.position_status !== "open") return none("Unresolved");
  if (mark !== "fresh") return none(mark === "stale" ? "Valuation stale" : "Valuation unavailable");
  const exit = protocol ? v.full_size_liquidation_net_lamports : v.estimated_liquidation_net_lamports;
  if (exit == null || !INT.test(exit) || !INT.test(t.entry_input_lamports)) return none("Valuation unavailable");
  const net = (BigInt(exit) - BigInt(t.entry_input_lamports)).toString();
  return { label, lamports: net, pctText: pct(net, t.entry_input_lamports), note: protocol ? "Validated full-size quote" : "Modeled fills and costs", mark };
}
