// B4x4 order-book shadow COLLECTOR (server-only).
//
// Captures the pre-boundary OKX BTC-USDT book + public-trade buffer for the
// next 15-minute target and persists it as an immutable snapshot. Shadow only:
// nothing here may block, delay or influence B4x4.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  B4X4_OB_INSTRUMENT,
  B4X4_OB_PROVIDER,
  B4X4_OB_SHADOW_VERSION,
  type Book,
  type Trade,
} from "./orderbook";

const TF_MS = 15 * 60 * 1000;
// A pre-warm request can arrive about one minute before the boundary. Keep
// that snapshot as a fallback, but permit a later prediction-window request
// to replace it with a materially fresher pre-cutoff event.
const IMMUTABLE_CAPTURE_AGE_MS = 30_000;
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
  return {
    book: { bids, asks },
    eventTsMs: Number(row.ts),
    seqId: row.seqId != null ? String(row.seqId) : null,
    prevSeqId: row.prevSeqId != null ? String(row.prevSeqId) : null,
    complete: bids.length >= 20 && asks.length >= 20,
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
  error_code: string | null;
  error_message: string | null;
}

/**
 * Capture the pre-boundary snapshot for `targetMs`. Idempotent per target:
 * the first valid capture is immutable; retries only overwrite an errored /
 * empty capture, and only with events still before the original cutoff.
 */
export async function captureB4x4PreBoundarySnapshot(
  supabase: SupabaseClient,
  targetMs: number,
): Promise<{ status: string; target: string; event_ts: string | null; age_ms: number | null }> {
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
    if (age >= 0 && age <= IMMUTABLE_CAPTURE_AGE_MS) {
      return { status: "already_captured", target: targetIso, event_ts: prior.event_ts, age_ms: age };
    }
  }

  let row: SnapshotRow = {
    target_candle_ts: targetIso,
    provider: B4X4_OB_PROVIDER,
    instrument: B4X4_OB_INSTRUMENT,
    shadow_version: B4X4_OB_SHADOW_VERSION,
    captured_at: new Date().toISOString(),
    event_ts: null,
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
    error_code: "COLLECTOR_ERROR",
    error_message: null,
  };

  try {
    const [book, trades] = await Promise.all([fetchOkxBook(), fetchOkxTrades()]);
    if (!book) {
      row.error_message = "okx_book_unreachable";
    } else if (book.eventTsMs > cutoff) {
      // Post-cutoff event may never be represented as the prediction-time snapshot.
      row.error_code = "POST_CUTOFF_EVENT";
      row.error_message = `event_ts ${new Date(book.eventTsMs).toISOString()} > cutoff`;
    } else {
      // Merge retained pre-cutoff trades from the previous target's buffer so
      // the longer windows can be complete. Every retained event stays < cutoff.
      const retained = await loadRetainedTrades(supabase, targetMs);
      const fresh = (trades ?? []).filter((t) => t.ts <= cutoff);
      const merged = dedupeTrades([...retained, ...fresh]).filter((t) => t.ts <= cutoff);
      const startTs = merged.length ? Math.min(...merged.map((t) => t.ts)) : null;
      const gapCount = book.prevSeqId != null && book.seqId != null && book.prevSeqId === "-1" ? 1 : 0;
      row = {
        ...row,
        event_ts: new Date(book.eventTsMs).toISOString(),
        book_json: book.book,
        trades_json: merged,
        seq_id: book.seqId,
        prev_seq_id: book.prevSeqId,
        book_complete: book.complete && trades != null,
        sequence_gap: gapCount > 0,
        sequence_gap_count: gapCount,
        trade_window_start_ts: startTs ? new Date(startTs).toISOString() : null,
        trade_event_count: merged.length,
        error_code: null,
        error_message: null,
      };
    }
  } catch (e) {
    row.error_message = e instanceof Error ? e.message : String(e);
  }

  await supabase
    .from("b4x4_ob_snapshots")
    .upsert(row as never, { onConflict: "target_candle_ts" });

  return {
    status: row.error_code ?? "captured",
    target: targetIso,
    event_ts: row.event_ts,
    age_ms: row.event_ts ? cutoff - new Date(row.event_ts).getTime() : null,
  };
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
