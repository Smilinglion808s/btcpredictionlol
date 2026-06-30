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
import { getLatestPrediction, listPredictions, runFullCycle } from "@/lib/predictions.functions";
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

  const refreshMut = useMutation({
    mutationFn: () => refreshFn(),
    onSuccess: () => { toast.success("Candles refreshed"); qc.invalidateQueries({ queryKey: ["candles"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Refresh failed"),
  });

  const runMut = useMutation({
    mutationFn: () => cycleFn(),
    onSuccess: () => { toast.success("Prediction saved"); qc.invalidateQueries(); router.invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Prediction failed"),
  });

  // Auto-predict 25s before every 15m candle close.
  // Ticks once per second; when the seconds-to-next-15m-close window hits ~25s, fire one cycle.
  const lastFiredSlotRef = useRef<number | null>(null);
  // (countdown is shown in HeaderStrip from lastCandleTs)
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const slotSize = 15 * 60 * 1000;
      const nextClose = Math.ceil(now / slotSize) * slotSize;
      const remainingMs = nextClose - now;


      // Fire once when we cross into the 25s pre-close window, and only once per slot.
      const slotId = nextClose;
      if (
        remainingMs <= 25_000 &&
        remainingMs > 2_000 &&
        lastFiredSlotRef.current !== slotId &&
        !runMut.isPending
      ) {
        lastFiredSlotRef.current = slotId;
        runMut.mutate();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [runMut]);

  const autoMut = useMutation({
    mutationFn: (enabled: boolean) => autoToggleFn({ data: { enabled } }),
    onSuccess: () => { toast.success("Auto-run updated"); qc.invalidateQueries({ queryKey: ["active-settings"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base font-mono">BTC-USD · 15m</CardTitle>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                <span className={`inline-block size-1.5 rounded-full ${liveQ.isError ? "bg-bear" : "bg-bull animate-pulse"}`} />
                {liveQ.isError ? "offline" : "live"} · {sourceLabel(liveSource)}
              </span>
            </div>
            <div className="flex gap-2">
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
              <Button size="sm" variant="secondary" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
                {refreshMut.isPending ? "Syncing…" : "Sync DB"}
              </Button>
            </div>
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


        <div className="space-y-4">
          <Card className="border-info/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Current Guess · Next Candle</CardTitle>
            </CardHeader>
            <CardContent>
              {latestQ.data ? (
                <div className="space-y-2 text-center">
                  <div className={`font-mono text-5xl font-bold ${latestQ.data.prediction === "YES" ? "text-bull" : "text-bear"}`}>
                    {latestQ.data.prediction === "YES" ? "GREEN" : "RED"}
                  </div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {Number(latestQ.data.confidence).toFixed(1)}% confidence · <StatusBadge status={latestQ.data.status} />
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground">
                    Target candle: {new Date(latestQ.data.candle_ts).toLocaleTimeString()} → {new Date(new Date(latestQ.data.candle_ts).getTime() + 15 * 60 * 1000).toLocaleTimeString()}
                  </div>

                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center">Waiting for first prediction…</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Latest Prediction</CardTitle>
            </CardHeader>
            <CardContent>
              {latestQ.data ? <PredictionDetail p={latestQ.data} /> : <p className="text-sm text-muted-foreground">No predictions yet.</p>}
            </CardContent>
          </Card>

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

type PredictionRow = Awaited<ReturnType<typeof getLatestPrediction>>;

function PredictionDetail({ p }: { p: NonNullable<PredictionRow> }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <PredictionBadge value={p.prediction} />
        <StatusBadge status={p.status} />
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono text-xs">
        <Field label="Confidence" value={`${Number(p.confidence).toFixed(1)}%`} />
        <Field label="Price" value={`$${Number(p.btc_price_at_prediction).toLocaleString()}`} />
        <Field label="Current Candle" value={`${new Date(new Date(p.candle_ts).getTime() - 15 * 60 * 1000).toLocaleTimeString()} → ${new Date(p.candle_ts).toLocaleTimeString()}`} />
        <Field label="Predicting Next" value={`${new Date(p.candle_ts).toLocaleTimeString()} → ${new Date(new Date(p.candle_ts).getTime() + 15 * 60 * 1000).toLocaleTimeString()}`} />

      </div>
      {p.setup_type && <Field label="Setup" value={p.setup_type} />}
      {p.reasoning_summary && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Reasoning</div>
          <p className="text-xs leading-relaxed">{p.reasoning_summary}</p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}
