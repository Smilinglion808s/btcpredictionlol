import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { getLatestPrediction, runFullCycle } from "@/lib/predictions.functions";
import { getActiveSettings, toggleAutoRun } from "@/lib/settings.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard — BTC 15m" }] }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const router = useRouter();

  const candlesFn = useServerFnRpc(listCandles);
  const refreshFn = useServerFnRpc(fetchOkxCandles);
  const latestFn = useServerFnRpc(getLatestPrediction);
  const settingsFn = useServerFnRpc(getActiveSettings);
  const cycleFn = useServerFnRpc(runFullCycle);
  const autoToggleFn = useServerFnRpc(toggleAutoRun);

  const candlesQ = useQuery({ queryKey: ["candles"], queryFn: () => candlesFn() });
  const latestQ = useQuery({ queryKey: ["latest-prediction"], queryFn: () => latestFn() });
  const settingsQ = useQuery({ queryKey: ["active-settings"], queryFn: () => settingsFn() });

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("dash-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "candles" }, () => {
        qc.invalidateQueries({ queryKey: ["candles"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["latest-prediction"] });
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

  const autoMut = useMutation({
    mutationFn: (enabled: boolean) => autoToggleFn({ data: { enabled } }),
    onSuccess: () => { toast.success("Auto-run updated"); qc.invalidateQueries({ queryKey: ["active-settings"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const candles = candlesQ.data ?? [];
  const last = candles[candles.length - 1];
  const first24 = candles.length >= 96 ? candles[candles.length - 96] : candles[0];
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
            <CardTitle className="text-base font-mono">BTC-USDT · 15m</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
                {refreshMut.isPending ? "Refreshing…" : "Refresh Candles"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {candlesQ.isLoading ? (
              <div className="text-sm text-muted-foreground py-20 text-center">Loading candles…</div>
            ) : (
              <CandleChart candles={candles.slice(-100).map((c) => ({
                candle_ts: c.candle_ts as string,
                open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume),
              }))} />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Latest Prediction</CardTitle>
            </CardHeader>
            <CardContent>
              {latestQ.data ? <PredictionDetail p={latestQ.data} /> : <p className="text-sm text-muted-foreground">No predictions yet.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                onClick={() => runMut.mutate()}
                disabled={runMut.isPending}
                className="w-full h-12 text-sm font-semibold tracking-wide"
              >
                {runMut.isPending ? "Running…" : "RUN NEXT CANDLE"}
              </Button>
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
        <Stat label="BTC-USDT" value={props.price ? `$${Number(props.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"} />
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
        <Field label="Candle Start" value={new Date(p.candle_ts).toLocaleString()} />
        <Field label="Target Close" value={new Date(new Date(p.candle_ts).getTime() + 15 * 60 * 1000).toLocaleString()} />
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
