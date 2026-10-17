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

// ---------- Historical paper monitor (separate from legacy current-quote adapter) ----------
export const PAPER_HISTORY_VERSION = "normalized-historical-copy-pnl/1";
export const PAPER_MONITOR_VERSION = "solana-paper-monitor/1";
export const EXPLORATORY_POLICY = "helius-prospective-epochs-exploratory-v1";
export const CONDITIONAL_RETURNS_SCOPE = "observed_path_conditional_not_real_money_performance";
export type CoverageClass = "clean_observed_path" | "gap_affected_observed_path";
export type ExploratoryInfo = {
  exploratory_mode: true | null;
  returns_scope: typeof CONDITIONAL_RETURNS_SCOPE | null;
  source_observation_policy: typeof EXPLORATORY_POLICY | null;
};
export type ScannerSource = {
  provider: string;
  stream_state: string;
  selected_wallet_count: number;
  acknowledged_wallet_count: number;
  baseline_complete_count: number;
  last_poll_at: string | null;
  last_stream_receipt_at: string | null;
  last_enrichment_ready_at: string | null;
  last_source_block_time_at: string | null;
  stream_notification_count: number;
  raw_lookup_parsed_count: number;
  gap_count: number;
  gap_latched: boolean;
  new_entries_paused: boolean;
  source_sale_tracking_active: boolean;
  handoff_pending: number;
  coverage_complete: false;
  source_time_basis: string;
  history_population_equivalent: false;
  active_epoch_id: number | null;
  connection_count: number | null;
  disconnect_count: number | null;
  epoch_count: number | null;
  eligible_wallet_count: number | null;
  partially_paused: boolean | null;
  gap_reason_counts: Record<string, number> | null;
  gap_count_basis: "per_wallet_gap_records" | null;
};
export type ScannerHealth = ExploratoryInfo & {
  hosting_version: string;
  status: string;
  run_id: string | null;
  heartbeat_utc: string;
  fixed_deadline_utc: string;
  reporter_status: string;
  read_only: true;
  live_trading_enabled: false;
  financial_data_is_current: false;
  evidence_kind: EvidenceKind;
  source_status: ScannerSource | null;
  selected_wallets: string[] | null;
};
export type HistoricalTrader = {
  source_wallet: string;
  realized_net_pnl_lamports: string;
  open_net_pnl_lamports_at_cutoff: string | null;
  total_net_pnl_lamports_at_cutoff: string | null;
  closed_count: number;
  open_count: number;
  unresolved_count: number;
  failed_entry_count: number;
  skipped_opportunity_count: number;
  skipped_reasons: Record<string, number>;
  source_coverage_gap_latched: boolean | null;
  pnl_scope: "our_modeled_copies_not_source_wallet_returns";
};
export type HistoricalTrade = {
  position_id: string;
  source_wallet: string;
  mint: string;
  entry_notional_lamports: string;
  acquired_tokens_raw: string | null;
  decimals: number | null;
  entry_at: string;
  exit_at: string | null;
  position_status_at_cutoff: PositionStatus;
  realized_net_pnl_lamports: string | null;
  open_net_pnl_lamports_at_cutoff: string | null;
  unresolved_reason: string | null;
  source_coverage_gap_latched: boolean;
  source_epoch_id: number | null;
  coverage_class: CoverageClass | null;
  historical_only: true;
  current: false;
  executable: false;
};
export type HistoricalOpenMark = {
  position_id: string;
  source_wallet: string;
  mint: string;
  mark_status_at_cutoff: "known_at_cutoff" | "unresolved_at_cutoff";
  open_net_pnl_lamports_at_cutoff: string | null;
  quote_received_at: string | null;
  quote_source_generated_at: null;
  source_event_age_known: false;
  unresolved_reason: string | null;
  source_epoch_id: number | null;
  coverage_class: CoverageClass | null;
  executable: false;
  current: false;
};
export type SourceEpochPnl = {
  source_wallet: string;
  source_epoch_id: number;
  coverage_class: CoverageClass;
  realized_net_pnl_lamports: string;
  open_net_pnl_lamports_at_cutoff: string | null;
  total_net_pnl_lamports_at_cutoff: string | null;
  closed_count: number;
  open_count: number;
  unresolved_count: number;
  failed_entry_count: number;
  first_source_sale_exhaustiveness_verified: false;
  historical_only: true;
  current: false;
  executable: false;
};
export type SourceEpoch = {
  source_epoch_id: number;
  opened_at: string;
  barrier_slot: number;
  history_coverage_known: false;
};
export type PaperHistory = ExploratoryInfo & {
  schema_version: string;
  run_id: string;
  evidence_kind: EvidenceKind;
  evidence_fence: { evidence_cutoff_utc: string; fixed_deadline_utc: string; journal_sequence: number };
  report_generated_at_utc: string;
  report_received_at_utc: string | null;
  status_at_cutoff: string;
  historical_only: true;
  financial_data_is_current: false;
  entry_notional_lamports: string;
  report_min_interval_seconds: number;
  trader_pnl_as_of: HistoricalTrader[];
  copied_trades_as_of: HistoricalTrade[] | null;
  open_marks_as_of: HistoricalOpenMark[] | null;
  source_epoch_pnl_as_of: SourceEpochPnl[] | null;
  source_epochs: SourceEpoch[] | null;
  accounting_mode: string;
  account: null;
  executable: false;
  funded_balance_exists: false;
  compounding_enabled: false;
  finality_verified: false;
  exhaustive_coverage: false;
};
type MonitorPart<T> = { state: "available"; data: T } | { state: "waiting" | "unavailable" };
export type PaperMonitorLoad =
  | { state: "not_started" }
  | { state: "error"; message: string }
  | { state: "ready"; fetchedAt: number; health: MonitorPart<ScannerHealth>; history: MonitorPart<PaperHistory> };
export type PaperMonitorLoader = (signal?: AbortSignal) => Promise<PaperMonitorLoad>;
const publicCode = (v: unknown): string => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_.,:-]{1,256}$/.test(v)) throw Error("public code");
  return v;
};
const publicIdentity = (v: unknown): string => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(v)) throw Error("public identity");
  return v;
};
const requiredCount = (v: unknown): number => {
  count(v);
  if (v === null) throw Error("missing count");
  return v as number;
};
const requiredBool = (v: unknown): boolean => {
  if (typeof v !== "boolean") throw Error("flag");
  return v;
};
const requiredStamp = (v: unknown): string => {
  stamp(v, false);
  return v as string;
};
const nullableStamp = (v: unknown): string | null => {
  stamp(v);
  return v as string | null;
};
const signedAmount = (v: unknown, nullable = true): string | null => {
  raw(v, nullable, true);
  return v as string | null;
};
const observedKind = (v: unknown): EvidenceKind => {
  one(v, ["observed_estimated_paper", "observed_protocol_paper"]);
  return v as EvidenceKind;
};
const exploratoryInfo = (h: Record<string, unknown>): ExploratoryInfo => {
  if (h.exploratory_mode == null && h.returns_scope == null && h.source_observation_policy == null)
    return { exploratory_mode: null, returns_scope: null, source_observation_policy: null };
  if (
    h.exploratory_mode !== true ||
    h.returns_scope !== CONDITIONAL_RETURNS_SCOPE ||
    h.source_observation_policy !== EXPLORATORY_POLICY
  )
    throw Error("exploratory mode contract");
  return {
    exploratory_mode: true,
    returns_scope: CONDITIONAL_RETURNS_SCOPE,
    source_observation_policy: EXPLORATORY_POLICY,
  };
};
const coverageClass = (v: unknown): CoverageClass => {
  one(v, ["clean_observed_path", "gap_affected_observed_path"]);
  return v as CoverageClass;
};
export const coverageLabel = (v: CoverageClass | null): string =>
  v === "clean_observed_path"
    ? "Clean-observed path · no known gap"
    : v === "gap_affected_observed_path"
      ? "Gap-affected path · conditional result"
      : "Coverage cohort not supplied";
export const historicalPositionLabel = (t: HistoricalTrade): string =>
  t.position_status_at_cutoff === "unresolved" &&
  t.exit_at === null &&
  t.acquired_tokens_raw !== null &&
  BigInt(t.acquired_tokens_raw) > 0n
    ? "Copied · valuation unresolved"
    : t.position_status_at_cutoff;
const optionalCount = (v: unknown): number | null => (v == null ? null : requiredCount(v));
const gapReasons = (value: unknown): Record<string, number> | null => {
  if (value == null) return null;
  const v = objectValue(value);
  const allowed = [
    "stream_disconnect_no_exhaustive_replay",
    "history_pagination_incomplete",
    "initial_baseline_incomplete",
    "conflicting_transaction_payload",
    "transaction_unavailable",
    "transaction_unavailable_after_bounded_null_retries",
    "unsupported_transaction_shape",
    "stream_ending_for_bounded_final_reconciliation",
    "other_reason_redacted",
  ];
  if (Object.keys(v).length > allowed.length) throw Error("gap reasons");
  return Object.fromEntries(
    Object.entries(v).map(([key, n]) => {
      one(key, allowed);
      return [key, requiredCount(n)];
    }),
  );
};

/** Reconstruct public objects, never forward arbitrary upstream nested fields. */
export function publicScannerHealth(value: unknown): ScannerHealth {
  const h = objectValue(value),
    owner = objectValue(h.owner ?? {});
  if (
    h.hosting_version !== PAPER_HISTORY_VERSION ||
    h.read_only !== true ||
    h.live_trading_enabled !== false ||
    h.financial_data_is_current !== false
  )
    throw Error("health contract");
  const evidence = observedKind(h.evidence_kind ?? owner.evidence_kind);
  let source: ScannerSource | null = null;
  if (h.source_status != null) {
    const s = objectValue(h.source_status);
    if (
      s.provider !== "helius_parsed_streams" ||
      s.coverage_complete !== false ||
      s.history_population_equivalent !== false
    )
      throw Error("source contract");
    source = {
      provider: s.provider,
      stream_state: publicCode(s.stream_state),
      selected_wallet_count: requiredCount(s.selected_wallet_count),
      acknowledged_wallet_count: requiredCount(s.acknowledged_wallet_count),
      baseline_complete_count: requiredCount(s.baseline_complete_count),
      last_poll_at: nullableStamp(s.last_poll_at),
      last_stream_receipt_at: nullableStamp(s.last_stream_receipt_at),
      last_enrichment_ready_at: nullableStamp(s.last_enrichment_ready_at),
      last_source_block_time_at: nullableStamp(s.last_source_block_time_at),
      stream_notification_count: requiredCount(s.stream_notification_count),
      raw_lookup_parsed_count: requiredCount(s.raw_lookup_parsed_count),
      gap_count: requiredCount(s.gap_count),
      gap_latched: requiredBool(s.gap_latched),
      new_entries_paused: requiredBool(s.new_entries_paused),
      source_sale_tracking_active: requiredBool(s.source_sale_tracking_active),
      handoff_pending: requiredCount(s.handoff_pending),
      coverage_complete: false,
      source_time_basis: publicCode(s.source_time_basis),
      history_population_equivalent: false,
      active_epoch_id: optionalCount(s.active_epoch_id),
      connection_count: optionalCount(s.connection_count),
      disconnect_count: optionalCount(s.disconnect_count),
      epoch_count: optionalCount(s.epoch_count),
      eligible_wallet_count: optionalCount(s.eligible_wallet_count),
      partially_paused: s.partially_paused == null ? null : requiredBool(s.partially_paused),
      gap_reason_counts: gapReasons(s.gap_reason_counts),
      gap_count_basis:
        s.gap_count_basis == null
          ? null
          : (one(s.gap_count_basis, ["per_wallet_gap_records"]), "per_wallet_gap_records"),
    };
  }
  return {
    ...exploratoryInfo(h),
    hosting_version: PAPER_HISTORY_VERSION,
    status: publicCode(h.status),
    run_id: h.run_id == null ? null : publicIdentity(h.run_id),
    heartbeat_utc: requiredStamp(h.heartbeat_utc),
    fixed_deadline_utc: requiredStamp(h.fixed_deadline_utc),
    reporter_status: publicCode(h.reporter_status),
    read_only: true,
    live_trading_enabled: false,
    financial_data_is_current: false,
    evidence_kind: evidence,
    source_status: source,
    selected_wallets:
      h.selected_wallets == null
        ? null
        : (() => {
            if (!Array.isArray(h.selected_wallets) || h.selected_wallets.length > 1000) throw Error("selected wallets");
            const wallets = h.selected_wallets.map(publicIdentity);
            if (new Set(wallets).size !== wallets.length) throw Error("duplicate wallet");
            return wallets;
          })(),
  };
}
export function publicPaperHistory(value: unknown): PaperHistory {
  const h = objectValue(value),
    fence = objectValue(h.evidence_fence);
  if (
    h.schema_version !== PAPER_HISTORY_VERSION ||
    h.accounting_mode !== FIXED_COPY_ACCOUNTING_MODE ||
    h.entry_notional_lamports !== COPY_ENTRY_NOTIONAL_LAMPORTS ||
    h.account !== null ||
    h.historical_only !== true ||
    h.financial_data_is_current !== false ||
    h.executable !== false ||
    h.funded_balance_exists !== false ||
    h.compounding_enabled !== false ||
    h.finality_verified !== false ||
    h.exhaustive_coverage !== false
  )
    throw Error("historical contract");
  const evidence = observedKind(h.evidence_kind);
  const mode = exploratoryInfo(h);
  const cutoff = requiredStamp(fence.evidence_cutoff_utc),
    deadline = requiredStamp(fence.fixed_deadline_utc);
  const generated = requiredStamp(h.report_generated_at_utc);
  if (Date.parse(generated) < Date.parse(cutoff)) throw Error("report before cutoff");
  const cadence = requiredCount(h.report_min_interval_seconds);
  if (cadence < 600) throw Error("historical cadence");
  if (!Array.isArray(h.trader_pnl_as_of) || h.trader_pnl_as_of.length > 1000) throw Error("traders");
  const traders = h.trader_pnl_as_of.map((value): HistoricalTrader => {
    const t = objectValue(value);
    if (t.pnl_scope !== "our_modeled_copies_not_source_wallet_returns") throw Error("PnL scope");
    const realized = signedAmount(t.realized_net_pnl_lamports, false) as string;
    const opened = signedAmount(t.open_net_pnl_lamports_at_cutoff);
    const total = signedAmount(t.total_net_pnl_lamports_at_cutoff);
    const unresolved = requiredCount(t.unresolved_count);
    if (unresolved > 0 && (opened !== null || total !== null)) throw Error("partial total");
    if (total !== null && (opened === null || BigInt(total) !== BigInt(realized) + BigInt(opened)))
      throw Error("total mismatch");
    const reasons = objectValue(t.skipped_reasons);
    if (Object.keys(reasons).length > 200) throw Error("reasons");
    const safeReasons = Object.fromEntries(Object.entries(reasons).map(([k, v]) => [publicCode(k), requiredCount(v)]));
    return {
      source_wallet: publicIdentity(t.source_wallet),
      realized_net_pnl_lamports: realized,
      open_net_pnl_lamports_at_cutoff: opened,
      total_net_pnl_lamports_at_cutoff: total,
      closed_count: requiredCount(t.closed_count),
      open_count: requiredCount(t.open_count),
      unresolved_count: unresolved,
      failed_entry_count: requiredCount(t.failed_entry_count),
      skipped_opportunity_count: requiredCount(t.skipped_opportunity_count),
      pnl_scope: "our_modeled_copies_not_source_wallet_returns",
      skipped_reasons: safeReasons,
      source_coverage_gap_latched:
        t.source_coverage_gap_latched == null ? null : requiredBool(t.source_coverage_gap_latched),
    };
  });
  if (new Set(traders.map((t) => t.source_wallet)).size !== traders.length) throw Error("duplicate trader");
  let trades: HistoricalTrade[] | null = null;
  if (h.copied_trades_as_of != null) {
    if (!Array.isArray(h.copied_trades_as_of) || h.copied_trades_as_of.length > 10000) throw Error("trades");
    trades = h.copied_trades_as_of.map((value): HistoricalTrade => {
      const t = objectValue(value);
      if (
        t.entry_notional_lamports !== COPY_ENTRY_NOTIONAL_LAMPORTS ||
        t.historical_only !== true ||
        t.current !== false ||
        t.executable !== false
      )
        throw Error("trade contract");
      one(t.position_status_at_cutoff, ["open", "closed", "unresolved"]);
      raw(t.acquired_tokens_raw);
      count(t.decimals, 18);
      const entry = requiredStamp(t.entry_at),
        exit = nullableStamp(t.exit_at);
      if (
        Date.parse(entry) > Date.parse(cutoff) ||
        (exit && (Date.parse(exit) < Date.parse(entry) || Date.parse(exit) > Date.parse(cutoff)))
      )
        throw Error("trade after cutoff");
      const realized = signedAmount(t.realized_net_pnl_lamports),
        opened = signedAmount(t.open_net_pnl_lamports_at_cutoff);
      if (
        (t.position_status_at_cutoff === "closed" && (realized === null || opened !== null)) ||
        (t.position_status_at_cutoff !== "closed" && realized !== null) ||
        (t.position_status_at_cutoff === "unresolved" && opened !== null)
      )
        throw Error("trade PnL state");
      return {
        position_id: publicIdentity(t.position_id),
        source_wallet: publicIdentity(t.source_wallet),
        mint: publicIdentity(t.mint),
        entry_notional_lamports: COPY_ENTRY_NOTIONAL_LAMPORTS,
        acquired_tokens_raw: t.acquired_tokens_raw as string | null,
        decimals: t.decimals as number | null,
        entry_at: entry,
        exit_at: exit,
        position_status_at_cutoff: t.position_status_at_cutoff as PositionStatus,
        realized_net_pnl_lamports: realized,
        open_net_pnl_lamports_at_cutoff: opened,
        unresolved_reason: t.unresolved_reason === null ? null : publicCode(t.unresolved_reason),
        source_coverage_gap_latched: requiredBool(t.source_coverage_gap_latched),
        source_epoch_id: mode.exploratory_mode ? requiredCount(t.source_epoch_id) : null,
        coverage_class: mode.exploratory_mode ? coverageClass(t.coverage_class) : null,
        historical_only: true,
        current: false,
        executable: false,
      };
    });
    if (
      new Set(trades.map((t) => t.position_id)).size !== trades.length ||
      trades.some((t) => !traders.some((w) => w.source_wallet === t.source_wallet))
    )
      throw Error("trade identity");
  }
  let marks: HistoricalOpenMark[] | null = null;
  if (h.open_marks_as_of != null) {
    if (!Array.isArray(h.open_marks_as_of) || h.open_marks_as_of.length > 10000) throw Error("open marks");
    marks = h.open_marks_as_of.map((value): HistoricalOpenMark => {
      const m = objectValue(value),
        wallet = publicIdentity(m.source_wallet);
      one(m.mark_status_at_cutoff, ["known_at_cutoff", "unresolved_at_cutoff"]);
      const opened = signedAmount(m.open_net_pnl_lamports_at_cutoff);
      if (
        m.executable !== false ||
        m.current !== false ||
        m.quote_source_generated_at !== null ||
        m.source_event_age_known !== false ||
        !traders.some((t) => t.source_wallet === wallet) ||
        (m.mark_status_at_cutoff === "known_at_cutoff") !== (opened !== null)
      )
        throw Error("open mark contract");
      return {
        position_id: publicIdentity(m.position_id),
        source_wallet: wallet,
        mint: publicIdentity(m.mint),
        mark_status_at_cutoff: m.mark_status_at_cutoff as HistoricalOpenMark["mark_status_at_cutoff"],
        open_net_pnl_lamports_at_cutoff: opened,
        quote_received_at: nullableStamp(m.quote_received_at),
        quote_source_generated_at: null,
        source_event_age_known: false,
        unresolved_reason: m.unresolved_reason === null ? null : publicCode(m.unresolved_reason),
        source_epoch_id: mode.exploratory_mode ? requiredCount(m.source_epoch_id) : null,
        coverage_class: mode.exploratory_mode ? coverageClass(m.coverage_class) : null,
        executable: false,
        current: false,
      };
    });
    if (new Set(marks.map((m) => m.position_id)).size !== marks.length) throw Error("duplicate open mark");
  }
  let epochRows: SourceEpochPnl[] | null = null;
  let epochs: SourceEpoch[] | null = null;
  if (mode.exploratory_mode) {
    if (
      !Array.isArray(h.source_epochs) ||
      h.source_epochs.length > 1000 ||
      !Array.isArray(h.source_epoch_pnl_as_of) ||
      h.source_epoch_pnl_as_of.length > 10000
    )
      throw Error("source epochs");
    epochs = h.source_epochs.map((value): SourceEpoch => {
      const e = objectValue(value),
        opened = requiredStamp(e.opened_at);
      if (e.history_coverage_known !== false || Date.parse(opened) > Date.parse(cutoff)) throw Error("epoch coverage");
      return {
        source_epoch_id: requiredCount(e.source_epoch_id),
        opened_at: opened,
        barrier_slot: requiredCount(e.barrier_slot),
        history_coverage_known: false,
      };
    });
    const ids = new Set(epochs.map((e) => e.source_epoch_id));
    if (ids.size !== epochs.length) throw Error("duplicate epoch");
    if (marks?.some((m) => !ids.has(m.source_epoch_id!))) throw Error("open mark epoch");
    epochRows = h.source_epoch_pnl_as_of.map((value): SourceEpochPnl => {
      const t = objectValue(value),
        epoch = requiredCount(t.source_epoch_id),
        wallet = publicIdentity(t.source_wallet);
      const realized = signedAmount(t.realized_net_pnl_lamports, false) as string,
        opened = signedAmount(t.open_net_pnl_lamports_at_cutoff),
        total = signedAmount(t.total_net_pnl_lamports_at_cutoff),
        unresolved = requiredCount(t.unresolved_count);
      if (
        !ids.has(epoch) ||
        !traders.some((w) => w.source_wallet === wallet) ||
        t.first_source_sale_exhaustiveness_verified !== false ||
        t.historical_only !== true ||
        t.current !== false ||
        t.executable !== false
      )
        throw Error("cohort contract");
      if (unresolved > 0 && (opened !== null || total !== null)) throw Error("partial cohort total");
      if (total !== null && (opened === null || BigInt(total) !== BigInt(realized) + BigInt(opened)))
        throw Error("cohort total mismatch");
      return {
        source_wallet: wallet,
        source_epoch_id: epoch,
        coverage_class: coverageClass(t.coverage_class),
        realized_net_pnl_lamports: realized,
        open_net_pnl_lamports_at_cutoff: opened,
        total_net_pnl_lamports_at_cutoff: total,
        closed_count: requiredCount(t.closed_count),
        open_count: requiredCount(t.open_count),
        unresolved_count: unresolved,
        failed_entry_count: requiredCount(t.failed_entry_count),
        first_source_sale_exhaustiveness_verified: false,
        historical_only: true,
        current: false,
        executable: false,
      };
    });
    if (
      new Set(epochRows.map((t) => `${t.source_wallet}:${t.source_epoch_id}:${t.coverage_class}`)).size !==
      epochRows.length
    )
      throw Error("duplicate cohort");
    if (
      trades?.some(
        (t) =>
          !ids.has(t.source_epoch_id!) ||
          t.source_coverage_gap_latched !== (t.coverage_class === "gap_affected_observed_path"),
      )
    )
      throw Error("trade cohort mismatch");
  } else if (
    h.source_epoch_pnl_as_of != null ||
    h.source_epochs != null ||
    trades?.some((_, i) => {
      const t = (h.copied_trades_as_of as Record<string, unknown>[])[i];
      return t.source_epoch_id != null || t.coverage_class != null;
    })
  )
    throw Error("cohort mode missing");
  return {
    ...mode,
    open_marks_as_of: marks,
    source_epoch_pnl_as_of: epochRows,
    source_epochs: epochs,
    schema_version: PAPER_HISTORY_VERSION,
    run_id: publicIdentity(h.run_id),
    evidence_kind: evidence,
    evidence_fence: {
      evidence_cutoff_utc: cutoff,
      fixed_deadline_utc: deadline,
      journal_sequence: requiredCount(fence.journal_sequence),
    },
    report_generated_at_utc: generated,
    report_received_at_utc: nullableStamp(h.report_received_at_utc ?? null),
    status_at_cutoff: publicCode(h.status_at_cutoff),
    historical_only: true,
    financial_data_is_current: false,
    entry_notional_lamports: COPY_ENTRY_NOTIONAL_LAMPORTS,
    report_min_interval_seconds: cadence,
    trader_pnl_as_of: traders,
    copied_trades_as_of: trades,
    accounting_mode: FIXED_COPY_ACCOUNTING_MODE,
    account: null,
    executable: false,
    funded_balance_exists: false,
    compounding_enabled: false,
    finality_verified: false,
    exhaustive_coverage: false,
  };
}
/** Already-sanitized RPC payload is still validated in the client. */
export function parsePaperMonitor(value: unknown, fetchedAt: number): PaperMonitorLoad {
  try {
    const m = objectValue(value);
    if (m.status === "not_started" && m.schema_version === undefined) return { state: "not_started" };
    if (m.schema_version !== PAPER_MONITOR_VERSION || !Number.isFinite(fetchedAt) || fetchedAt < 0)
      throw Error("monitor");
    const part = <T,>(input: unknown, validate: (v: unknown) => T): MonitorPart<T> => {
      const p = objectValue(input);
      if (p.state === "waiting" || p.state === "unavailable") return { state: p.state };
      if (p.state !== "available") throw Error("part state");
      return { state: "available", data: validate(p.data) };
    };
    const health = part(m.health, publicScannerHealth);
    const history = part(m.history, publicPaperHistory);
    if (
      history.state === "available" &&
      (Date.parse(history.data.evidence_fence.evidence_cutoff_utc) > fetchedAt + 2000 ||
        Date.parse(history.data.report_generated_at_utc) > fetchedAt + 2000)
    )
      throw Error("future history");
    if (
      health.state === "available" &&
      history.state === "available" &&
      (health.data.exploratory_mode !== history.data.exploratory_mode ||
        health.data.fixed_deadline_utc !== history.data.evidence_fence.fixed_deadline_utc ||
        (health.data.run_id !== null && health.data.run_id !== history.data.run_id))
    )
      throw Error("session mismatch");
    return { state: "ready", fetchedAt, health, history };
  } catch {
    return { state: "error", message: "Paper monitor unavailable: historical/source contract validation failed." };
  }
}
export function monitorTransportFresh(load: PaperMonitorLoad | null, now: number): boolean {
  return load?.state === "ready" && now >= load.fetchedAt && now - load.fetchedAt <= MAX_SILENCE_MS;
}
export function scannerHeartbeatFresh(health: ScannerHealth, now: number): boolean {
  const age = ageMs(health.heartbeat_utc, now);
  return age !== null && age <= 2000 && now < Date.parse(health.fixed_deadline_utc) && health.status !== "stopped";
}
/** Fixed-target monitor RPC; it never reads the legacy /solana-paper financial route. */
export const getSolanaPaperMonitor = createServerFn({ method: "GET" }).handler(async (): Promise<Response> => {
  const VERIFIED_MONITOR_ORIGIN: string | null = "https://solana-paper-pilot-production.up.railway.app";
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  setResponseHeaders(headers);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (VERIFIED_MONITOR_ORIGIN === null) return json({ status: "not_started" });
  const controller = new AbortController(),
    signal = getRequest().signal;
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 8000);
  try {
    const origin = new URL(VERIFIED_MONITOR_ORIGIN);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw Error("origin");
    const read = async <T,>(
      path: "/health" | "/solana-paper-history",
      project: (v: unknown) => T,
    ): Promise<MonitorPart<T>> => {
      try {
        if (controller.signal.aborted) throw Error("aborted");
        const response = await fetch(new URL(path, origin), {
          method: "GET",
          signal: controller.signal,
          credentials: "omit",
          // workerd accepts manual/follow only; never follow an upstream redirect.
          redirect: "manual",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400))
          throw Error("redirect");
        if (path === "/solana-paper-history" && response.status === 404) return { state: "waiting" };
        if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || ""))
          throw Error("response");
        return { state: "available", data: project(await boundedJson(response, controller.signal)) };
      } catch {
        return { state: "unavailable" };
      }
    };
    const [health, history] = await Promise.all([
      read("/health", publicScannerHealth),
      read("/solana-paper-history", publicPaperHistory),
    ]);
    if (controller.signal.aborted) throw Error("aborted");
    const payload = { schema_version: PAPER_MONITOR_VERSION, health, history };
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_BODY_BYTES) throw Error("body");
    return json(payload);
  } catch {
    return json({ status: "unavailable" }, 503);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
});
export function createMonitorLoader(
  serverFn: ServerSnapshotTransport,
  now: () => number = Date.now,
): PaperMonitorLoader {
  return async (signal = new AbortController().signal) => {
    try {
      if (signal.aborted) throw Error("aborted");
      const response = await serverFn({ signal });
      if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || ""))
        throw Error("response");
      return parsePaperMonitor(await boundedJson(response, signal), now());
    } catch {
      return { state: "error", message: "Paper monitor offline or unavailable. Values cleared, not zero." };
    }
  };
}
/** Read-only monitor; stopped or unavailable hosting never becomes a running claim. */
export const loadSolanaPaperMonitor: PaperMonitorLoader = (signal) => loadSolanaPaperServerMonitor(signal);
export const loadSolanaPaperServerMonitor: PaperMonitorLoader = createMonitorLoader(getSolanaPaperMonitor);
export function startMonitorRefresh(
  loader: PaperMonitorLoader,
  emit: (load: PaperMonitorLoad) => void,
  options: RefreshOptions = {},
): () => void {
  const scheduler = options.scheduler ?? {
    set: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clear: (id: ReturnType<typeof setTimeout> | undefined) => {
      if (id !== undefined) clearTimeout(id);
    },
  };
  let stopped = false,
    next: ReturnType<typeof setTimeout> | undefined,
    deadline: ReturnType<typeof setTimeout> | undefined,
    active: AbortController | undefined;
  const run = async () => {
    if (stopped) return;
    active = new AbortController();
    let timedOut = false;
    deadline = scheduler.set(() => {
      timedOut = true;
      active?.abort();
      if (!stopped) emit({ state: "error", message: "Paper monitor timed out. Values cleared, not zero." });
    }, options.timeoutMs ?? 10000);
    try {
      const value = await loader(active.signal);
      if (!stopped && !timedOut) emit(value);
    } catch {
      if (!stopped && !timedOut)
        emit({ state: "error", message: "Paper monitor unavailable. Values cleared, not zero." });
    } finally {
      scheduler.clear(deadline);
      if (!stopped)
        next = scheduler.set(() => {
          void run();
        }, options.intervalMs ?? 5000);
    }
  };
  void run();
  return () => {
    stopped = true;
    scheduler.clear(next);
    scheduler.clear(deadline);
    active?.abort();
  };
}
/** Only historical evidence may survive a failed request, always with its original cutoff. */
export function retainPaperHistory(previous: PaperHistory | null, load: PaperMonitorLoad): PaperHistory | null {
  if (load.state !== "ready") return previous;
  const currentRun = load.health.state === "available" ? load.health.data.run_id : null;
  if (previous && currentRun && currentRun !== previous.run_id) previous = null;
  if (load.history.state !== "available") return previous;
  const next = load.history.data;
  if (
    previous &&
    next.run_id === previous.run_id &&
    Date.parse(next.evidence_fence.evidence_cutoff_utc) < Date.parse(previous.evidence_fence.evidence_cutoff_utc)
  )
    return previous;
  return next;
}

// Display metadata only. This service is independent of scanner/PnL reads and never supplies prices.
export type PaperTokenSymbols = {
  schema_version: "solana-paper-token-symbols/1";
  run_id: string | null;
  source: "DEX Screener";
  metadata_only: true;
  symbols: Record<string, string | null>;
};
const isSolanaMint = (v: unknown): v is string => typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const safeTokenSymbol = (v: unknown): string | null =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.trim().length <= 40 &&
  !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/.test(v)
    ? v.trim()
    : null;
const emptyTokenSymbols = (): PaperTokenSymbols => ({
  schema_version: "solana-paper-token-symbols/1",
  run_id: null,
  source: "DEX Screener",
  metadata_only: true,
  symbols: {},
});
/** Exact Solana chain + mint match only. Conflicting symbols remain Unknown. */
export function symbolsFromDexPairs(value: unknown, mints: string[]): Record<string, string | null> {
  if (!Array.isArray(value) || value.length > 5000 || mints.length > 30 || mints.some((m) => !isSolanaMint(m)))
    throw Error("metadata");
  const found = new Map(mints.map((m) => [m, new Set<string | null>()]));
  for (const item of value) {
    if (!item || typeof item !== "object" || item.chainId !== "solana") continue;
    for (const token of [item.baseToken, item.quoteToken]) {
      if (!token || typeof token !== "object" || !found.has(token.address)) continue;
      found.get(token.address)!.add(safeTokenSymbol(token.symbol));
    }
  }
  return Object.fromEntries([...found].map(([mint, values]) => [mint, values.size === 1 ? [...values][0] : null]));
}
export function publicPaperTokenSymbols(value: unknown): PaperTokenSymbols {
  if (!value || typeof value !== "object") throw Error("metadata");
  const v = value as PaperTokenSymbols;
  if (
    v.schema_version !== "solana-paper-token-symbols/1" ||
    v.source !== "DEX Screener" ||
    v.metadata_only !== true ||
    (v.run_id !== null && (typeof v.run_id !== "string" || v.run_id.length > 200)) ||
    !v.symbols ||
    typeof v.symbols !== "object" ||
    Array.isArray(v.symbols)
  )
    throw Error("metadata");
  const entries = Object.entries(v.symbols);
  if (
    entries.length > 1000 ||
    entries.some(([mint, symbol]) => !isSolanaMint(mint) || (symbol !== null && safeTokenSymbol(symbol) !== symbol))
  )
    throw Error("metadata");
  return { ...emptyTokenSymbols(), run_id: v.run_id, symbols: Object.fromEntries(entries) };
}
/** Warm-instance bounded cache. No shared in-flight promises, keys, caller URLs or caller mint lists. */
export function createPaperSymbolService(fetchFn: typeof fetch = (input, init) => fetch(input, init), now = Date.now) {
  const cache = new Map<string, { symbol: string | null; at: number }>();
  let nextReadAt = 0,
    busy = false,
    snapshot = emptyTokenSymbols();
  return async (signal: AbortSignal): Promise<PaperTokenSymbols> => {
    const at = now();
    if (signal.aborted) return emptyTokenSymbols();
    if (busy || at < nextReadAt) return snapshot;
    busy = true;
    nextReadAt = at + 60_000;
    const read = async (url: string) => {
      const response = await fetchFn(url, {
        method: "GET",
        signal,
        credentials: "omit",
        redirect: "manual",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (
        response.type === "opaqueredirect" ||
        (response.status >= 300 && response.status < 400) ||
        !response.ok ||
        !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")
      )
        throw Error("metadata");
      return boundedJson(response, signal);
    };
    try {
      const history = publicPaperHistory(
        await read("https://solana-paper-pilot-production.up.railway.app/solana-paper-history"),
      );
      const mints = [...new Set((history.copied_trades_as_of ?? []).map((t) => t.mint).filter(isSolanaMint))].slice(
        0,
        1000,
      );
      const missing = mints
        .filter((m) => {
          const c = cache.get(m);
          return !c || at < c.at || at - c.at >= 600_000;
        })
        .slice(0, 30);
      if (missing.length) {
        let symbols: Record<string, string | null> = Object.fromEntries(missing.map((m) => [m, null]));
        try {
          symbols = symbolsFromDexPairs(
            await read(`https://api.dexscreener.com/tokens/v1/solana/${missing.join(",")}`),
            missing,
          );
        } catch {
          /* Unknown is display-only and never affects the monitor. */
        }
        if (signal.aborted) return emptyTokenSymbols();
        for (const mint of missing) {
          cache.delete(mint);
          cache.set(mint, { symbol: symbols[mint] ?? null, at });
        }
        while (cache.size > 1000) cache.delete(cache.keys().next().value!);
      }
      if (signal.aborted) return emptyTokenSymbols();
      snapshot = {
        ...emptyTokenSymbols(),
        run_id: history.run_id,
        symbols: Object.fromEntries(
          mints.map((m) => {
            const c = cache.get(m);
            return [m, c && at >= c.at && at - c.at < 600_000 ? c.symbol : null];
          }),
        ),
      };
      return snapshot;
    } catch {
      return emptyTokenSymbols();
    } finally {
      busy = false;
    }
  };
}
const readPaperSymbols = createPaperSymbolService();
export const getSolanaPaperTokenSymbols = createServerFn({ method: "GET" }).handler(async (): Promise<Response> => {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  setResponseHeaders(headers);
  const controller = new AbortController(),
    signal = getRequest().signal;
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 8000);
  try {
    return new Response(JSON.stringify(await readPaperSymbols(controller.signal)), { headers });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
});
export async function loadSolanaPaperTokenSymbols(signal: AbortSignal): Promise<PaperTokenSymbols> {
  try {
    const response = await getSolanaPaperTokenSymbols({ signal });
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || ""))
      throw Error("metadata");
    return publicPaperTokenSymbols(await boundedJson(response, signal));
  } catch {
    return emptyTokenSymbols();
  }
}
