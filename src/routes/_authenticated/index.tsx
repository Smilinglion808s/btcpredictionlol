import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CandleChart } from "@/components/candle-chart";
import { PredictionBadge, StatusBadge } from "@/components/status-badges";
import { listCandles } from "@/lib/candles.functions";
import { getLatestPrediction, listPredictions } from "@/lib/predictions.functions";
import { Link } from "@tanstack/react-router";
import { getActiveSettings } from "@/lib/settings.functions";
import { supabase } from "@/integrations/supabase/client";
import { useLiveCandles, useLiveSpotPrice, LIVE_SOURCES, sourceLabel, type LiveSource } from "@/hooks/use-live-candles";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Home — BTC 15m" }] }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();

  const candlesFn = useServerFn(listCandles);
  const latestFn = useServerFn(getLatestPrediction);
  const settingsFn = useServerFn(getActiveSettings);


  const candlesQ = useQuery({ queryKey: ["candles"], queryFn: () => candlesFn() });
  const latestQ = useQuery({ queryKey: ["latest-prediction"], queryFn: () => latestFn() });
  const settingsQ = useQuery({ queryKey: ["active-settings"], queryFn: () => settingsFn() });
  const listFn = useServerFn(listPredictions);
  const listQ = useQuery({ queryKey: ["predictions-list"], queryFn: () => listFn(), refetchInterval: 30_000 });
  const resolvedSorted = useMemo(() => {
    return (listQ.data ?? [])
      .filter((p) => p.status === "win" || p.status === "loss" || p.status === "push")
      .sort((a, b) => new Date(b.resolved_at ?? b.created_at).getTime() - new Date(a.resolved_at ?? a.created_at).getTime());
  }, [listQ.data]);
  const lastResolved = resolvedSorted[0];

  const last5 = useMemo(() => {
    return resolvedSorted.slice(0, 5);
  }, [resolvedSorted]);


  const [liveSource, setLiveSource] = useState<LiveSource>("coinbase");
  const liveQ = useLiveCandles(liveSource, 5000);
  const spotQ = useLiveSpotPrice(liveSource, 3000);

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
  const change15 = last ? ((last.close - last.open) / last.open) * 100 : 0;
  const isBull = change15 >= 0;

  return (
    <div className="px-4 sm:px-6 py-5 space-y-5 max-w-[1600px] mx-auto">
      <HeaderStrip
        price={spotQ.data ?? last?.close}
        change={change15}
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

          <CandleStatusCards latestPrediction={latestQ.data} />


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
            <CardContent className="py-4">
              <p className="text-[11px] text-muted-foreground text-center">
                View-only · predictions run automatically ~1m before each 15m candle opens.
              </p>
              <p className="text-[11px] text-muted-foreground text-center mt-1">
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
  const [offset, setOffset] = useState(0); // serverTime - localTime (ms)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const t0 = Date.now();
        const r = await fetch("https://api.exchange.coinbase.com/time", { cache: "no-store" });
        const t1 = Date.now();
        const j = await r.json();
        const serverMs = new Date(j.iso).getTime();
        // adjust for round-trip latency
        const localMid = (t0 + t1) / 2;
        if (!cancelled) setOffset(serverMs - localMid);
      } catch {}
    };
    sync();
    const i = setInterval(sync, 60_000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  const TF = 15 * 60 * 1000;
  const serverNow = now + offset;
  const nextClose = Math.floor(serverNow / TF) * TF + TF;

  const fmt = (diff: number) => {
    const d = Math.max(0, diff);
    const m = Math.floor(d / 60000);
    const s = Math.floor((d % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };
  // Prediction cron fires ~60s before each candle close (:14/:29/:44/:59)
  const nextPredictionAt = nextClose - 60_000;
  const nextPrediction = fmt((nextPredictionAt > serverNow ? nextPredictionAt : nextPredictionAt + TF) - serverNow);
  const timeLeft = fmt(nextClose - serverNow);


  return (
    <Card>
      <CardContent className="py-4 grid grid-cols-2 sm:grid-cols-6 gap-4 text-sm">
        <Stat label="BTC-USD" value={props.price ? `$${Number(props.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"} />
        <Stat
          label="15m Change"
          value={`${props.change >= 0 ? "+" : ""}${props.change.toFixed(2)}%`}
          tone={props.isBull ? "bull" : "bear"}
        />
        <Stat label="Time Left in Candle" value={timeLeft} tone="info" />
        <Stat label="Next Prediction" value={nextPrediction} tone="info" />
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

type LatestPred = {
  candle_ts: string;
  prediction: string;
  confidence: number | string;
  status?: string;
} | null | undefined;

function CandleStatusCards({ latestPrediction }: { latestPrediction: LatestPred }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const TF = 15 * 60 * 1000;
  const currentStart = Math.floor(now / TF) * TF;
  const currentEnd = currentStart + TF;
  const upcomingStart = currentEnd;
  const upcomingEnd = upcomingStart + TF;

  const fmt = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const predTs = latestPrediction ? new Date(latestPrediction.candle_ts).getTime() : 0;
  const currentPred = predTs === currentStart ? latestPrediction : null;
  const upcomingPred = predTs === upcomingStart ? latestPrediction : null;

  const Row = ({
    title,
    windowLabel,
    pred,
    emptyText,
  }: {
    title: string;
    windowLabel: string;
    pred: LatestPred;
    emptyText: string;
  }) => (
    <div className="flex items-center justify-between text-sm">
      <div className="leading-tight">
        <span className="text-muted-foreground uppercase tracking-wider text-[11px] block">{title}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{windowLabel}</span>
      </div>
      {pred ? (() => {
        const isSkip = pred.prediction === "NO CLEAR EDGE";
        const isYes = pred.prediction === "YES";
        return (
          <div className="text-right">
            <div className={`font-mono font-semibold ${isSkip ? "text-muted-foreground" : isYes ? "text-bull" : "text-bear"}`}>
              {isSkip ? "NO CLEAR EDGE" : isYes ? "GREEN" : "RED"}
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {isSkip ? "model abstained" : `${Number(pred.confidence).toFixed(0)}% conf`}
            </div>
          </div>
        );
      })() : (
        <span className="text-[11px] text-muted-foreground font-mono">{emptyText}</span>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Card className="py-2">
        <CardContent className="py-3">
          <Row
            title="Current Candle · in progress"
            windowLabel={`${fmt(currentStart)} → ${fmt(currentEnd)}`}
            pred={currentPred}
            emptyText="forming…"
          />
        </CardContent>
      </Card>
      <Card className="py-2 border-info/40">
        <CardContent className="py-3">
          <Row
            title="Upcoming Candle · pending"
            windowLabel={`${fmt(upcomingStart)} → ${fmt(upcomingEnd)}`}
            pred={upcomingPred}
            emptyText="awaiting prediction"
          />
        </CardContent>
      </Card>
    </div>
  );
}

