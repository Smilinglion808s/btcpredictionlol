import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listAllPredictionsForHistory } from "@/lib/predictions.functions";
import { supabase } from "@/integrations/supabase/client";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [{ title: "CSV Data — BTC 15m" }] }),
  component: CsvDataPage,
});

const MT_TZ = "America/Denver";

// Every field we export — order matters for the CSV header.
const COLUMNS: { key: string; label: string }[] = [
  { key: "id", label: "id" },
  { key: "created_at", label: "created_at_utc" },
  { key: "created_at_mt", label: "created_at_mt" },
  { key: "candle_ts", label: "candle_ts_utc" },
  { key: "candle_ts_mt", label: "candle_ts_mt" },
  { key: "candle_ends_at", label: "candle_ends_at_utc" },
  { key: "resolved_at", label: "resolved_at_utc" },
  { key: "seconds_to_resolve", label: "seconds_to_resolve" },
  { key: "symbol", label: "symbol" },
  { key: "timeframe", label: "timeframe" },
  { key: "model_version", label: "model_version" },
  { key: "api_model_id", label: "api_model_id" },
  { key: "prediction", label: "prediction" },
  { key: "confidence", label: "confidence" },
  { key: "confidence_bucket", label: "confidence_bucket" },
  { key: "status", label: "status" },
  { key: "correct", label: "correct" },
  { key: "setup_type", label: "setup_type" },
  { key: "market_condition", label: "market_condition" },
  { key: "btc_price_at_prediction", label: "btc_price_at_prediction" },
  { key: "actual_next_candle_open", label: "actual_open" },
  { key: "actual_next_candle_high", label: "actual_high" },
  { key: "actual_next_candle_low", label: "actual_low" },
  { key: "actual_next_candle_close", label: "actual_close" },
  { key: "actual_direction", label: "actual_direction" },
  { key: "price_change_abs", label: "price_change_abs" },
  { key: "price_change_pct", label: "price_change_pct" },
  { key: "candle_range", label: "candle_range" },
  { key: "body_size", label: "body_size" },
  { key: "body_pct_of_range", label: "body_pct_of_range" },
  { key: "upper_wick", label: "upper_wick" },
  { key: "lower_wick", label: "lower_wick" },
  { key: "upper_wick_pct", label: "upper_wick_pct" },
  { key: "lower_wick_pct", label: "lower_wick_pct" },
  // indicators
  { key: "ind_ema9", label: "ema9" },
  { key: "ind_ema21", label: "ema21" },
  { key: "ind_ema50", label: "ema50" },
  { key: "ind_trend", label: "trend" },
  { key: "ind_volumeExpansion", label: "volume_expansion" },
  { key: "ind_range20High", label: "range20_high" },
  { key: "ind_range20Low", label: "range20_low" },
  { key: "ind_bodyPct", label: "prev_body_pct" },
  { key: "ind_upperWickPct", label: "prev_upper_wick_pct" },
  { key: "ind_lowerWickPct", label: "prev_lower_wick_pct" },
  { key: "ind_failedBreakoutUp", label: "failed_breakout_up" },
  { key: "ind_failedBreakoutDown", label: "failed_breakout_down" },
  { key: "ind_choppy", label: "choppy" },
  { key: "reasoning_summary", label: "reasoning_summary" },
  { key: "notes", label: "notes" },
];

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function fmtMT(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("sv-SE", { timeZone: MT_TZ }).replace(" ", "T");
  } catch { return ""; }
}

type PredRow = Record<string, unknown>;

function enrich(p: PredRow): PredRow {
  const open = Number(p.actual_next_candle_open);
  const high = Number(p.actual_next_candle_high);
  const low = Number(p.actual_next_candle_low);
  const close = Number(p.actual_next_candle_close);
  const hasActual = Number.isFinite(open) && Number.isFinite(close);
  const range = hasActual ? high - low : NaN;
  const body = hasActual ? Math.abs(close - open) : NaN;
  const upperWick = hasActual ? high - Math.max(open, close) : NaN;
  const lowerWick = hasActual ? Math.min(open, close) - low : NaN;
  const actualDir = hasActual ? (close > open ? "GREEN" : close < open ? "RED" : "DOJI") : "";
  const changeAbs = hasActual ? close - open : NaN;
  const changePct = hasActual && open ? (changeAbs / open) * 100 : NaN;

  const conf = Number(p.confidence) || 0;
  const bucket =
    conf < 40 ? "0-39" : conf < 60 ? "40-59" : conf < 70 ? "60-69" : conf < 80 ? "70-79" : "80+";

  const correct = p.status === "win" ? 1 : p.status === "loss" ? 0 : "";
  const candleTs = String(p.candle_ts);
  const candleEnds = new Date(new Date(candleTs).getTime() + FIFTEEN_MIN_MS).toISOString();
  const secondsToResolve =
    p.resolved_at && p.candle_ts
      ? Math.round((new Date(String(p.resolved_at)).getTime() - new Date(candleTs).getTime()) / 1000)
      : "";

  const ind = (p.indicators ?? {}) as Record<string, unknown>;

  return {
    ...p,
    created_at_mt: fmtMT(String(p.created_at)),
    candle_ts_mt: fmtMT(candleTs),
    candle_ends_at: candleEnds,
    seconds_to_resolve: secondsToResolve,
    confidence_bucket: bucket,
    correct,
    actual_direction: actualDir,
    price_change_abs: hasActual ? changeAbs.toFixed(2) : "",
    price_change_pct: hasActual ? changePct.toFixed(4) : "",
    candle_range: hasActual ? range.toFixed(2) : "",
    body_size: hasActual ? body.toFixed(2) : "",
    body_pct_of_range: hasActual && range ? (body / range).toFixed(4) : "",
    upper_wick: hasActual ? upperWick.toFixed(2) : "",
    lower_wick: hasActual ? lowerWick.toFixed(2) : "",
    upper_wick_pct: hasActual && range ? (upperWick / range).toFixed(4) : "",
    lower_wick_pct: hasActual && range ? (lowerWick / range).toFixed(4) : "",
    ind_ema9: ind.ema9 ?? "",
    ind_ema21: ind.ema21 ?? "",
    ind_ema50: ind.ema50 ?? "",
    ind_trend: ind.trend ?? "",
    ind_volumeExpansion: ind.volumeExpansion ?? "",
    ind_range20High: ind.range20High ?? "",
    ind_range20Low: ind.range20Low ?? "",
    ind_bodyPct: ind.bodyPct ?? "",
    ind_upperWickPct: ind.upperWickPct ?? "",
    ind_lowerWickPct: ind.lowerWickPct ?? "",
    ind_failedBreakoutUp: ind.failedBreakoutUp ?? "",
    ind_failedBreakoutDown: ind.failedBreakoutDown ?? "",
    ind_choppy: ind.choppy ?? "",
  };
}

function csvEscape(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: PredRow[]) {
  const header = COLUMNS.map((c) => c.label).join(",");
  const body = rows
    .map((r) => COLUMNS.map((c) => csvEscape((r as Record<string, unknown>)[c.key])).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

type ModelGroup = {
  model: string;
  rows: PredRow[];
  firstTs: number;
  lastTs: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
};

function CsvDataPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPredictions);
  const listQ = useQuery({ queryKey: ["predictions-list"], queryFn: () => listFn() });

  useEffect(() => {
    const ch = supabase
      .channel("csv-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["predictions-list"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const groups = useMemo<ModelGroup[]>(() => {
    const map = new Map<string, PredRow[]>();
    (listQ.data ?? []).forEach((p) => {
      const key = (p.model_version as string) || "unknown";
      const arr = map.get(key) ?? [];
      arr.push(enrich(p as PredRow));
      map.set(key, arr);
    });
    return Array.from(map.entries())
      .map(([model, rows]) => {
        const times = rows.map((r) => new Date(String(r.candle_ts)).getTime()).filter(Number.isFinite);
        return {
          model,
          rows,
          firstTs: Math.min(...times),
          lastTs: Math.max(...times),
          wins: rows.filter((r) => r.status === "win").length,
          losses: rows.filter((r) => r.status === "loss").length,
          pushes: rows.filter((r) => r.status === "push").length,
          pending: rows.filter((r) => r.status === "pending" || r.status === "manual_review").length,
        };
      })
      .sort((a, b) => b.lastTs - a.lastTs);
  }, [listQ.data]);

  const downloadModel = (g: ModelGroup) => {
    const csv = toCsv(g.rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = g.model.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const from = fmtDate(g.firstTs);
    const to = fmtDate(g.lastTs);
    a.href = url;
    a.download = `btc15m_${safe}_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="px-4 sm:px-6 py-5 space-y-4 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-xl font-semibold">CSV Training Data</h1>
        <p className="text-xs text-muted-foreground mt-1">
          One downloadable CSV per model — enriched trade + indicator fields for training.
        </p>
      </div>

      {groups.length === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          {listQ.isLoading ? "Loading…" : "No predictions yet."}
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {groups.map((g) => {
          const wr = g.wins + g.losses > 0 ? ((g.wins / (g.wins + g.losses)) * 100).toFixed(1) : "—";
          return (
            <details key={g.model} className="group rounded-lg border border-border bg-card">
              <summary className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none">
                <div className="flex flex-col">
                  <span className="font-mono font-semibold">{g.model}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {fmtDate(g.firstTs)} → {fmtDate(g.lastTs)} · {g.rows.length} rows
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-bull">{g.wins}W</span>
                  <span className="text-bear">{g.losses}L</span>
                  <span className="text-muted-foreground">{g.pushes}P</span>
                  <span className="text-muted-foreground">{g.pending} pending</span>
                  <span>WR {wr}{wr === "—" ? "" : "%"}</span>
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={(e) => { e.preventDefault(); downloadModel(g); }}
                  >
                    <Download className="size-4" /> CSV
                  </Button>
                  <span className="text-muted-foreground transition-transform group-open:rotate-180">▾</span>
                </div>
              </summary>
              <div className="border-t border-border overflow-x-auto max-h-[60vh]">
                <table className="w-full text-xs font-mono">
                  <thead className="text-[10px] uppercase text-muted-foreground border-b border-border sticky top-0 bg-card">
                    <tr>
                      {COLUMNS.map((c) => (
                        <th key={c.key} className="text-left px-2 py-2 whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.slice(0, 50).map((r, i) => (
                      <tr key={String(r.id) + i} className="border-b border-border/40 hover:bg-muted/20">
                        {COLUMNS.map((c) => {
                          const v = (r as Record<string, unknown>)[c.key];
                          const s = v === null || v === undefined ? "" : String(v);
                          return (
                            <td key={c.key} className="px-2 py-1.5 whitespace-nowrap max-w-[220px] truncate" title={s}>
                              {s}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {g.rows.length > 50 && (
                  <div className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border">
                    Preview limited to 50 rows — full {g.rows.length} rows in CSV.
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function fmtDate(ts: number) {
  if (!Number.isFinite(ts)) return "n-a";
  return new Date(ts).toISOString().slice(0, 10);
}

