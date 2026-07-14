import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPredictionStats, listPredictions, listModelVersions, getModel7ShadowStats, getModel7ShadowPending, exportModel7Shadow, listVariantB4_2Recent, getModelCShadowStats, getModelCShadowPending, exportModelCShadow } from "@/lib/predictions.functions";
import { Button } from "@/components/ui/button";
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
  const m7Q = useQuery({ queryKey: ["model7-shadow-stats"], queryFn: () => m7Fn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const m7PendingFn = useServerFn(getModel7ShadowPending);
  const m7PendingQ = useQuery({ queryKey: ["model7-shadow-pending"], queryFn: () => m7PendingFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const mcFn = useServerFn(getModelCShadowStats);
  const mcQ = useQuery({ queryKey: ["modelc-shadow-stats"], queryFn: () => mcFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const mcPendingFn = useServerFn(getModelCShadowPending);
  const mcPendingQ = useQuery({ queryKey: ["modelc-shadow-pending"], queryFn: () => mcPendingFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const exportM7Fn = useServerFn(exportModel7Shadow);
  const exportMCFn = useServerFn(exportModelCShadow);
  type ExportScope = "all" | "A" | "B" | "B2" | "B4_2" | "A2_Conflict" | "A2_MidBand" | "A2_Combined";
  const [exporting, setExporting] = useState<null | ExportScope>(null);
  const [exportingMC, setExportingMC] = useState(false);

  async function downloadMCCsv() {
    try {
      setExportingMC(true);
      const rows = await exportMCFn();
      if (rows.length === 0) { alert("No Model C shadow rows to export."); return; }
      const headers = Object.keys(rows[0]);
      const esc = (v: unknown) => {
        if (v === null || v === undefined) return "";
        const s = typeof v === "string" ? v : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [headers.join(","), ...rows.map((r: any) => headers.map((h) => esc(r[h])).join(","))].join("\n");
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `modelc-shadow-${stamp}.csv`; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingMC(false);
    }
  }

  async function downloadM7Csv(scope: ExportScope) {
    try {
      setExporting(scope);
      const rows = await exportM7Fn();
      const filtered = scope === "all" ? rows : rows.filter((r: any) => r.variant === scope);
      if (filtered.length === 0) { alert("No shadow rows to export."); return; }
      const headers = Object.keys(filtered[0]);
      const esc = (v: unknown) => {
        if (v === null || v === undefined) return "";
        const s = typeof v === "string" ? v : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [headers.join(","), ...filtered.map((r: any) => headers.map((h) => esc(r[h])).join(","))].join("\n");
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      const name = scope === "all" ? `model7-shadow-all-${stamp}.csv` : `model7-shadow-variant${scope}-${stamp}.csv`;

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  }

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
  const b2RecentFn = useServerFn(listVariantB4_2Recent);
  const listQ = useQuery({
    queryKey: ["b42-recent-stats"],
    queryFn: () => b2RecentFn(),
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  useEffect(() => {
    const ch = supabase
      .channel("stats-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["stats"] });
        qc.invalidateQueries({ queryKey: ["predictions-list"] });
        qc.invalidateQueries({ queryKey: ["model-versions"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "model7_shadow" }, () => {
        qc.invalidateQueries({ queryKey: ["model7-shadow-stats"] });
        qc.invalidateQueries({ queryKey: ["model7-shadow-pending"] });
        qc.invalidateQueries({ queryKey: ["b2-recent"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "model_c_shadow" }, () => {
        qc.invalidateQueries({ queryKey: ["modelc-shadow-stats"] });
        qc.invalidateQueries({ queryKey: ["modelc-shadow-pending"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const s = (statsQ.data ?? {}) as Record<string, unknown>;
  const num = (k: string) => Number(s[k] ?? 0);

  const modelVersion = activeVersion ?? "—";
  const b2Hero = m7Q.data?.B4_2 ?? { total: 0, wins: 0, losses: 0, pushes: 0, pending: 0, win_rate: 0, last_10_win_rate: 0, last_25_win_rate: 0, last_50_win_rate: 0, yes_total: 0, yes_wins: 0, yes_win_rate: 0, no_total: 0, no_wins: 0, no_win_rate: 0, avg_confidence: 0, avg_confidence_wins: 0, avg_confidence_losses: 0 };
  const b2Resolved = b2Hero.wins + b2Hero.losses + b2Hero.pushes;
  const isLive = Boolean(settingsQ.data?.auto_run_enabled);

  const versions = versionsQ.data ?? [];
  const versionOptions = useMemo(() => {
    const list = versions.map((v) => v.version);
    if (activeVersion && !list.includes(activeVersion)) list.unshift(activeVersion);
    return list;
  }, [versions, activeVersion]);

  const badge = "B4.2";
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
                Variant B4.2 · BTCUSDT 15m
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${isLive ? "border-bull/40 text-bull bg-bull/10" : "border-border text-muted-foreground"}`}>
                  <span className={`size-1.5 rounded-full ${isLive ? "bg-bull animate-pulse" : "bg-muted-foreground"}`} />
                  {isLive ? "AUTO LIVE" : "MANUAL"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">
                autobet: Variant B4.2 · feature engine: Model {modelVersion} · breakdowns below: {scopeLabel}
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
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">B4.2 Win Rate</div>
                <div className="font-mono text-2xl font-bold text-bull">{b2Hero.win_rate}%</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">B4.2 Resolved</div>
                <div className="font-mono text-2xl font-bold">{b2Resolved}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">B4.2 Trades</div>
                <div className="font-mono text-2xl font-bold">{b2Hero.total}</div>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>

      <h2 className="text-xl font-semibold">Performance Stats <span className="text-xs font-normal text-muted-foreground">— Variant B4.2 (autobet)</span></h2>


      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Overall WR" value={`${b2Hero.win_rate}%`} tone="bull" />
        <Kpi label="Last 10 WR" value={`${b2Hero.last_10_win_rate ?? 0}%`} />
        <Kpi label="Last 25 WR" value={`${b2Hero.last_25_win_rate ?? 0}%`} />
        <Kpi label="Last 50 WR" value={`${b2Hero.last_50_win_rate ?? 0}%`} />
        <Kpi label="Total" value={`${b2Hero.total}`} />
        <Kpi label="Pending" value={`${b2Hero.pending}`} tone="warn" />
        <Kpi label="Wins" value={`${b2Hero.wins}`} tone="bull" />
        <Kpi label="Losses" value={`${b2Hero.losses}`} tone="bear" />
        <Kpi label="Pushes" value={`${b2Hero.pushes}`} />
        <Kpi label="YES WR" value={`${b2Hero.yes_win_rate ?? 0}%`} />
        <Kpi label="NO WR" value={`${b2Hero.no_win_rate ?? 0}%`} />
        <Kpi label="Avg Conf" value={`${b2Hero.avg_confidence ?? 0}%`} />
        <Kpi label="Avg Conf Wins" value={`${b2Hero.avg_confidence_wins ?? 0}%`} tone="bull" />
        <Kpi label="Avg Conf Losses" value={`${b2Hero.avg_confidence_losses ?? 0}%`} tone="bear" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              Model 7 Shadow
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
                tracking-only · not trading
              </span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exporting !== null} onClick={() => downloadM7Csv("all")}>
                {exporting === "all" ? "Exporting…" : "CSV (All)"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exporting !== null} onClick={() => downloadM7Csv("A")}>
                {exporting === "A" ? "…" : "Variant A"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exporting !== null} onClick={() => downloadM7Csv("B")}>
                {exporting === "B" ? "…" : "Variant B"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exporting !== null} onClick={() => downloadM7Csv("B2")}>
                {exporting === "B2" ? "…" : "Variant B2"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exporting !== null} onClick={() => downloadM7Csv("B4_2")}>
                {exporting === "B4_2" ? "…" : "Variant B4.2"}
              </Button>

            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {(["A", "B", "B2", "M6"] as const).map((k) => {
              const isM6 = k === "M6";
              const b = isM6
                ? {
                    total: num("total"),
                    wins: num("wins"),
                    losses: num("losses"),
                    pushes: num("pushes"),
                    pending: num("pending"),
                    win_rate: num("overall_win_rate"),
                  }
                : (m7Q.data as any)?.[k] ?? { total: 0, wins: 0, losses: 0, pushes: 0, pending: 0, win_rate: 0 };
              const label = k === "A"
                ? "Variant A (frozen v1.1)"
                : k === "B"
                ? "Variant B (live-retrained)"
                : k === "B2"
                ? "Variant B2 (B minus NCE override)"
                : "Model 6";
              const pending = !isM6 ? (m7PendingQ.data as any)?.[k] ?? null : null;

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
                  {!isM6 && (
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
                  )}
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

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              Model C Shadow
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
                dual-horizon · tracking-only · not trading
              </span>
            </CardTitle>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exportingMC} onClick={downloadMCCsv}>
              {exportingMC ? "Exporting…" : "CSV (Model C)"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {(() => {
            const blank = { total: 0, wins: 0, losses: 0, pushes: 0, pending: 0, win_rate: 0 };
            const mc = mcQ.data ?? { dual_horizon: blank, global_only: blank };
            const pendingData = mcPendingQ.data as {
              dual_horizon?: {
                ensemble_probability_green?: number | null;
                global_probability_green?: number | null;
                recent_probability_green?: number | null;
                final_decision?: string | null;
                trade?: boolean | null;
              } | null;
              global_only?: {
                ensemble_probability_green?: number | null;
                global_probability_green?: number | null;
                recent_probability_green?: number | null;
                final_decision?: string | null;
                trade?: boolean | null;
              } | null;
            } | null;
            const cards = [
              { key: "dual_horizon" as const, title: "Dual-Horizon Ensemble", stat: mc.dual_horizon ?? blank, pending: pendingData?.dual_horizon ?? null },
              { key: "global_only" as const, title: "Global-Only Diagnostic", stat: mc.global_only ?? blank, pending: pendingData?.global_only ?? null },
            ];
            return (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {cards.map(({ key, title, stat, pending }) => {
                  const decision = pending?.final_decision ?? null;
                  const decisionCls = decision === "YES" ? "text-bull border-bull/40 bg-bull/10"
                    : decision === "NO" ? "text-bear border-bear/40 bg-bear/10"
                    : "text-muted-foreground border-border";
                  const pEns = typeof pending?.ensemble_probability_green === "number" ? (pending.ensemble_probability_green * 100).toFixed(1) : null;
                  const pGlobal = typeof pending?.global_probability_green === "number" ? (pending.global_probability_green * 100).toFixed(1) : null;
                  const pRecent = typeof pending?.recent_probability_green === "number" ? (pending.recent_probability_green * 100).toFixed(1) : null;
                  return (
                    <div key={key} className="rounded-md border border-border bg-card/50 p-4">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">{title}</div>
                      <div className="flex items-baseline justify-between mb-3">
                        <span className="text-xs text-muted-foreground">Win Rate</span>
                        <span className="font-mono text-2xl font-bold text-bull">{stat.win_rate}%</span>
                      </div>
                      <div className="grid grid-cols-5 gap-2 text-center">
                        <M7Stat label="Trades" value={stat.total} />
                        <M7Stat label="Wins" value={stat.wins} tone="bull" />
                        <M7Stat label="Losses" value={stat.losses} tone="bear" />
                        <M7Stat label="Pushes" value={stat.pushes} />
                        <M7Stat label="Pending" value={stat.pending} />
                      </div>
                      <div className="mt-3 pt-3 border-t border-border/60">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                          Current pending candle
                        </div>
                        {pending && decision ? (
                          <div className="flex items-center justify-between gap-2 font-mono text-xs">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${decisionCls}`}>
                              {decision}
                              {pending.trade === false && (
                                <span className="text-[9px] text-muted-foreground ml-1">(no trade)</span>
                              )}
                            </span>
                            <span className="text-muted-foreground">
                              P: <span className="text-foreground">{pEns ?? "—"}%</span>
                              <span className="mx-1.5 text-muted-foreground/60">·</span>
                              G: <span className="text-foreground">{pGlobal ?? "—"}%</span>
                              {key === "dual_horizon" && (
                                <>
                                  <span className="mx-1.5 text-muted-foreground/60">·</span>
                                  R: <span className="text-foreground">{pRecent ?? "—"}%</span>
                                </>
                              )}
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground/70 italic font-mono">no pending shadow row</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </CardContent>
      </Card>


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <BreakdownCard title="By Setup Type" data={s.by_setup as Record<string, BucketStat> | undefined} />
        <BreakdownCard title="By Confidence" data={s.by_confidence_bucket as Record<string, BucketStat> | undefined} />
        <BreakdownCard title="By Market Condition" data={s.by_market_condition as Record<string, BucketStat> | undefined} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Recent History
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
              Variant B4.2
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2">Candle</th>
                  <th className="text-left px-3 py-2">Pred</th>
                  <th className="text-left px-3 py-2">Conf</th>
                  <th className="text-left px-3 py-2">Close</th>
                  <th className="text-left px-3 py-2">Outcome</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {(listQ.data ?? []).slice(0, 25).map((p: any) => (
                  <tr key={p.id} className="border-b border-border/50 align-top">
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(p.candle_ts).toLocaleString()}</td>
                    <td className="px-3 py-2"><PredictionBadge value={p.prediction} /></td>
                    <td className="px-3 py-2">{Number(p.confidence).toFixed(0)}%</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {p.actual_next_candle_close != null ? `$${Number(p.actual_next_candle_close).toLocaleString()}` : "—"}
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
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
