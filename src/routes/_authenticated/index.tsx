import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CandleChart } from "@/components/candle-chart";
import { PredictionBadge, StatusBadge } from "@/components/status-badges";
import { listCandles } from "@/lib/candles.functions";
import { fetchOkxCandles } from "@/lib/okx.functions";
import { getLatestPrediction, listPredictions, runFullCycle, resolvePredictions } from "@/lib/predictions.functions";
import { Link } from "@tanstack/react-router";
import { getActiveSettings, toggleAutoRun } from "@/lib/settings.functions";
import { supabase } from "@/integrations/supabase/client";
import { useLiveCandles, LIVE_SOURCES, sourceLabel, type LiveSource } from "@/hooks/use-live-candles";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Home — BTC 15m" }] }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const router = useRouter();

  const candlesFn = useServerFn(listCandles);
  const refreshFn = useServerFn(fetchOkxCandles);
  const latestFn = useServerFn(getLatestPrediction);
  const settingsFn = useServerFn(getActiveSettings);
  const cycleFn = useServerFn(runFullCycle);
  const autoToggleFn = useServerFn(toggleAutoRun);

  const candlesQ = useQuery({ queryKey: ["candles"], queryFn: () => candlesFn() });
  const latestQ = useQuery({ queryKey: ["latest-prediction"], queryFn: () => latestFn() });
  const settingsQ = useQuery({ queryKey: ["active-settings"], queryFn: () => settingsFn() });
  const listFn = useServerFn(listPredictions);
  const listQ = useQuery({ queryKey: ["predictions-list"], queryFn: () => listFn() });
  const lastResolved = (listQ.data ?? []).find((p) => p.status === "win" || p.status === "loss" || p.status === "push");

  const last5 = useMemo(() => {
    return (listQ.data ?? [])
      .filter((p) => p.status === "win" || p.status === "loss" || p.status === "push")
      .sort((a, b) => new Date(b.resolved_at ?? b.created_at).getTime() - new Date(a.resolved_at ?? a.created_at).getTime())
      .slice(0, 5);
  }, [listQ.data]);


  const [liveSource, setLiveSource] = useState<LiveSource>("coinbase");
  const liveQ = useLiveCandles(liveSource, 5000);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("dash-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "candles" }, () => {
        qc.invalidateQueries({ queryKey: ["candles"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["latest-prediction"] });
        qc.invalidateQueries({ queryKey: ["predictions-list"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  // View-only: predictions and resolution are driven server-side by pg_cron.
  // The page reflects updates via realtime subscriptions above; no client triggers.


  // Prefer live exchange candles for the chart; fall back to DB candles.
  const liveCandles = liveQ.data ?? [];
  const dbCandles = candlesQ.data ?? [];
  const chartCandles = liveCandles.length
    ? liveCandles
    : dbCandles.map((c) => ({
        candle_ts: c.candle_ts as string,
        open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume),
      }));

  const last = chartCandles[chartCandles.length - 1];
  const first24 = chartCandles.length >= 96 ? chartCandles[chartCandles.length - 96] : chartCandles[0];
  const change24 = last && first24 ? ((last.close - first24.open) / first24.open) * 100 : 0;
  const isBull = change24 >= 0;

  return (
    <div className="px-4 sm:px-6 py-5 space-y-5 max-w-[1600px] mx-auto">
      <HeaderStrip
        price={last?.close}
        change={change24}
        isBull={isBull}
        lastCandleTs={last?.candle_ts}
        modelVersion={settingsQ.data?.model_version}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base font-mono">BTC-USD · 15m</CardTitle>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  <span className={`inline-block size-1.5 rounded-full ${liveQ.isError ? "bg-bear" : "bg-bull animate-pulse"}`} />
                  {liveQ.isError ? "offline" : "live"} · {sourceLabel(liveSource)}
                </span>
              </div>
              <select
                value={liveSource}
                onChange={(e) => setLiveSource(e.target.value as LiveSource)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs font-mono"
                aria-label="Live data source"
              >
                {LIVE_SOURCES.map((s) => (
                  <option key={s} value={s}>{sourceLabel(s)}</option>
                ))}
              </select>

            </CardHeader>
            <CardContent>
              {chartCandles.length === 0 ? (
                <div className="text-sm text-muted-foreground py-20 text-center">
                  {liveQ.isError ? `Couldn't reach ${sourceLabel(liveSource)} — try another source.` : "Loading candles…"}
                </div>
              ) : (
                <CandleChart candles={chartCandles.slice(-100)} />
              )}
            </CardContent>
          </Card>

          <Card className="py-2">
            <CardContent className="py-3">
              {latestQ.data ? (
                <div className="flex items-center justify-between text-sm">
                  <div className="leading-tight">
                    <span className="text-muted-foreground uppercase tracking-wider text-[11px] block">Current Candle</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {new Date(latestQ.data.candle_ts).toLocaleString()}
                    </span>
                  </div>
                  <span className={`font-mono font-semibold ${latestQ.data.prediction === "YES" ? "text-bull" : "text-bear"}`}>
                    {latestQ.data.prediction === "YES" ? "GREEN" : "RED"}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center">Waiting for first prediction…</p>
              )}
            </CardContent>
          </Card>

          <Card className="py-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-[11px] uppercase tracking-wider text-muted-foreground">Last 5 Trades</CardTitle>
            </CardHeader>
            <CardContent className="py-0">
              {last5.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-3">Waiting for trades…</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-[11px] text-muted-foreground border-b border-border">
                      <tr>
                        <th className="text-left py-2 pr-3">Candle Time</th>
                        <th className="text-left py-2 pr-3">Prediction</th>
                        <th className="text-left py-2 pr-3">Actual</th>
                        <th className="text-right py-2">Conf</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {last5.map((p) => {
                        const open = Number(p.actual_next_candle_open ?? 0);
                        const close = Number(p.actual_next_candle_close ?? 0);
                        const actual = open === 0 && close === 0 ? "—" : close >= open ? "GREEN" : "RED";
                        return (
                          <tr key={p.id} className="border-b border-border/50">
                            <td className="py-2 pr-3">{new Date(p.candle_ts).toLocaleString()}</td>
                            <td className={`py-2 pr-3 ${p.prediction === "YES" ? "text-bull" : "text-bear"}`}>
                              {p.prediction === "YES" ? "GREEN" : "RED"}
                            </td>
                            <td className={`py-2 pr-3 ${actual === "GREEN" ? "text-bull" : actual === "RED" ? "text-bear" : "text-muted-foreground"}`}>
                              {actual}
                            </td>
                            <td className="py-2 text-right">{Number(p.confidence).toFixed(0)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Last Result</CardTitle>
              <Link to="/stats" className="text-[11px] uppercase tracking-wider text-info hover:underline">View stats →</Link>
            </CardHeader>
            <CardContent>
              {lastResolved ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <PredictionBadge value={lastResolved.prediction} />
                    <StatusBadge status={lastResolved.status} />
                  </div>
                  <div className="text-xs font-mono text-muted-foreground">
                    {new Date(lastResolved.resolved_at ?? lastResolved.created_at).toLocaleString()}
                  </div>
                  {lastResolved.actual_next_candle_open != null && lastResolved.actual_next_candle_close != null && (
                    <div className="text-xs font-mono grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-muted-foreground">Open </span>
                        ${Number(lastResolved.actual_next_candle_open).toLocaleString()}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Close </span>
                        <span className={Number(lastResolved.actual_next_candle_close) >= Number(lastResolved.actual_next_candle_open) ? "text-bull" : "text-bear"}>
                          ${Number(lastResolved.actual_next_candle_close).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Waiting for first candle to close…</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {runMut.isPending && (
                <div className="text-xs text-center text-muted-foreground">Running prediction…</div>
              )}

              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="auto" className="text-sm">Auto Run Every 15m</Label>
                  <p className="text-xs text-muted-foreground">Runs on the 15m schedule.</p>
                </div>
                <Switch
                  id="auto"
                  checked={settingsQ.data?.auto_run_enabled ?? false}
                  onCheckedChange={(v) => autoMut.mutate(v)}
                  disabled={autoMut.isPending}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Prediction tracking only. Not financial advice.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

    </div>
  );
}

function HeaderStrip(props: {
  price?: number | string;
  change: number;
  isBull: boolean;
  lastCandleTs?: string;
  modelVersion?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const countdown = useMemo(() => {
    if (!props.lastCandleTs) return "—";
    const next = new Date(props.lastCandleTs).getTime() + 15 * 60 * 1000;
    const diff = Math.max(0, next - now);
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, [props.lastCandleTs, now]);

  return (
    <Card>
      <CardContent className="py-4 grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
        <Stat label="BTC-USD" value={props.price ? `$${Number(props.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"} />
        <Stat
          label="24h Change"
          value={`${props.change >= 0 ? "+" : ""}${props.change.toFixed(2)}%`}
          tone={props.isBull ? "bull" : "bear"}
        />
        <Stat label="Next 15m" value={countdown} tone="info" />
        <Stat label="Last Updated" value={props.lastCandleTs ? new Date(props.lastCandleTs).toLocaleTimeString() : "—"} />
        <Stat label="Model" value={props.modelVersion ?? "—"} />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" | "info" }) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : tone === "info" ? "text-info" : "";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-lg font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

