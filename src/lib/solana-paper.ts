import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeaders } from "@tanstack/react-start/server";

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
  /** Receipt time is never a source-event timestamp. */
  quote_received_at?: string | null;
  source_event_age_known?: boolean;
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
  coverage: {
    expected_intervals: number | null;
    observed_intervals: number | null;
    gap_count: number | null;
    largest_gap_seconds: number | null;
    summary: string | null;
  };
  trades: SolanaPaperTrade[];
  upstream_age_unknown?: boolean;
  policy_version?: string;
  policy_hash?: string;
  quote_receipt_max_age_ms?: number | null;
  /** Legacy optional balance projection is ignored by this copy-only view. */
  account?: unknown;
  /** Optional read-only trader roster; validated separately. */
  wallets?: unknown;
  accounting_mode?: string;
  entry_notional_lamports?: string;
  /** Authoritative copy results, including costs not represented by position rows. */
  trader_pnl?: unknown;
};

export type SolanaPaperLoad =
  | { state: "not_started"; reason?: string }
  | { state: "error"; message: string }
  | { state: "ready"; feed: SolanaPaperFeed; fetchedAt: number };
export type SolanaPaperLoader = (signal?: AbortSignal) => Promise<SolanaPaperLoad>;

/** Deliberately unset. Only a separately reviewed connection may enable transport. */
export const SOLANA_PAPER_FEED_URL: string | null = null;
/** Future same-origin API route, NOT this HTML page's /solana-paper path. */
export const FUTURE_FEED_PATH = "/api/public/solana-paper";
export const MAX_SILENCE_MS = 15_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const UNKNOWN_UPSTREAM_POLICY_VERSION = "solscan-jupiter-observed-only-v1";
export const MAX_QUOTE_RECEIPT_AGE_MS = 1_000;
export const FIXED_COPY_ACCOUNTING_MODE = "fixed_notional_copy_pnl_v1";
export const COPY_ENTRY_NOTIONAL_LAMPORTS = "1000000000";

/** Seam for a future read-only feed. Nothing is deployed, so this reports not started. */
export async function loadSolanaPaperFeed(_signal?: AbortSignal): Promise<SolanaPaperLoad> {
  return { state: "not_started" };
}

export const MAX_MARK_AGE_MS = 60_000;
export const MAX_RAW_DIGITS = 60;

// ---------- display helpers (contract values stay raw) ----------
const INT = /^-?\d{1,60}$/;
export const walletTail = (w: string | null | undefined) => (w && w.length >= 4 ? `…${w.slice(-4)}` : "—");
/** Stable React key: full identity, never the displayed suffix. */
export const tradeKey = (t: SolanaPaperTrade) => `${t.position_id}:${t.source_wallet}:${t.mint}`;

export function rawToDecimal(
  raw: string | null | undefined,
  decimals: number | null | undefined,
  maxFrac: number,
  sign = false,
): string {
  if (
    raw == null ||
    !INT.test(raw) ||
    decimals == null ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    !Number.isInteger(maxFrac) ||
    maxFrac < 0 ||
    maxFrac > 9
  )
    return "—";
  let n = BigInt(raw);
  const neg = n < 0n;
  if (neg) n = -n;
  const base = 10n ** BigInt(decimals);
  let whole = n / base;
  let frac = (n % base).toString().padStart(decimals, "0");
  if (maxFrac === 0) {
    if (Number(frac[0] ?? "0") >= 5) whole += 1n;
    frac = "";
  } else if (frac.length > maxFrac) {
    const keep = BigInt(frac.slice(0, maxFrac) || "0") + (Number(frac[maxFrac]) >= 5 ? 1n : 0n);
    let k = keep.toString().padStart(maxFrac, "0");
    if (k.length > maxFrac) {
      whole += 1n;
      k = k.slice(1);
    }
    frac = k;
  }
  frac = frac.replace(/0+$/, "");
  const tiny = n > 0n && whole === 0n && frac === "";
  const body = tiny
    ? maxFrac === 0
      ? "<1"
      : `<0.${"0".repeat(maxFrac - 1)}1`
    : `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? "." + frac : ""}`;
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

export type PnlView = {
  label: string;
  lamports: string | null;
  pctText: string;
  note: string;
  mark: MarkStatus | "unavailable";
};

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
export function pnlView(t: SolanaPaperTrade, nowMs: number, load?: SolanaPaperLoad): PnlView {
  if (load !== undefined) {
    const protocol = t.valuation.pricing_mode === "protocol_quote";
    const closed = t.position_status === "closed";
    const result = tradePnl(t, load, nowMs);
    const label = closed
      ? protocol
        ? "Paper PnL (realized)"
        : "Estimated paper PnL (realized)"
      : protocol
        ? "Paper PnL (full-size quote)"
        : "Estimated paper PnL";
    const legacyMark = effectiveMark(t, nowMs);
    const mark =
      result.lamports !== null
        ? "fresh"
        : !transportFresh(load, nowMs) && !closed
          ? "stale"
          : legacyMark === "fresh"
            ? "missing"
            : legacyMark;
    return {
      label,
      lamports: result.lamports,
      pctText: result.lamports === null ? "—" : pct(result.lamports, t.entry_input_lamports),
      note: result.reason,
      mark,
    };
  }
  const v = t.valuation;
  const protocol = v.pricing_mode === "protocol_quote";
  if (t.position_status === "closed") {
    const r = t.realized_net_pnl_lamports;
    const label = protocol ? "Paper PnL (realized)" : "Estimated paper PnL (realized)";
    if (r == null || !INT.test(r))
      return { label, lamports: null, pctText: "—", note: "Result unavailable", mark: "missing" };
    return {
      label,
      lamports: r,
      pctText: pct(r, t.entry_input_lamports),
      note: protocol ? "Protocol quote" : "Modeled fills and costs",
      mark: "fresh",
    };
  }
  const mark = effectiveMark(t, nowMs);
  const label = protocol ? "Paper PnL (full-size quote)" : "Estimated paper PnL";
  const none = (note: string): PnlView => ({
    label,
    lamports: null,
    pctText: "—",
    note: v.unresolved_reason ?? note,
    mark,
  });
  if (t.position_status !== "open") return none("Unresolved");
  if (mark !== "fresh") return none(mark === "stale" ? "Valuation stale" : "Valuation unavailable");
  const exit = protocol ? v.full_size_liquidation_net_lamports : v.estimated_liquidation_net_lamports;
  if (exit == null || !INT.test(exit) || !INT.test(t.entry_input_lamports)) return none("Valuation unavailable");
  const net = (BigInt(exit) - BigInt(t.entry_input_lamports)).toString();
  return {
    label,
    lamports: net,
    pctText: pct(net, t.entry_input_lamports),
    note: protocol ? "Validated full-size quote" : "Modeled fills and costs",
    mark,
  };
}

// ---------- Strict observed-feed adapter (offline until explicitly configured) ----------
type UnknownObject = Record<string, unknown>;
const objectValue = (value: unknown): UnknownObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("object");
  return value as UnknownObject;
};
const textValue = (value: unknown, nullable = false): void => {
  if (nullable && value === null) return;
  if (typeof value !== "string" || value.length > 4096) throw Error("string");
};
const stamp = (value: unknown, nullable = true): void => {
  if (nullable && value === null) return;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw Error("timestamp");
};
const RAW_UNSIGNED = /^(0|[1-9]\d{0,59})$/;
const RAW_SIGNED = /^-?(0|[1-9]\d{0,59})$/;
const raw = (value: unknown, nullable = true, signed = false): void => {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !(signed ? RAW_SIGNED : RAW_UNSIGNED).test(value)) throw Error("raw integer");
};
const count = (value: unknown, max = Number.MAX_SAFE_INTEGER): void => {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max))
    throw Error("count");
};
const one = (value: unknown, values: readonly unknown[]): void => {
  if (!values.includes(value)) throw Error("enum");
};
function validateTrade(value: unknown): void {
  const t = objectValue(value),
    v = objectValue(t.valuation);
  for (const k of ["position_id", "source_wallet", "mint"]) {
    textValue(t[k]);
    if (!t[k]) throw Error("identity");
  }
  for (const k of ["symbol", "name"]) textValue(t[k], true);
  raw(t.entry_input_lamports, false);
  raw(t.acquired_tokens_raw);
  raw(t.fees_lamports);
  raw(t.locked_rent_lamports);
  raw(t.realized_net_pnl_lamports, true, true);
  count(t.decimals, 18);
  stamp(t.entry_at, false);
  stamp(t.exit_at);
  one(t.position_status, ["open", "closed", "unresolved"]);
  one(v.pricing_mode, ["estimated_market_snapshot", "protocol_quote", "unavailable"]);
  one(v.mark_status, ["fresh", "stale", "missing"]);
  stamp(v.observed_at);
  stamp(v.received_at);
  for (const k of [
    "source",
    "provider",
    "price_basis",
    "liquidity_value",
    "liquidity_currency",
    "market_cap",
    "execution_model_version",
    "unresolved_reason",
  ])
    textValue(v[k], true);
  count(v.fee_assumption_bps, 10000);
  count(v.slippage_assumption_bps, 10000);
  raw(v.estimated_liquidation_net_lamports, true, true);
  raw(v.full_size_liquidation_net_lamports, true, true);
  if (v.quote_received_at !== undefined) stamp(v.quote_received_at);
  if (v.source_event_age_known !== undefined && typeof v.source_event_age_known !== "boolean")
    throw Error("source age flag");
}

/** Strict full-snapshot validation; synthetic/replay evidence never becomes observed results. */
export function parseFeed(value: unknown, fetchedAt: number): SolanaPaperLoad {
  try {
    const f = objectValue(value);
    if (
      f.status === "not_started" &&
      f.schema_version === undefined &&
      Object.keys(f).every((k) => ["status", "owner"].includes(k))
    )
      return { state: "not_started", reason: "No paper session has started." };
    if (!Number.isFinite(fetchedAt) || fetchedAt < 0) throw Error("fetch time");
    if (f.schema_version !== SOLANA_PAPER_SCHEMA_VERSION) throw Error("schema");
    one(f.evidence_kind, ["observed_estimated_paper", "observed_protocol_paper"]);
    one(f.status, ["not_started", "running", "stopped", "degraded"]);
    textValue(f.run_id, true);
    for (const k of ["data_as_of", "start_utc", "end_utc", "heartbeat_utc"]) stamp(f[k]);
    if (f.upstream_age_unknown !== undefined && typeof f.upstream_age_unknown !== "boolean")
      throw Error("upstream flag");
    for (const k of ["policy_version", "policy_hash"])
      if (f[k] !== undefined) {
        textValue(f[k]);
        if (!(f[k] as string).trim()) throw Error("policy");
      }
    // A hash is retained as exported identity, not represented as independently verified.
    if (f.upstream_age_unknown === true && (f.policy_version !== UNKNOWN_UPSTREAM_POLICY_VERSION || !f.policy_hash))
      throw Error("policy");
    if (f.quote_receipt_max_age_ms !== undefined) count(f.quote_receipt_max_age_ms, MAX_QUOTE_RECEIPT_AGE_MS);
    if (f.accounting_mode !== undefined) {
      if (
        f.accounting_mode !== FIXED_COPY_ACCOUNTING_MODE ||
        f.entry_notional_lamports !== COPY_ENTRY_NOTIONAL_LAMPORTS ||
        f.account !== null
      )
        throw Error("copy accounting contract");
      validateTraderPnl(f.trader_pnl);
    }
    const c = objectValue(f.coverage);
    for (const k of ["expected_intervals", "observed_intervals", "gap_count", "largest_gap_seconds"]) count(c[k]);
    textValue(c.summary, true);
    if (!Array.isArray(f.trades) || f.trades.length > 10000) throw Error("trades");
    f.trades.forEach(validateTrade);
    if (new Set(f.trades.map((t) => objectValue(t).position_id)).size !== f.trades.length)
      throw Error("duplicate identity");
    return { state: "ready", feed: f as unknown as SolanaPaperFeed, fetchedAt };
  } catch {
    return { state: "error", message: "Feed unavailable: contract or observed-evidence validation failed." };
  }
}

/** Exact raw-unit formatting. No Number conversion, rounding, or truncation. */
export function tokenQuantity(t: Pick<SolanaPaperTrade, "acquired_tokens_raw" | "decimals">): string {
  const value = t.acquired_tokens_raw;
  if (value === null || typeof value !== "string" || !RAW_UNSIGNED.test(value)) return "Unavailable";
  if (t.decimals === null) return `${value} raw units (decimals unknown)`;
  if (!Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 18) return "Unavailable";
  const digits = value.padStart(t.decimals + 1, "0");
  const fraction = t.decimals ? digits.slice(-t.decimals).replace(/0+$/, "") : "";
  return (t.decimals ? digits.slice(0, -t.decimals) : digits) + (fraction ? "." + fraction : "");
}
export function ageMs(timestamp: string | null | undefined, now: number): number | null {
  const n = timestamp ? now - Date.parse(timestamp) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function transportFresh(load: SolanaPaperLoad | null | undefined, now: number): boolean {
  return (
    load?.state === "ready" &&
    Number.isFinite(load.fetchedAt) &&
    now >= load.fetchedAt &&
    now - load.fetchedAt <= MAX_SILENCE_MS
  );
}
export type TradePnl = { lamports: string | null; reason: string };
export function tradePnl(t: SolanaPaperTrade, load: SolanaPaperLoad, now: number): TradePnl {
  // All-in entry already includes fees; refundable rent is not a PnL expense.
  if (t.position_status === "closed")
    return {
      lamports:
        t.realized_net_pnl_lamports !== null && RAW_SIGNED.test(t.realized_net_pnl_lamports)
          ? t.realized_net_pnl_lamports
          : null,
      reason: "Historical realized result",
    };
  if (load.state !== "ready" || !transportFresh(load, now))
    return { lamports: null, reason: "Feed refresh overdue or unavailable" };
  const v = t.valuation,
    f = load.feed;
  if (t.position_status !== "open" || v.unresolved_reason || v.mark_status !== "fresh")
    return { lamports: null, reason: v.unresolved_reason || v.mark_status };
  const sourceAgeUnknown = f.upstream_age_unknown === true || v.source_event_age_known === false;
  if (sourceAgeUnknown) {
    if (
      f.policy_version !== UNKNOWN_UPSTREAM_POLICY_VERSION ||
      typeof f.policy_hash !== "string" ||
      !f.policy_hash.trim()
    )
      return { lamports: null, reason: "Delayed valuation policy missing or unsupported" };
    if (v.execution_model_version !== "jupiter-quote-observed-estimate-v1")
      return { lamports: null, reason: "Unknown source age requires the approved receipt-aged Jupiter model" };
  } else {
    const observed = v.observed_at ? Date.parse(v.observed_at) : NaN;
    if (!Number.isFinite(observed) || observed > now + 2000)
      return { lamports: null, reason: "Source observation time unknown" };
    if (now - observed > MAX_MARK_AGE_MS) return { lamports: null, reason: "Source observation is stale" };
  }
  if (sourceAgeUnknown || v.execution_model_version === "jupiter-quote-observed-estimate-v1") {
    const age = ageMs(v.quote_received_at, now);
    const maximum = f.quote_receipt_max_age_ms;
    const limit =
      typeof maximum === "number" && Number.isInteger(maximum) && maximum >= 0
        ? Math.min(MAX_QUOTE_RECEIPT_AGE_MS, maximum)
        : MAX_QUOTE_RECEIPT_AGE_MS;
    if (age === null || age > limit)
      return { lamports: null, reason: "Quote receipt is stale or unknown (1s maximum)" };
  }
  const net =
    v.pricing_mode === "estimated_market_snapshot"
      ? v.estimated_liquidation_net_lamports
      : v.pricing_mode === "protocol_quote"
        ? v.full_size_liquidation_net_lamports
        : null;
  if (net === null || !RAW_SIGNED.test(net) || !RAW_UNSIGNED.test(t.entry_input_lamports))
    return { lamports: null, reason: "Net liquidation unavailable" };
  return {
    lamports: String(BigInt(net) - BigInt(t.entry_input_lamports)),
    reason: sourceAgeUnknown
      ? "Receipt-aged paper estimate; source age unknown, not an executed trade"
      : "Estimated paper result, not an executed trade",
  };
}

export async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers?.get?.("content-length");
  if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES))
    throw Error("oversized response");
  if (!response.body?.getReader) throw Error("streaming response unavailable");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw Error("aborted");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw Error("oversized response");
      chunks.push(value);
    }
    if (signal.aborted) throw Error("aborted");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
export type FeedFetch = (path: string, init: RequestInit) => Promise<Response>;
/** Injected transport only. Default is disabled; no global fetch is called or captured. */
export function createLoader(
  fetchFn: FeedFetch,
  now: () => number = Date.now,
  feedPath: string | null = SOLANA_PAPER_FEED_URL,
): SolanaPaperLoader {
  return async (signal = new AbortController().signal) => {
    if (feedPath === null) return { state: "not_started" };
    if (feedPath !== FUTURE_FEED_PATH) return { state: "error", message: "Feed unavailable: unapproved endpoint." };
    try {
      const response = await fetchFn(feedPath, {
        method: "GET",
        signal,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return { state: "error", message: `Feed unavailable: HTTP ${response.status}.` };
      const mime = response.headers.get("content-type") || "";
      if (!/^application\/json(?:\s*;|$)/i.test(mime))
        return { state: "error", message: "Feed unavailable: expected JSON." };
      return parseFeed(await boundedJson(response, signal), now());
    } catch {
      return { state: "error", message: "Feed offline or unavailable. Current values have been cleared." };
    }
  };
}
export type RefreshScheduler<Handle = ReturnType<typeof setTimeout>> = {
  set: (fn: () => void, ms: number) => Handle;
  clear: (id: Handle | undefined) => void;
};
export type RefreshOptions<Handle = ReturnType<typeof setTimeout>> = {
  scheduler?: RefreshScheduler<Handle>;
  intervalMs?: number;
  timeoutMs?: number;
};
/** Completion-relative, single-flight refresh. A timed-out noncooperative request cannot overlap. */
export function startRefresh<Handle = ReturnType<typeof setTimeout>>(
  loader: SolanaPaperLoader,
  emit: (load: SolanaPaperLoad) => void,
  options: RefreshOptions<Handle> = {},
): () => void {
  const scheduler = options.scheduler ?? {
    set: (fn: () => void, ms: number) => setTimeout(fn, ms) as Handle,
    clear: (id: Handle | undefined) => {
      if (id !== undefined) clearTimeout(id as ReturnType<typeof setTimeout>);
    },
  };
  const intervalMs = options.intervalMs || 5000,
    timeoutMs = options.timeoutMs || 10000;
  let stopped = false,
    next: Handle | undefined,
    deadline: Handle | undefined,
    controller: AbortController | undefined;
  async function run(): Promise<void> {
    if (stopped) return;
    const current = new AbortController();
    controller = current;
    let timedOut = false;
    deadline = scheduler.set(() => {
      timedOut = true;
      current.abort();
      if (!stopped)
        emit({ state: "error", message: "Feed offline: request timed out. Current values have been cleared." });
    }, timeoutMs);
    try {
      const state = await loader(current.signal);
      if (!stopped && !timedOut) emit(state);
    } catch {
      if (!stopped && !timedOut)
        emit({ state: "error", message: "Feed offline: request failed. Current values have been cleared." });
    } finally {
      scheduler.clear(deadline);
      if (!stopped)
        next = scheduler.set(() => {
          void run();
        }, intervalMs);
    }
  }
  void run();
  return () => {
    stopped = true;
    scheduler.clear(next);
    scheduler.clear(deadline);
    controller?.abort();
  };
}

export type WalletMode = "watch_only" | "paper_copy" | "paused" | "removed" | "not_started";
export type WalletRow = {
  wallet: string;
  label: string;
  revision: number | null;
  mode: WalletMode;
  polling_configured?: boolean;
};
export function walletRows(load: SolanaPaperLoad): WalletRow[] | null {
  if (load.state !== "ready") return null;
  const rows = load.feed.wallets;
  if (!Array.isArray(rows) || rows.length > 1000) return null;
  try {
    rows.forEach((value) => {
      const w = objectValue(value);
      textValue(w.wallet);
      if (!w.wallet) throw Error("wallet");
      textValue(w.label);
      count(w.revision);
      one(w.mode, ["watch_only", "paper_copy", "paused", "removed", "not_started"]);
      if (w.polling_configured !== undefined && typeof w.polling_configured !== "boolean") throw Error("polling flag");
    });
    if (new Set(rows.map((w) => objectValue(w).wallet)).size !== rows.length) return null;
    return rows as WalletRow[];
  } catch {
    return null;
  }
}

export type ExportedTraderPnl = {
  source_wallet: string;
  realized_net_pnl_lamports: string | null;
  open_net_pnl_lamports: string | null;
  total_net_pnl_lamports: string | null;
  closed_count: number;
  open_count: number;
  unresolved_count: number;
  failed_entry_count: number;
};
function validateTraderPnl(value: unknown): ExportedTraderPnl[] {
  if (!Array.isArray(value) || value.length > 1000) throw Error("trader PnL rows");
  for (const item of value) {
    const row = objectValue(item);
    textValue(row.source_wallet);
    if (!row.source_wallet) throw Error("trader identity");
    for (const k of ["realized_net_pnl_lamports", "open_net_pnl_lamports", "total_net_pnl_lamports"])
      raw(row[k], true, true);
    for (const k of ["closed_count", "open_count", "unresolved_count", "failed_entry_count"]) {
      count(row[k]);
      if (row[k] === null) throw Error("missing trader count");
    }
  }
  if (new Set(value.map((row) => objectValue(row).source_wallet)).size !== value.length)
    throw Error("duplicate trader identity");
  return value as ExportedTraderPnl[];
}
export type TraderSummary = {
  wallet: string;
  tradeCount: number;
  openCount: number;
  closedCount: number;
  unresolvedCount: number;
  failedEntryCount: number;
  realizedLamports: string | null;
  openLamports: string | null;
  totalLamports: string | null;
};
/**
 * Authoritative OUR-copy results, grouped by full source-wallet identity.
 * Never derive totals from position rows: exported totals also include failed-entry
 * and failed-exit costs. No balance, compounding, or source-wallet PnL is inferred.
 * The exact fixed-notional marker is required; legacy feeds yield no summaries.
 * Backend counters are disjoint; unresolved includes pending entries or held copies
 * lacking usable marks. tradeCount counts exported position rows; failed attempts
 * remain separate. Null totals stay unknown, not zero or partial sums.
 */
export function traderSummaries(load: SolanaPaperLoad, now: number): TraderSummary[] {
  if (load.state !== "ready") return [];
  const f = load.feed;
  if (
    f.accounting_mode !== FIXED_COPY_ACCOUNTING_MODE ||
    f.entry_notional_lamports !== COPY_ENTRY_NOTIONAL_LAMPORTS ||
    f.account !== null
  )
    return [];
  let exported: ExportedTraderPnl[];
  try {
    exported = validateTraderPnl(f.trader_pnl);
  } catch {
    return [];
  }
  return exported.map((row) => {
    const positions = f.trades.filter((t) => t.source_wallet === row.source_wallet);
    const openPositions = positions.filter((t) => t.position_status === "open");
    // An omitted open row must not bypass its source/receipt freshness checks.
    const currentKnown =
      transportFresh(load, now) &&
      row.unresolved_count === 0 &&
      openPositions.length === row.open_count &&
      !positions.some((t) => t.position_status === "unresolved") &&
      openPositions.every((t) => tradePnl(t, load, now).lamports !== null);
    return {
      wallet: row.source_wallet,
      tradeCount: positions.length,
      openCount: row.open_count,
      closedCount: row.closed_count,
      unresolvedCount: row.unresolved_count,
      failedEntryCount: row.failed_entry_count,
      realizedLamports: row.realized_net_pnl_lamports,
      openLamports: currentKnown ? row.open_net_pnl_lamports : null,
      totalLamports: currentKnown ? row.total_net_pnl_lamports : null,
    };
  });
}

// ---------- Existing-file server-function seam: no new production route required ----------
function pick(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw Error("invalid projection");
  const source = value as Record<string, unknown>;
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]));
}

// Do not relay arbitrary upstream fields, even from an otherwise valid snapshot.
export function publicProjection(feed: SolanaPaperFeed): Record<string, unknown> {
  if (
    feed.accounting_mode !== FIXED_COPY_ACCOUNTING_MODE ||
    feed.entry_notional_lamports !== COPY_ENTRY_NOTIONAL_LAMPORTS ||
    feed.account !== null
  )
    throw Error("unsupported copy model");
  const wallets = walletRows({ state: "ready", feed, fetchedAt: 0 });
  return {
    ...pick(feed, [
      "schema_version",
      "run_id",
      "evidence_kind",
      "status",
      "data_as_of",
      "start_utc",
      "end_utc",
      "heartbeat_utc",
      "upstream_age_unknown",
      "policy_version",
      "policy_hash",
      "quote_receipt_max_age_ms",
      "accounting_mode",
      "entry_notional_lamports",
    ]),
    account: null,
    coverage: pick(feed.coverage, [
      "expected_intervals",
      "observed_intervals",
      "gap_count",
      "largest_gap_seconds",
      "summary",
    ]),
    trades: feed.trades.map((trade) => ({
      ...pick(trade, [
        "position_id",
        "source_wallet",
        "mint",
        "symbol",
        "name",
        "entry_input_lamports",
        "acquired_tokens_raw",
        "decimals",
        "entry_at",
        "exit_at",
        "position_status",
        "fees_lamports",
        "locked_rent_lamports",
        "realized_net_pnl_lamports",
      ]),
      valuation: {
        ...pick(trade.valuation, [
          "pricing_mode",
          "mark_status",
          "observed_at",
          "received_at",
          "quote_received_at",
          "source_event_age_known",
          "provider",
          "price_basis",
          "liquidity_value",
          "liquidity_currency",
          "market_cap",
          "fee_assumption_bps",
          "slippage_assumption_bps",
          "execution_model_version",
          "estimated_liquidation_net_lamports",
          "full_size_liquidation_net_lamports",
          "unresolved_reason",
        ]),
        source: null,
      },
    })),
    ...(wallets !== null
      ? {
          wallets: wallets.map((wallet) => pick(wallet, ["wallet", "label", "revision", "mode", "polling_configured"])),
        }
      : {}),
    ...(Array.isArray(feed.trader_pnl)
      ? {
          trader_pnl: feed.trader_pnl.map((trader) =>
            pick(trader, [
              "source_wallet",
              "realized_net_pnl_lamports",
              "open_net_pnl_lamports",
              "total_net_pnl_lamports",
              "closed_count",
              "open_count",
              "unresolved_count",
              "failed_entry_count",
            ]),
          ),
        }
      : {}),
  };
}

/**
 * GET-only public RPC. TanStack replaces this handler with a same-origin client stub.
 * No data validator/input is accepted; callers cannot select targets, paths or headers.
 * All upstream networking and the fixed origin remain inside the extracted handler.
 */
export const getSolanaPaperSnapshot = createServerFn({ method: "GET" }).handler(async (): Promise<Response> => {
  // Intentionally unset. Enabling this requires separate origin/contract verification.
  const VERIFIED_BACKEND_ORIGIN: string | null = null;
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  setResponseHeaders(new Headers(headers));
  const json = (body: unknown, status: number): Response => new Response(JSON.stringify(body), { status, headers });
  if (VERIFIED_BACKEND_ORIGIN === null) return json({ status: "not_started", owner: "awaiting_verified_backend" }, 200);
  const controller = new AbortController();
  const requestSignal = getRequest().signal;
  const abortUpstream = () => controller.abort();
  if (requestSignal.aborted) controller.abort();
  else requestSignal.addEventListener("abort", abortUpstream, { once: true });
  const timer = setTimeout(abortUpstream, 8_000);
  try {
    if (controller.signal.aborted) throw Error("aborted");
    const origin = new URL(VERIFIED_BACKEND_ORIGIN);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw Error("invalid fixed origin");
    const response = await fetch(new URL("/solana-paper", origin), {
      method: "GET",
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || ""))
      throw Error("upstream unavailable");
    const result = parseFeed(await boundedJson(response, controller.signal), Date.now());
    if (result.state === "error") throw Error("invalid snapshot");
    // Never forward incoming or upstream headers, cookies, credentials, URLs or errors.
    return json(result.state === "not_started" ? { status: "not_started" } : publicProjection(result.feed), 200);
  } catch {
    return json({ status: "unavailable", message: "Read-only paper snapshot unavailable." }, 503);
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", abortUpstream);
  }
});

export type ServerSnapshotTransport = (options: { signal: AbortSignal }) => Promise<Response>;
/** Signal is a documented TanStack call option, not serialized handler data. */
export function createServerLoader(serverFn: ServerSnapshotTransport, now: () => number = Date.now): SolanaPaperLoader {
  return async (signal = new AbortController().signal) => {
    try {
      if (signal.aborted) throw Error("aborted");
      const response = await serverFn({ signal });
      if (!response.ok) return { state: "error", message: `Feed unavailable: HTTP ${response.status}.` };
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || ""))
        return { state: "error", message: "Feed unavailable: expected JSON." };
      return parseFeed(await boundedJson(response, signal), now());
    } catch {
      return { state: "error", message: "Feed offline or unavailable. Current values have been cleared." };
    }
  };
}
/** Callable alternative transport; startRefresh supplies the 10s deadline/single flight. */
export const loadSolanaPaperServerFeed: SolanaPaperLoader = createServerLoader(getSolanaPaperSnapshot);
