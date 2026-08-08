// B4x4 order-book shadow COLLECTOR (server-only).
//
// Captures the pre-boundary OKX BTC-USDT book + public-trade buffer for the
// next 15-minute target and persists it as an immutable snapshot. Shadow only:
// nothing here may block, delay or influence B4x4.
//
// Freshness contract (b4x4-v1-grid768-obfresh-fix1): a snapshot is only a
// valid final capture when its exchange event timestamp AND its local receipt
// timestamp are both at or before T-1ms and its age is <= 2,000 ms. Early
// prewarm captures (~20 s before the boundary) remain useful for priming the
// trade buffer, but can never be promoted to a valid final capture.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  B4X4_OB_INSTRUMENT,
  B4X4_OB_MAX_SNAPSHOT_AGE_MS,
  B4X4_OB_PROVIDER,
  B4X4_OB_SHADOW_VERSION,
  type Book,
  type Trade,
} from "./orderbook";

const TF_MS = 15 * 60 * 1000;
/** Attempt offsets before the boundary, in ms. Freshest successful one wins. */
export const B4X4_OB_ATTEMPT_OFFSETS_MS = [5_000, 2_000, 750];
const OKX_BASE = () => process.env.OKX_REST_BASE_URL || "https://www.okx.com";

export function nextTargetBoundaryMs(nowMs = Date.now()): number {
  return Math.ceil(nowMs / TF_MS) * TF_MS;
}

/** Prediction-time cutoff for target T. */
export function cutoffMsFor(targetMs: number): number {
  return targetMs - 1;
}

async function okxJson(url: string, timeoutMs = 4000): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as { code?: string; data?: unknown };
    if (json.code && json.code !== "0") return null;
    return json.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface RawBook {
  book: Book;
  eventTsMs: number;
  seqId: string | null;
  prevSeqId: string | null;
  complete: boolean;
  crossed: boolean;
}

export async function fetchOkxBook(): Promise<RawBook | null> {
  const data = (await okxJson(
    `${OKX_BASE()}/api/v5/market/books?instId=${B4X4_OB_INSTRUMENT}&sz=400`,
  )) as Array<{ asks: string[][]; bids: string[][]; ts: string; seqId?: string; prevSeqId?: string }> | null;
  const row = data?.[0];
  if (!row?.bids?.length || !row?.asks?.length) return null;
  const toLevels = (rows: string[][]) =>
    rows.map((r) => ({ price: Number(r[0]), qty: Number(r[1]) })).filter((l) => Number.isFinite(l.price) && Number.isFinite(l.qty));
  const bids = toLevels(row.bids);
  const asks = toLevels(row.asks);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  return {
    book: { bids, asks },
    eventTsMs: Number(row.ts),
    seqId: row.seqId != null ? String(row.seqId) : null,
    prevSeqId: row.prevSeqId != null ? String(row.prevSeqId) : null,
    complete: bids.length >= 20 && asks.length >= 20,
    crossed: bestBid != null && bestAsk != null && bestBid >= bestAsk,
  };
}

export async function fetchOkxTrades(): Promise<Trade[] | null> {
  const data = (await okxJson(
    `${OKX_BASE()}/api/v5/market/trades?instId=${B4X4_OB_INSTRUMENT}&limit=500`,
  )) as Array<{ ts: string; px: string; sz: string; side: "buy" | "sell" }> | null;
  if (!data) return null;
  return data
    .map((t) => ({ ts: Number(t.ts), price: Number(t.px), size: Number(t.sz), side: t.side }))
    .filter((t) => Number.isFinite(t.ts) && Number.isFinite(t.price) && Number.isFinite(t.size));
}

interface SnapshotRow {
  target_candle_ts: string;
  provider: string;
  instrument: string;
  shadow_version: string;
  captured_at: string;
  event_ts: string | null;
  local_receipt_ts: string | null;
  cutoff_ts: string;
  feature_cutoff_ts: string;
  book_json: unknown;
  trades_json: unknown;
  seq_id: string | null;
  prev_seq_id: string | null;
  book_complete: boolean | null;
  sequence_gap: boolean | null;
  sequence_gap_count: number | null;
  trade_window_start_ts: string | null;
  trade_event_count: number | null;
  trade_window_complete: boolean | null;
  capture_attempt_count: number | null;
  capture_attempts_json: unknown;
  chosen_attempt_id: string | null;
  capture_error_list: unknown;
  error_code: string | null;
  error_message: string | null;
}

export interface AttemptAudit {
  attempt_id: string;
  planned_offset_ms: number | null;
  requested_at: string;
  completed_at: string;
  event_ts: string | null;
  age_ms: number | null;
  received_before_cutoff: boolean;
  book_complete: boolean | null;
  crossed: boolean | null;
  trades_available: boolean;
  result: "OK" | "POST_CUTOFF_EVENT" | "LATE_RESPONSE" | "UNREACHABLE" | "ERROR";
  error: string | null;
}

interface AttemptOutcome {
  audit: AttemptAudit;
  book: RawBook | null;
  trades: Trade[] | null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** One signed-in-time capture attempt. Never throws. */
export async function runCaptureAttempt(
  attemptId: string,
  cutoffMs: number,
  plannedOffsetMs: number | null,
): Promise<AttemptOutcome> {
  const requestedAt = Date.now();
  try {
    const [book, trades] = await Promise.all([fetchOkxBook(), fetchOkxTrades()]);
    const completedAt = Date.now();
    const base = {
      attempt_id: attemptId,
      planned_offset_ms: plannedOffsetMs,
      requested_at: new Date(requestedAt).toISOString(),
      completed_at: new Date(completedAt).toISOString(),
      received_before_cutoff: completedAt <= cutoffMs,
      trades_available: Array.isArray(trades),
    };
    if (!book) {
      return {
        audit: { ...base, event_ts: null, age_ms: null, book_complete: null, crossed: null, result: "UNREACHABLE", error: "okx_book_unreachable" },
        book: null,
        trades,
      };
    }
    const ageMs = cutoffMs - book.eventTsMs;
    let result: AttemptAudit["result"] = "OK";
    if (book.eventTsMs > cutoffMs) result = "POST_CUTOFF_EVENT";
    else if (completedAt > cutoffMs) result = "LATE_RESPONSE";
    return {
      audit: {
        ...base,
        event_ts: new Date(book.eventTsMs).toISOString(),
        age_ms: ageMs,
        book_complete: book.complete,
        crossed: book.crossed,
        result,
        error: null,
      },
      book,
      trades,
    };
  } catch (e) {
    const completedAt = Date.now();
    return {
      audit: {
        attempt_id: attemptId,
        planned_offset_ms: plannedOffsetMs,
        requested_at: new Date(requestedAt).toISOString(),
        completed_at: new Date(completedAt).toISOString(),
        event_ts: null,
        age_ms: null,
        received_before_cutoff: completedAt <= cutoffMs,
        book_complete: null,
        crossed: null,
        trades_available: false,
        result: "ERROR",
        error: e instanceof Error ? e.message : String(e),
      },
      book: null,
      trades: null,
    };
  }
}

function usableAsFinal(o: AttemptOutcome): boolean {
  return (
    o.book != null &&
    o.audit.result === "OK" &&
    o.audit.received_before_cutoff &&
    o.audit.age_ms != null &&
    o.audit.age_ms >= 0
  );
}

export interface CaptureOptions {
  /** Attempt offsets before the boundary (ms). Defaults to the frozen ladder. */
  offsetsMs?: number[];
  /** Priming-only run (early prewarm): a single opportunistic attempt. */
  priming?: boolean;
  /** Test seam: overrides Date.now-based scheduling waits. */
  noWait?: boolean;
}

function dedupeTrades(trades: Trade[]): Trade[] {
  const seen = new Set<string>();
  const out: Trade[] = [];
  for (const t of trades) {
    const k = `${t.ts}|${t.price}|${t.size}|${t.side}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** Trades retained from the previous target's snapshot within the last 15m. */
async function loadRetainedTrades(supabase: SupabaseClient, targetMs: number): Promise<Trade[]> {
  const { data } = await supabase
    .from("b4x4_ob_snapshots")
    .select("trades_json")
    .lt("target_candle_ts", new Date(targetMs).toISOString())
    .order("target_candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  const raw = (data as { trades_json?: Trade[] } | null)?.trades_json;
  if (!Array.isArray(raw)) return [];
  const floor = targetMs - 20 * 60 * 1000;
  return raw.filter((t) => Number.isFinite(t?.ts) && t.ts >= floor);
}

/**
 * Capture the pre-boundary snapshot for `targetMs`.
 *
 * Runs several attempts near the boundary and keeps the freshest successful
 * one whose event AND local receipt are strictly before the cutoff. An
 * existing genuinely-fresh capture (age <= 2,000 ms) is immutable; a stale or
 * errored capture may be replaced by a fresher pre-cutoff attempt.
 */
export async function captureB4x4PreBoundarySnapshot(
  supabase: SupabaseClient,
  targetMs: number,
  opts: CaptureOptions = {},
): Promise<{
  status: string;
  target: string;
  event_ts: string | null;
  age_ms: number | null;
  attempts: number;
  attempt_audit: AttemptAudit[];
}> {
  const targetIso = new Date(targetMs).toISOString();
  const cutoff = cutoffMsFor(targetMs);
  const cutoffIso = new Date(cutoff).toISOString();

  const { data: existing } = await supabase
    .from("b4x4_ob_snapshots")
    .select("id, event_ts, error_code")
    .eq("target_candle_ts", targetIso)
    .maybeSingle();
  const prior = existing as { id: string; event_ts: string | null; error_code: string | null } | null;
  if (prior?.event_ts && !prior.error_code) {
    const age = cutoff - new Date(prior.event_ts).getTime();
    // Only a genuinely fresh capture is immutable. A ~19s-old prewarm snapshot
    // must remain replaceable by a real near-boundary attempt.
    if (age >= 0 && age <= B4X4_OB_MAX_SNAPSHOT_AGE_MS) {
      return {
        status: "already_captured", target: targetIso, event_ts: prior.event_ts,
        age_ms: age, attempts: 0, attempt_audit: [],
      };
    }
  }

  const offsets = opts.priming
    ? [Math.max(0, targetMs - Date.now())]
    : (opts.offsetsMs ?? B4X4_OB_ATTEMPT_OFFSETS_MS);

  const audits: AttemptAudit[] = [];
  let best: AttemptOutcome | null = null;
  let latestTrades: Trade[] | null = null;

  for (let n = 0; n < offsets.length; n++) {
    const offset = offsets[n]!;
    const fireAt = targetMs - offset;
    if (!opts.noWait) {
      const wait = fireAt - Date.now();
      // Skip an attempt slot whose window has already passed by a wide margin.
      if (wait > 0) await sleep(Math.min(wait, 30_000));
    }
    if (Date.now() > cutoff) break;
    const outcome = await runCaptureAttempt(`a${n + 1}`, cutoff, opts.priming ? null : offset);
    audits.push(outcome.audit);
    if (outcome.trades) latestTrades = outcome.trades;
    if (usableAsFinal(outcome)) {
      if (!best || (outcome.audit.age_ms ?? Infinity) < (best.audit.age_ms ?? Infinity)) {
        best = outcome;
      }
      // Already inside the freshness budget — no need to keep hammering OKX.
      if ((outcome.audit.age_ms ?? Infinity) <= B4X4_OB_MAX_SNAPSHOT_AGE_MS) {
        if (n < offsets.length - 1 && Date.now() < targetMs - 1_500) continue;
      }
    }
  }

  const errorList = audits.filter((a) => a.result !== "OK").map((a) => ({
    attempt_id: a.attempt_id, result: a.result, error: a.error,
  }));

  let row: SnapshotRow = {
    target_candle_ts: targetIso,
    provider: B4X4_OB_PROVIDER,
    instrument: B4X4_OB_INSTRUMENT,
    shadow_version: B4X4_OB_SHADOW_VERSION,
    captured_at: new Date().toISOString(),
    event_ts: null,
    local_receipt_ts: null,
    cutoff_ts: cutoffIso,
    feature_cutoff_ts: cutoffIso,
    book_json: null,
    trades_json: null,
    seq_id: null,
    prev_seq_id: null,
    book_complete: null,
    sequence_gap: null,
    sequence_gap_count: null,
    trade_window_start_ts: null,
    trade_event_count: null,
    trade_window_complete: null,
    capture_attempt_count: audits.length,
    capture_attempts_json: audits,
    chosen_attempt_id: null,
    capture_error_list: errorList,
    error_code: "COLLECTOR_ERROR",
    error_message: audits.length === 0 ? "no_attempt_window" : (errorList[0]?.error ?? "no_valid_preboundary_attempt"),
  };

  if (best?.book) {
    // Merge retained pre-cutoff trades from the previous target's buffer so
    // the longer windows can be complete. Every retained event stays < cutoff.
    const retained = await loadRetainedTrades(supabase, targetMs);
    const fresh = (best.trades ?? latestTrades ?? []).filter((t) => t.ts <= cutoff);
    const merged = dedupeTrades([...retained, ...fresh]).filter((t) => t.ts <= cutoff);
    const startTs = merged.length ? Math.min(...merged.map((t) => t.ts)) : null;
    const gapCount = best.book.prevSeqId != null && best.book.seqId != null && best.book.prevSeqId === "-1" ? 1 : 0;
    // Trade-window completeness is independent from book validity.
    const tradesUsable = best.trades != null || latestTrades != null;
    row = {
      ...row,
      event_ts: best.audit.event_ts,
      local_receipt_ts: best.audit.completed_at,
      book_json: best.book.book,
      trades_json: tradesUsable ? merged : null,
      seq_id: best.book.seqId,
      prev_seq_id: best.book.prevSeqId,
      book_complete: best.book.complete && !best.book.crossed,
      sequence_gap: gapCount > 0,
      sequence_gap_count: gapCount,
      trade_window_start_ts: tradesUsable && startTs ? new Date(startTs).toISOString() : null,
      trade_event_count: tradesUsable ? merged.length : null,
      trade_window_complete: tradesUsable
        ? startTs != null && startTs <= targetMs - 15 * 60 * 1000
        : false,
      chosen_attempt_id: best.audit.attempt_id,
      error_code: null,
      error_message: null,
    };
  }

  await supabase
    .from("b4x4_ob_snapshots")
    .upsert(row as never, { onConflict: "target_candle_ts" });

  return {
    status: row.error_code ?? "captured",
    target: targetIso,
    event_ts: row.event_ts,
    age_ms: row.event_ts ? cutoff - new Date(row.event_ts).getTime() : null,
    attempts: audits.length,
    attempt_audit: audits,
  };
}
