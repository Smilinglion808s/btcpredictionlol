// Server-only candle ingest + partial-candle fetch. Imported by server fns and the cron route.
import type { SupabaseClient } from "@supabase/supabase-js";

interface OkxCandleRow {
  ts: string;
  o: string;
  h: string;
  l: string;
  c: string;
  vol: string;
  volCcyQuote: string;
  confirm: string;
}

export interface NormalizedCandle {
  symbol: string;
  timeframe: string;
  candle_ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volume_quote: number;
  confirm: boolean;
  fetch_source: "okx" | "coinbase";
  raw: unknown;
}

export interface ClosedCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  confirm: boolean;
}

export interface PartialCandle {
  start_ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  minutes_elapsed: number;
  source: "okx" | "coinbase";
}

const SYMBOL = "BTC-USDT";
const TF = "15m";
const TF_MS = 15 * 60 * 1000;

function normalizeOkxRow(row: string[]): NormalizedCandle {
  const [ts, o, h, l, c, vol, , volCcyQuote, confirm] = row;
  return {
    symbol: SYMBOL,
    timeframe: TF,
    candle_ts: new Date(Number(ts)).toISOString(),
    open: Number(o),
    high: Number(h),
    low: Number(l),
    close: Number(c),
    volume: Number(vol),
    volume_quote: Number(volCcyQuote ?? 0),
    confirm: confirm === "1",
    fetch_source: "okx",
    raw: row,
  };
}

function normalizeCoinbaseRow(row: [number, number, number, number, number, number]): NormalizedCandle {
  const [t, low, high, open, close, volume] = row;
  return {
    symbol: SYMBOL,
    timeframe: TF,
    candle_ts: new Date(t * 1000).toISOString(),
    open,
    high,
    low,
    close,
    volume,
    volume_quote: 0,
    // Coinbase doesn't return confirm — assume closed if the window ended.
    confirm: Date.now() >= t * 1000 + TF_MS,
    fetch_source: "coinbase",
    raw: row,
  };
}

// ------------------------- OKX fetchers -------------------------

async function tryOkxCandles(): Promise<{ candles: NormalizedCandle[]; status: number; error?: string }> {
  const base = process.env.OKX_REST_BASE_URL || "https://www.okx.com";
  const url = `${base}/api/v5/market/candles?instId=${SYMBOL}&bar=${TF}&limit=200`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429) {
      return { candles: [], status: 429, error: `OKX 429 rate-limited` };
    }
    if (!res.ok) {
      return { candles: [], status: res.status, error: `OKX HTTP ${res.status}: ${await res.text()}` };
    }
    const json = (await res.json()) as { code: string; msg: string; data: string[][] };
    if (json.code !== "0") {
      return { candles: [], status: 200, error: `OKX error ${json.code}: ${json.msg}` };
    }
    return { candles: json.data.map(normalizeOkxRow), status: 200 };
  } catch (e) {
    return { candles: [], status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function tryCoinbaseCandles(): Promise<{ candles: NormalizedCandle[]; status: number; error?: string }> {
  const end = new Date();
  const start = new Date(end.getTime() - 200 * TF_MS);
  const url = new URL("https://api.exchange.coinbase.com/products/BTC-USD/candles");
  url.searchParams.set("granularity", "900");
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("end", end.toISOString());
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (compatible; BTC15mBot/1.0; +https://btcpredictionlol.lovable.app)",
      },
    });
    if (!res.ok) {
      return { candles: [], status: res.status, error: `Coinbase HTTP ${res.status}: ${await res.text()}` };
    }
    const rows = (await res.json()) as Array<[number, number, number, number, number, number]>;
    return { candles: rows.map(normalizeCoinbaseRow), status: 200 };
  } catch (e) {
    return { candles: [], status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchOkxClosedCandle(candleTs: string): Promise<ClosedCandle | null> {
  const base = process.env.OKX_REST_BASE_URL || "https://www.okx.com";
  const targetMs = new Date(candleTs).getTime();
  const url = `${base}/api/v5/market/candles?instId=${SYMBOL}&bar=${TF}&limit=200`;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`OKX HTTP ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { code: string; msg: string; data: string[][] };
      if (json.code !== "0") throw new Error(`OKX error ${json.code}: ${json.msg}`);
      const row = json.data.find((r) => Number(r[0]) === targetMs);
      if (!row) return null;
      const candle = normalizeOkxRow(row);
      if (!candle.confirm) return null;
      return { open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, confirm: candle.confirm };
    } catch {
      await new Promise((res) => setTimeout(res, 400 * (i + 1)));
    }
  }
  return null;
}

/**
 * Backwards-compat wrapper. New code should use `buildPartialCandleContext`
 * which returns full provenance + attempt diagnostics.
 */
export async function fetchCurrentPartialCandle(): Promise<PartialCandle | null> {
  const ctx = await buildPartialCandleContext();
  return ctx.snapshot;
}

async function tryBinancePartial(currentStart: number, minutesElapsed: number): Promise<{ partial: PartialCandle | null; status: number; error?: string }> {
  const url = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=2";
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return { partial: null, status: res.status, error: `Binance HTTP ${res.status}` };
    const rows = (await res.json()) as Array<[number, string, string, string, string, string]>;
    const row = rows.find((r) => Number(r[0]) === currentStart);
    if (!row) return { partial: null, status: 200, error: "Binance: no row at currentStart" };
    return {
      partial: {
        start_ts: new Date(currentStart).toISOString(),
        open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]),
        volume: Number(row[5]),
        minutes_elapsed: minutesElapsed,
        source: "okx" as PartialCandle["source"], // schema restricts, tag path separately
      },
      status: 200,
    };
  } catch (e) {
    return { partial: null, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function trySpotSynthesizedPartial(
  currentStart: number,
  minutesElapsed: number,
  lastClosedClose: number | null,
): Promise<{ partial: PartialCandle | null; status: number; error?: string }> {
  const sources: Array<{ label: PartialCandle["source"]; url: string; extract: (j: unknown) => number | null }> = [
    { label: "coinbase", url: "https://api.exchange.coinbase.com/products/BTC-USD/ticker", extract: (j) => Number((j as { price?: string }).price ?? NaN) },
    { label: "okx", url: "https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT", extract: (j) => Number((j as { data?: Array<{ last?: string }> }).data?.[0]?.last ?? NaN) },
  ];
  const errors: string[] = [];
  for (const s of sources) {
    try {
      const r = await fetch(s.url, { headers: { accept: "application/json", "user-agent": "BTC15mBot/1.0" } });
      if (!r.ok) { errors.push(`${s.label} ${r.status}`); continue; }
      const j = await r.json();
      const price = s.extract(j);
      if (!Number.isFinite(price) || !price || (price as number) <= 0) { errors.push(`${s.label} invalid price`); continue; }
      const open = lastClosedClose && Number.isFinite(lastClosedClose) ? lastClosedClose : (price as number);
      const high = Math.max(open, price as number);
      const low = Math.min(open, price as number);
      return {
        partial: {
          start_ts: new Date(currentStart).toISOString(),
          open, high, low, close: price as number, volume: 0,
          minutes_elapsed: minutesElapsed,
          source: s.label,
        },
        status: 200,
      };
    } catch (e) {
      errors.push(`${s.label} ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { partial: null, status: 0, error: `spot ticker: ${errors.join(" | ")}` };
}

/**
 * Ordered partial-candle lookup with full provenance:
 *   1. DB unconfirmed row (populated by fetch phase seconds earlier)
 *   2. OKX live /market/candles
 *   3. Binance live /klines
 *   4. Coinbase live /candles
 *   5. Synthesized from spot ticker (open = last closed close, close = ticker)
 * The snapshot is only null when every source failed.
 */
// Maximum acceptable drift between a partial's `open` and the last-confirmed
// candle's `close`. Mirrors PARTIAL_OPEN_DRIFT_MAX in model6/config.ts so a
// snapshot we accept here will not later trip the featureEngine feed-mismatch
// gate. Kept as a local constant to avoid a cross-package import.
const PARTIAL_OPEN_DRIFT_TOL = 0.003;

function openMatchesLastClose(open: number, lastClose: number | null): boolean {
  if (lastClose == null || !Number.isFinite(lastClose) || lastClose <= 0) return true;
  return Math.abs(open - lastClose) / lastClose <= PARTIAL_OPEN_DRIFT_TOL;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function buildPartialCandleContext(
  supabase?: SupabaseClient,
): Promise<{
  snapshot: PartialCandle | null;
  path: "db_unconfirmed" | "okx_live" | "binance_live" | "coinbase_live" | "synthesized_from_spot" | "unavailable";
  attempts: Array<{ source: string; ok: boolean; status?: number; reason?: string }>;
  synthesized: boolean;
  last_closed_close: number | null;
  root_cause?: string;
}> {
  const now = Date.now();
  const currentStart = Math.floor(now / TF_MS) * TF_MS;
  const minutesElapsed = Math.min(15, Math.floor((now - currentStart) / 60_000));
  const attempts: Array<{ source: string; ok: boolean; status?: number; reason?: string }> = [];
  let lastClosedClose: number | null = null;

  // Load last-confirmed close up front so every source path can validate against it.
  if (supabase) {
    try {
      const { data: lastClosed } = await supabase
        .from("candles").select("close")
        .eq("symbol", SYMBOL).eq("timeframe", TF).eq("confirm", true)
        .order("candle_ts", { ascending: false }).limit(1).maybeSingle();
      if (lastClosed) lastClosedClose = Number(lastClosed.close);
    } catch { /* non-fatal */ }
  }

  if (supabase) {
    try {
      const startIso = new Date(currentStart).toISOString();
      const { data, error } = await supabase
        .from("candles")
        .select("candle_ts, open, high, low, close, volume, confirm, fetch_source")
        .eq("symbol", SYMBOL).eq("timeframe", TF).eq("candle_ts", startIso)
        .maybeSingle();
      if (error) attempts.push({ source: "db", ok: false, reason: error.message });
      else if (data && data.confirm === false) {
        const dbOpen = Number(data.open);
        if (openMatchesLastClose(dbOpen, lastClosedClose)) {
          attempts.push({ source: "db", ok: true });
          return {
            snapshot: {
              start_ts: new Date(data.candle_ts as string).toISOString(),
              open: dbOpen, high: Number(data.high), low: Number(data.low),
              close: Number(data.close), volume: Number(data.volume ?? 0),
              minutes_elapsed: minutesElapsed,
              source: ((data.fetch_source as string) === "coinbase" ? "coinbase" : "okx"),
            },
            path: "db_unconfirmed", attempts, synthesized: false, last_closed_close: lastClosedClose,
          };
        }
        // Stale/inconsistent DB row — reject and fall through to live sources.
        attempts.push({
          source: "db", ok: false,
          reason: `stale_open drift=${(Math.abs(dbOpen - (lastClosedClose ?? dbOpen)) / (lastClosedClose ?? 1)).toFixed(5)} db_open=${dbOpen} last_close=${lastClosedClose}`,
        });
      } else {
        attempts.push({ source: "db", ok: false, reason: data ? "row is confirmed, no partial yet" : "no row at currentStart" });
      }
    } catch (e) {
      attempts.push({ source: "db", ok: false, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  // Bounded retry across live sources. Two passes with a short backoff give
  // the upstream feed a chance to serve the current-forming candle without
  // ever waiting long enough to miss the boundary.
  for (let attempt = 0; attempt < 2; attempt++) {
    const okx = await tryOkxCandles();
    if (okx.candles.length) {
      const partial = okx.candles.find((c) => new Date(c.candle_ts).getTime() === currentStart && !c.confirm);
      if (partial && openMatchesLastClose(partial.open, lastClosedClose)) {
        attempts.push({ source: "okx_live", ok: true, status: okx.status });
        return {
          snapshot: {
            start_ts: partial.candle_ts,
            open: partial.open, high: partial.high, low: partial.low, close: partial.close, volume: partial.volume,
            minutes_elapsed: minutesElapsed, source: "okx",
          },
          path: "okx_live", attempts, synthesized: false, last_closed_close: lastClosedClose,
        };
      }
      attempts.push({
        source: "okx_live", ok: false, status: okx.status,
        reason: partial ? `open_drift open=${partial.open} last_close=${lastClosedClose}` : "no unconfirmed row at currentStart",
      });
    } else {
      attempts.push({ source: "okx_live", ok: false, status: okx.status, reason: okx.error ?? "empty response" });
    }

    const bn = await tryBinancePartial(currentStart, minutesElapsed);
    if (bn.partial && openMatchesLastClose(bn.partial.open, lastClosedClose)) {
      attempts.push({ source: "binance_live", ok: true, status: bn.status });
      return { snapshot: bn.partial, path: "binance_live", attempts, synthesized: false, last_closed_close: lastClosedClose };
    }
    attempts.push({
      source: "binance_live", ok: false, status: bn.status,
      reason: bn.partial ? `open_drift open=${bn.partial.open} last_close=${lastClosedClose}` : bn.error,
    });

    const cb = await tryCoinbaseCandles();
    if (cb.candles.length) {
      const partial = cb.candles.find((c) => new Date(c.candle_ts).getTime() === currentStart);
      if (partial && openMatchesLastClose(partial.open, lastClosedClose)) {
        attempts.push({ source: "coinbase_live", ok: true, status: cb.status });
        return {
          snapshot: {
            start_ts: partial.candle_ts,
            open: partial.open, high: partial.high, low: partial.low, close: partial.close, volume: partial.volume,
            minutes_elapsed: minutesElapsed, source: "coinbase",
          },
          path: "coinbase_live", attempts, synthesized: false, last_closed_close: lastClosedClose,
        };
      }
      attempts.push({
        source: "coinbase_live", ok: false, status: cb.status,
        reason: partial ? `open_drift open=${partial.open} last_close=${lastClosedClose}` : "no row at currentStart",
      });
    } else {
      attempts.push({ source: "coinbase_live", ok: false, status: cb.status, reason: cb.error ?? "empty response" });
    }

    if (attempt === 0) await sleep(400);
  }

  const synth = await trySpotSynthesizedPartial(currentStart, minutesElapsed, lastClosedClose);
  if (synth.partial) {
    attempts.push({ source: "spot_synth", ok: true });
    return { snapshot: synth.partial, path: "synthesized_from_spot", attempts, synthesized: true, last_closed_close: lastClosedClose };
  }
  attempts.push({ source: "spot_synth", ok: false, reason: synth.error });

  // Classify why we ended up empty so api_runs makes the root cause obvious.
  const anyOpenDrift = attempts.some((a) => (a.reason ?? "").includes("open_drift") || (a.reason ?? "").includes("stale_open"));
  const anyLiveFail = attempts.some((a) => !a.ok && (a.source === "okx_live" || a.source === "binance_live" || a.source === "coinbase_live"));
  const rootCause = anyOpenDrift
    ? "all_sources_open_drift"
    : anyLiveFail
      ? "live_sources_unavailable"
      : "no_partial_yet";
  return { snapshot: null, path: "unavailable", attempts, synthesized: false, last_closed_close: lastClosedClose, root_cause: rootCause };
}

/**
 * Fetch + upsert candles with OKX primary, Coinbase fallback. Returns the
 * latest ~200 rows sorted ascending, plus provenance metadata so callers can
 * see which source served the run.
 */
export async function fetchAndUpsertCandles(supabase: SupabaseClient): Promise<{
  candles: Array<Record<string, unknown>>;
  primary_source: "okx" | "coinbase" | null;
  attempts: Array<{ source: string; status: number; error?: string; rows: number }>;
}> {
  const started = Date.now();
  const attempts: Array<{ source: string; status: number; error?: string; rows: number }> = [];
  let normalized: NormalizedCandle[] = [];
  let primary: "okx" | "coinbase" | null = null;

  const okx = await tryOkxCandles();
  attempts.push({ source: "okx", status: okx.status, error: okx.error, rows: okx.candles.length });
  if (okx.candles.length) {
    normalized = okx.candles;
    primary = "okx";
  } else {
    const cb = await tryCoinbaseCandles();
    attempts.push({ source: "coinbase", status: cb.status, error: cb.error, rows: cb.candles.length });
    if (cb.candles.length) {
      normalized = cb.candles;
      primary = "coinbase";
    }
  }

  let upsertErrorMessage: string | null = null;
  if (normalized.length) {
    // When OKX served the batch, upsert normally (OKX is canonical and may
    // refine open/high/low/close/confirm on the currently-forming candle).
    // When Coinbase is the fallback, DO NOT overwrite existing rows — that
    // would demote already-ingested `fetch_source='okx'` rows to 'coinbase'
    // and break every downstream model that requires the canonical OKX
    // stream (Model 3 FWD, a96, TD1-RC, etc.).
    const { error: upsertErr } = await supabase
      .from("candles")
      .upsert(normalized, {
        onConflict: "symbol,timeframe,candle_ts",
        ignoreDuplicates: primary === "coinbase",
      });
    if (upsertErr) upsertErrorMessage = upsertErr.message;
  }

  const success = normalized.length > 0 && !upsertErrorMessage;
  await supabase.from("api_runs").insert({
    run_type: "fetch-okx-candles",
    request_payload: { attempts_summary: attempts.map((a) => ({ source: a.source, status: a.status, rows: a.rows })) },
    response_payload: {
      count: normalized.length,
      primary_source: primary,
      duration_ms: Date.now() - started,
      attempts,
      upsert_error: upsertErrorMessage,
    },
    success,
    error_message: success ? null : (upsertErrorMessage ?? (attempts.map((a) => a.error).filter(Boolean).join(" | ") || "No candles from any source")),
  });

  if (!success) {
    throw new Error(upsertErrorMessage ?? (attempts.map((a) => a.error).filter(Boolean).join(" | ") || "No candles from any source"));
  }

  const { data, error } = await supabase
    .from("candles")
    .select("*")
    .eq("symbol", SYMBOL)
    .eq("timeframe", TF)
    .order("candle_ts", { ascending: false })
    .limit(200);
  if (error) throw error;
  return {
    candles: (data ?? []).slice().reverse(),
    primary_source: primary,
    attempts,
  };
}

/**
 * Backwards-compatible wrapper — same signature as before, returns just the
 * candle array. New code should prefer `fetchAndUpsertCandles`.
 */
export async function fetchAndUpsertOkxCandles(supabase: SupabaseClient) {
  const { candles } = await fetchAndUpsertCandles(supabase);
  return candles;
}
