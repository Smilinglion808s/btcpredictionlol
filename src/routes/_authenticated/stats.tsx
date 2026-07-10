import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPredictionStats, listPredictions, listModelVersions, getModel7ShadowStats, getModel7ShadowPending } from "@/lib/predictions.functions";
import { getActiveSettings } from "@/lib/settings.functions";
import { PredictionBadge, StatusBadge } from "@/components/status-badges";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/stats")({
  head: () => ({ meta: [{ title: "Stats — BTC 15m" }] }),
  component: StatsPage,
});

const ALL_VERSIONS = "__all__";

function StatsPage() {
  const qc = useQueryClient();
  const statsFn = useServerFn(getPredictionStats);
  const listFn = useServerFn(listPredictions);
  const settingsFn = useServerFn(getActiveSettings);
  const versionsFn = useServerFn(listModelVersions);

  const settingsQ = useQuery({ queryKey: ["active-settings"], queryFn: () => settingsFn() });
  const versionsQ = useQuery({ queryKey: ["model-versions"], queryFn: () => versionsFn(), refetchInterval: 60_000 });
  const m7Fn = useServerFn(getModel7ShadowStats);
  const m7Q = useQuery({ queryKey: ["model7-shadow-stats"], queryFn: () => m7Fn(), refetchInterval: 15_000 });

  const activeVersion = settingsQ.data?.model_version ?? null;
  const [selected, setSelected] = useState<string>(ALL_VERSIONS);

  // Default the selector to the active model version once we know it.
  useEffect(() => {
    if (activeVersion && selected === ALL_VERSIONS) setSelected(activeVersion);
    // only run when activeVersion first arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersion]);

  const versionFilter = selected === ALL_VERSIONS ? null : selected;

  const statsQ = useQuery({
    queryKey: ["stats", versionFilter ?? "all"],
    queryFn: () => statsFn({ data: { modelVersion: versionFilter } }),
    refetchInterval: 15_000,
  });
  const listQ = useQuery({
    queryKey: ["predictions-list", versionFilter ?? "all"],
    queryFn: () => listFn({ data: { modelVersion: versionFilter } }),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel("stats-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["stats"] });
        qc.invalidateQueries({ queryKey: ["predictions-list"] });
        qc.invalidateQueries({ queryKey: ["model-versions"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const s = (statsQ.data ?? {}) as Record<string, unknown>;
  const num = (k: string) => Number(s[k] ?? 0);

  const modelVersion = activeVersion ?? "—";
  const totalRuns = num("total");
  const resolved = num("wins") + num("losses") + num("pushes");
  const wr = num("overall_win_rate");
  const isLive = Boolean(settingsQ.data?.auto_run_enabled);

  const versions = versionsQ.data ?? [];
  const versionOptions = useMemo(() => {
    const list = versions.map((v) => v.version);
    if (activeVersion && !list.includes(activeVersion)) list.unshift(activeVersion);
    return list;
  }, [versions, activeVersion]);

  const badge = /^5/.test(modelVersion) ? "M5" : /^4/.test(modelVersion) ? "M4" : /^3/.test(modelVersion) ? "M3" : "M";
  const scopeLabel = versionFilter ? `Model ${versionFilter}` : "All models";

  return (
    <div className="px-4 sm:px-6 py-5 space-y-5 max-w-[1600px] mx-auto">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 italic">
        Actual candle outcomes are determined by the Kalshi KXBTC15M 15-minute prediction market (CF Benchmarks BRTI settlement).
      </p>
      <Card className="border-bull/40 bg-gradient-to-br from-bull/10 via-card to-card">
        <CardContent className="py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-md bg-bull/20 border border-bull/40 flex items-center justify-center font-mono font-bold text-bull">
              {badge}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Model Status</div>
              <div className="font-mono text-lg font-semibold flex items-center gap-2">
                BTCUSDT 15m
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${isLive ? "border-bull/40 text-bull bg-bull/10" : "border-border text-muted-foreground"}`}>
                  <span className={`size-1.5 rounded-full ${isLive ? "bg-bull animate-pulse" : "bg-muted-foreground"}`} />
                  {isLive ? "AUTO LIVE" : "MANUAL"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">
                active: {modelVersion} · showing: {scopeLabel}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-44">
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger className="h-9 text-xs font-mono">
                  <SelectValue placeholder="Filter version" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VERSIONS}>All versions</SelectItem>
                  {versionOptions.map((v) => (
                    <SelectItem key={v} value={v}>Model {v}{v === activeVersion ? " (active)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Win Rate</div>
                <div className="font-mono text-2xl font-bold text-bull">{wr}%</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Resolved</div>
                <div className="font-mono text-2xl font-bold">{resolved}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Total Runs</div>
                <div className="font-mono text-2xl font-bold">{totalRuns}</div>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>

      <h2 className="text-xl font-semibold">Performance Stats</h2>


      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Overall WR" value={`${num("overall_win_rate")}%`} tone="bull" />
        <Kpi label="Last 10 WR" value={`${num("last_10_win_rate")}%`} />
        <Kpi label="Last 25 WR" value={`${num("last_25_win_rate")}%`} />
        <Kpi label="Last 50 WR" value={`${num("last_50_win_rate")}%`} />
        <Kpi label="Total" value={`${num("total")}`} />
        <Kpi label="Pending" value={`${num("pending")}`} tone="warn" />
        <Kpi label="Wins" value={`${num("wins")}`} tone="bull" />
        <Kpi label="Losses" value={`${num("losses")}`} tone="bear" />
        <Kpi label="Pushes" value={`${num("pushes")}`} />
        <Kpi label="YES WR" value={`${num("yes_win_rate")}%`} />
        <Kpi label="NO WR" value={`${num("no_win_rate")}%`} />
        <Kpi label="Avg Conf" value={`${num("avg_confidence")}%`} />
        <Kpi label="Avg Conf Wins" value={`${num("avg_confidence_wins")}%`} tone="bull" />
        <Kpi label="Avg Conf Losses" value={`${num("avg_confidence_losses")}%`} tone="bear" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Model 7 Shadow
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
              tracking-only · not trading
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(["A", "B"] as const).map((k) => {
              const b = m7Q.data?.[k] ?? { total: 0, wins: 0, losses: 0, pushes: 0, pending: 0, win_rate: 0 };
              const label = k === "A" ? "Variant A (frozen v1.1)" : "Variant B (live-retrained)";
              const pending = m7PendingQ.data?.[k] ?? null;
              const prob = pending?.probability_green;
              const probPct = typeof prob === "number" ? (prob * 100).toFixed(1) : null;
              const decision = pending?.decision ?? null;
              const decisionCls = decision === "YES" ? "text-bull border-bull/40 bg-bull/10"
                : decision === "NO" ? "text-bear border-bear/40 bg-bear/10"
                : "text-muted-foreground border-border";
              return (
                <div key={k} className="rounded-md border border-border bg-card/50 p-4">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">{label}</div>
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="text-xs text-muted-foreground">Win Rate</span>
                    <span className="font-mono text-2xl font-bold text-bull">{b.win_rate}%</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <M7Stat label="Trades" value={b.total} />
                    <M7Stat label="Wins" value={b.wins} tone="bull" />
                    <M7Stat label="Losses" value={b.losses} tone="bear" />
                    <M7Stat label="Pushes" value={b.pushes} />
                  </div>
                  <div className="mt-3 pt-3 border-t border-border/60">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                      Current pending candle
                    </div>
                    {pending && decision ? (
                      <div className="flex items-center justify-between gap-2 font-mono text-xs">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${decisionCls}`}>
                          {decision}
                          {pending.would_trade === false && (
                            <span className="text-[9px] text-muted-foreground ml-1">(no trade)</span>
                          )}
                        </span>
                        <span className="text-muted-foreground">
                          P(green): <span className="text-foreground">{probPct ?? "—"}%</span>
                        </span>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground/70 italic font-mono">no pending shadow row</div>
                    )}
                  </div>
                  {b.pending > 0 && (
                    <div className="mt-2 text-[10px] text-muted-foreground text-right font-mono">
                      {b.pending} pending
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <BreakdownCard title="By Setup Type" data={s.by_setup as Record<string, BucketStat> | undefined} />
        <BreakdownCard title="By Confidence" data={s.by_confidence_bucket as Record<string, BucketStat> | undefined} />
        <BreakdownCard title="By Market Condition" data={s.by_market_condition as Record<string, BucketStat> | undefined} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recent History</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Pred</th>
                  <th className="text-left px-3 py-2">Conf</th>
                  <th className="text-left px-3 py-2">Setup</th>
                  <th className="text-left px-3 py-2">Outcome</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {(listQ.data ?? []).slice(0, 25).map((p) => {
                  const reasoning = (p.reasoning_summary ?? p.notes ?? "").toString().trim();
                  const firstPoint = reasoning
                    ? reasoning.split(/\s•\s|(?<=[.!?])\s+/)[0]?.trim()
                    : "";
                  return (
                    <tr key={p.id} className="border-b border-border/50 align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(p.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2"><PredictionBadge value={p.prediction} /></td>
                      <td className="px-3 py-2">{Number(p.confidence).toFixed(0)}%</td>
                      <td className="px-3 py-2 text-xs max-w-[420px]">
                        <div className="font-semibold">{p.setup_type ?? "—"}</div>
                        {firstPoint ? (
                          <div className="text-muted-foreground mt-1 whitespace-normal leading-snug">
                            → {firstPoint}
                          </div>
                        ) : (
                          <div className="text-muted-foreground/60 mt-1 italic">no reasoning recorded</div>
                        )}
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface BucketStat { total: number; wins: number; losses: number; win_rate: number }

function M7Stat({ label, value, tone }: { label: string; value: number; tone?: "bull" | "bear" }) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-lg font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" | "warn" }) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : tone === "warn" ? "text-warn" : "";
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`font-mono text-2xl font-semibold mt-1 ${cls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({ title, data }: { title: string; data?: Record<string, BucketStat> }) {
  const entries = Object.entries(data ?? {});
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {entries.length === 0 ? <p className="text-sm text-muted-foreground">No data yet.</p> : (
          <ul className="space-y-2 text-sm">
            {entries.sort((a, b) => (b[1]?.total ?? 0) - (a[1]?.total ?? 0)).map(([k, v]) => (
              <li key={k} className="flex justify-between gap-2 items-baseline">
                <span className="truncate text-xs">{k}</span>
                <span className="font-mono text-xs whitespace-nowrap">
                  {v.win_rate}% · {v.wins}W/{v.losses}L · n={v.total}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
