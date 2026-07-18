import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPredictionStats, listPredictions, listModelVersions, getModel7ShadowStats, getModel7ShadowPending, exportModel7Shadow, listVariantA2ConflictRecent, listAllPredictionsForHistory, getTd1RcShadowStats, getTd1RcShadowPending, exportTd1RcShadow, getTd1RcTrainingProgress, listTd1RcRecent, getAas96ShadowStats, getAas96ShadowPending, exportAas96Shadow, getAas96VetoStats } from "@/lib/predictions.functions";
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
  const exportM7Fn = useServerFn(exportModel7Shadow);
  const exportAllPredsFn = useServerFn(listAllPredictionsForHistory);
  const td1Fn = useServerFn(getTd1RcShadowStats);
  const td1Q = useQuery({ queryKey: ["td1-rc-shadow-stats"], queryFn: () => td1Fn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const td1PendingFn = useServerFn(getTd1RcShadowPending);
  const td1PendingQ = useQuery({ queryKey: ["td1-rc-shadow-pending"], queryFn: () => td1PendingFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const exportTd1Fn = useServerFn(exportTd1RcShadow);
  const td1ProgressFn = useServerFn(getTd1RcTrainingProgress);
  const td1ProgressQ = useQuery({ queryKey: ["td1-rc-training-progress"], queryFn: () => td1ProgressFn(), refetchInterval: 15_000, refetchIntervalInBackground: true, staleTime: 0 });
  const aas96Fn = useServerFn(getAas96ShadowStats);
  const aas96Q = useQuery({ queryKey: ["aas96-shadow-stats"], queryFn: () => aas96Fn(), refetchInterval: 10_000, refetchIntervalInBackground: true, staleTime: 0 });
  const aas96PendingFn = useServerFn(getAas96ShadowPending);
  const aas96PendingQ = useQuery({ queryKey: ["aas96-shadow-pending"], queryFn: () => aas96PendingFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const exportAas96Fn = useServerFn(exportAas96Shadow);
  const aas96VetoFn = useServerFn(getAas96VetoStats);
  const aas96VetoQ = useQuery({ queryKey: ["aas96-veto-stats"], queryFn: () => aas96VetoFn(), refetchInterval: 15_000, refetchIntervalInBackground: true, staleTime: 0 });

  const [exportingAas96, setExportingAas96] = useState(false);
  type ExportScope = "all" | "A" | "B" | "B2" | "B4_2" | "A2_Conflict" | "A2_MidBand" | "A2_Combined";
  const [exporting, setExporting] = useState<null | ExportScope>(null);
  const [exportingTd1, setExportingTd1] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);

  async function downloadAas96Csv() {
    try {
      setExportingAas96(true);
      const rows = await exportAas96Fn();
      if (rows.length === 0) { alert("No AAS96 rows to export."); return; }
      triggerDownload(rowsToCsv(rows as any[]), `aas96-shadow-${stamp()}.csv`);
    } finally {
      setExportingAas96(false);
    }
  }


  function rowsToCsv(rows: any[]): string {
    if (rows.length === 0) return "";
    const headers = Object.keys(rows[0]);
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  }

  function triggerDownload(csv: string, filename: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function stamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }


  async function downloadTd1Csv() {
    try {
      setExportingTd1(true);
      const rows = await exportTd1Fn();
      if (rows.length === 0) { alert("No TD1-RC shadow rows to export."); return; }
      triggerDownload(rowsToCsv(rows as any[]), `td1-rc-shadow-${stamp()}.csv`);
    } finally {
      setExportingTd1(false);
    }
  }

  async function downloadM7Csv(scope: ExportScope) {
    try {
      setExporting(scope);
      const rows = await exportM7Fn();
      const filtered = scope === "all" ? rows : rows.filter((r: any) => r.variant === scope);
      if (filtered.length === 0) { alert("No shadow rows to export."); return; }
      const name = scope === "all" ? `model7-shadow-all-${stamp()}.csv` : `model7-shadow-variant${scope}-${stamp()}.csv`;
      triggerDownload(rowsToCsv(filtered as any[]), name);
    } finally {
      setExporting(null);
    }
  }

  async function downloadAllModelsCsv() {
    try {
      setExportingAll(true);
      const [m7, td1, preds] = await Promise.all([
        exportM7Fn(),
        exportTd1Fn(),
        exportAllPredsFn(),
      ]);
      const s = stamp();
      if ((m7 ?? []).length) triggerDownload(rowsToCsv(m7 as any[]), `all-models-${s}-model7-shadow.csv`);
      if ((td1 ?? []).length) triggerDownload(rowsToCsv(td1 as any[]), `all-models-${s}-td1-rc-shadow.csv`);
      if ((preds ?? []).length) triggerDownload(rowsToCsv(preds as any[]), `all-models-${s}-predictions.csv`);
      if (!(m7 ?? []).length && !(td1 ?? []).length && !(preds ?? []).length) {
        alert("No rows to export.");
      }
    } finally {
      setExportingAll(false);
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
  const td1RecentFn = useServerFn(listTd1RcRecent);
  const listQ = useQuery({
    queryKey: ["td1-rc-recent-stats"],
    queryFn: () => td1RecentFn(),
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
      .on("postgres_changes", { event: "*", schema: "public", table: "model7_td1_rc_shadow" }, () => {
        qc.invalidateQueries({ queryKey: ["td1-rc-shadow-stats"] });
        qc.invalidateQueries({ queryKey: ["td1-rc-shadow-pending"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const s = (statsQ.data ?? {}) as Record<string, unknown>;
  const num = (k: string) => Number(s[k] ?? 0);

  const modelVersion = activeVersion ?? "—";
  const td1Stats = (td1Q.data ?? {}) as Record<string, any>;
  const b2Hero = {
    total: Number(td1Stats.total ?? 0),
    wins: Number(td1Stats.wins ?? 0),
    losses: Number(td1Stats.losses ?? 0),
    pushes: Number(td1Stats.pushes ?? 0),
    pending: Number(td1Stats.pending ?? 0),
    win_rate: Number(td1Stats.win_rate ?? 0),
    last_10_win_rate: Number(td1Stats.last_10_win_rate ?? 0),
    last_25_win_rate: Number(td1Stats.last_25_win_rate ?? 0),
    last_50_win_rate: Number(td1Stats.last_50_win_rate ?? 0),
    yes_total: Number(td1Stats.yes_total ?? 0),
    yes_wins: Number(td1Stats.yes_wins ?? 0),
    yes_win_rate: Number(td1Stats.yes_win_rate ?? 0),
    no_total: Number(td1Stats.no_total ?? 0),
    no_wins: Number(td1Stats.no_wins ?? 0),
    no_win_rate: Number(td1Stats.no_win_rate ?? 0),
    avg_confidence: Number(td1Stats.avg_confidence ?? 0),
    avg_confidence_wins: Number(td1Stats.avg_confidence_wins ?? 0),
    avg_confidence_losses: Number(td1Stats.avg_confidence_losses ?? 0),
  };
  const b2Resolved = b2Hero.wins + b2Hero.losses + b2Hero.pushes;
  const isLive = Boolean(settingsQ.data?.auto_run_enabled);

  const versions = versionsQ.data ?? [];
  const versionOptions = useMemo(() => {
    const list = versions.map((v) => v.version);
    if (activeVersion && !list.includes(activeVersion)) list.unshift(activeVersion);
    return list;
  }, [versions, activeVersion]);

  const badge = "TD1";

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
                TD1-RC (A2 Combined Layer) · BTCUSDT 15m
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${isLive ? "border-bull/40 text-bull bg-bull/10" : "border-border text-muted-foreground"}`}>
                  <span className={`size-1.5 rounded-full ${isLive ? "bg-bull animate-pulse" : "bg-muted-foreground"}`} />
                  {isLive ? "AUTO LIVE" : "MANUAL"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">
                autobet: TD1-RC (A2 Combined + TD1 veto/containment) · feature engine: Model {modelVersion} · breakdowns below: {scopeLabel}
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
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">TD1 Win Rate</div>
                <div className="font-mono text-2xl font-bold text-bull">{b2Hero.win_rate}%</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">TD1 Resolved</div>
                <div className="font-mono text-2xl font-bold">{b2Resolved}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">TD1 Trades</div>
                <div className="font-mono text-2xl font-bold">{b2Hero.total}</div>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>

      <h2 className="text-xl font-semibold">Performance Stats <span className="text-xs font-normal text-muted-foreground">— TD1-RC (autobet)</span></h2>


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
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exportingAll} onClick={downloadAllModelsCsv}>
                {exportingAll ? "Exporting…" : "CSV (All Models)"}
              </Button>
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
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exporting !== null} onClick={() => downloadM7Csv("A2_Conflict")}>
                {exporting === "A2_Conflict" ? "…" : "A2 Conflict"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exporting !== null} onClick={() => downloadM7Csv("A2_MidBand")}>
                {exporting === "A2_MidBand" ? "…" : "A2 MidBand"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exporting !== null} onClick={() => downloadM7Csv("A2_Combined")}>
                {exporting === "A2_Combined" ? "…" : "A2 Combined"}
              </Button>

            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {(["A", "B2", "M6"] as const).map((k) => {
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
          <CardTitle className="text-base flex items-center gap-2">
            Variant A2 — Three-Policy Shadow
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
              post-decision filter on Variant A · tracking-only · not trading
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {(["A2_Combined"] as const).map((k) => {
              const b = (m7Q.data as any)?.[k] ?? { total: 0, wins: 0, losses: 0, pushes: 0, pending: 0, win_rate: 0 };
              const pending = (m7PendingQ.data as any)?.[k] ?? null;
              const label = "A2 Combined (union of both)";
              const decision = pending?.decision ?? null;
              const prob = pending?.probability_green;
              const probPct = typeof prob === "number" ? (prob * 100).toFixed(1) : null;
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
                            <span className="text-[9px] text-muted-foreground ml-1">(skipped)</span>
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



      {/* TD1-RC Shadow (Model 8 layer) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>TD1-RC Shadow (A2 Combined + TD1 Veto & Containment)</span>
            <Button size="sm" variant="outline" onClick={downloadTd1Csv} disabled={exportingTd1}>
              {exportingTd1 ? "Exporting…" : "CSV (TD1-RC)"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(() => {
            const t = (td1Q.data ?? {}) as Record<string, any>;
            const p = (td1PendingQ.data ?? null) as Record<string, any> | null;
            const prog = (td1ProgressQ.data ?? null) as null | { phase: string; label: string; current: number; target: number; remaining: number; percent: number; ready: boolean };
            return (
              <>
                {prog ? (
                  prog.phase !== "ready" ? (
                    <div className="rounded-md border p-3">
                      <div className="flex items-center justify-between text-xs mb-2">
                        <div className="font-medium">{prog.label}</div>
                        <div className="text-muted-foreground tabular-nums">
                          {prog.current} / {prog.target}
                          <span className="ml-2">({prog.remaining} candles left)</span>
                        </div>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full transition-all bg-amber-500"
                          style={{ width: `${Math.max(2, Math.min(100, prog.percent))}%` }}
                        />
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Collecting resolved A2 Combined signals — TD1 will fail-closed (SKIP) until the first fit promotes.
                      </div>
                    </div>
                  ) : null
                ) : null}

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <Stat label="Win rate" value={`${(t.win_rate ?? 0)}%`} />
                  <Stat label="Trades" value={String(t.total ?? 0)} />
                  <Stat label="Wins" value={String(t.wins ?? 0)} />
                  <Stat label="Losses" value={String(t.losses ?? 0)} />
                  <Stat label="Pending" value={String(t.pending ?? 0)} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat label="Last 10" value={`${(t.last_10_win_rate ?? 0)}%`} />
                  <Stat label="Last 25" value={`${(t.last_25_win_rate ?? 0)}%`} />
                  <Stat label="TD1 vetoes" value={String(t.td1_vetoes ?? 0)} />
                  <Stat label="Containment vetoes" value={String(t.containment_vetoes ?? 0)} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Stat label="A2 baseline WR" value={`${(t.a2_baseline_win_rate ?? 0)}%`} />
                  <Stat label="A2 baseline W" value={String(t.a2_baseline_wins ?? 0)} />
                  <Stat label="A2 baseline L" value={String(t.a2_baseline_losses ?? 0)} />
                </div>
                <div className="rounded-md border p-3 text-sm">
                  <div className="font-medium mb-1">Current pending candle</div>
                  {p ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div><span className="text-muted-foreground">Decision:</span> {String(p.external_final_decision ?? "—")}</div>
                      <div><span className="text-muted-foreground">A2 orig:</span> {String(p.a2_original_decision ?? "—")}</div>
                      <div><span className="text-muted-foreground">p(loss):</span> {p.td1_predicted_loss_probability != null ? Number(p.td1_predicted_loss_probability).toFixed(4) : "—"}</div>
                      <div><span className="text-muted-foreground">Skip reason:</span> {String(p.skip_reason ?? "—")}</div>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">No pending row.</div>
                  )}
                </div>
              </>
            );
          })()}
        </CardContent>
      </Card>

      {/* AAS96 Shadow — Adaptive Armor Stack (independent, non-webhook) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>AAS96 Shadow (Adaptive Armor Stack)</span>
            <Button size="sm" variant="outline" onClick={downloadAas96Csv} disabled={exportingAas96}>
              {exportingAas96 ? "Exporting…" : "CSV (AAS96)"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(() => {
            const a = (aas96Q.data ?? {}) as Record<string, any>;
            const trained = Number(a.training_row_count ?? 0);
            return (
              <>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <Stat label="Win rate" value={`${a.win_rate ?? 0}%`} />
                  <Stat label="Trades (W+L)" value={String((Number(a.win ?? 0) + Number(a.loss ?? 0)))} />
                  <Stat label="Wins" value={String(a.win ?? 0)} />
                  <Stat label="Losses" value={String(a.loss ?? 0)} />
                  <Stat label="Pending" value={String(a.pending ?? 0)} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat label="Skips" value={String(a.skip ?? 0)} />
                  <Stat label="Pushes" value={String(a.push ?? 0)} />
                  <Stat label="Total rows" value={String(a.total ?? 0)} />
                  <Stat label="Training rows" value={String(trained)} />
                </div>
                {(() => {
                  const p = aas96PendingQ.data as Record<string, any> | null;
                  if (!p) return null;
                  const dir = p.published_prediction ?? p.final_prediction ?? "—";
                  return (
                    <div className="rounded-md border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium">Current pending candle</div>
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          {p.candle_ts ? new Date(p.candle_ts).toLocaleString() : "—"}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Stat label="Published" value={String(dir)} />
                        <Stat label="Baseline" value={String(p.baseline_prediction ?? "—")} />
                        <Stat label="Selected layer" value={String(p.selected_layer ?? "—")} />
                        <Stat label="Horizons (32/64/96/192)" value={String(p.layer_b_horizon_pattern ?? "—")} />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Stat label="Layer A" value={String(p.layer_a_final_direction ?? "—")} />
                        <Stat label="Layer B" value={String(p.layer_b_final_direction ?? "—")} />
                        <Stat label="Layer A prob (mean)" value={p.layer_a_prob_mean != null ? Number(p.layer_a_prob_mean).toFixed(4) : "—"} />
                        <Stat label="Cleanup Veto V1" value={p.cleanup_veto_v1_fired ? "FIRED" : "no"} />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Stat label="Armor override" value={p.armor_override_fired ? "YES" : "no"} />
                        <Stat label="Eligible" value={p.eligibility_passed ? "yes" : "no"} />
                        <Stat label="Status" value={String(p.status ?? "—")} />
                        <Stat label="Conflict subtype" value={String(p.cleanup_veto_v1_conflict_subtype ?? "—")} />
                      </div>
                      {(p.skip_reason || p.armor_override_reason || p.published_abstain_reason) ? (
                        <div className="text-[11px] text-muted-foreground">
                          {p.published_abstain_reason ? <div>abstain: {String(p.published_abstain_reason)}</div> : null}
                          {p.skip_reason ? <div>skip: {String(p.skip_reason)}</div> : null}
                          {p.armor_override_reason ? <div>armor: {String(p.armor_override_reason)}</div> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}

                {/* Cleanup Veto V1 — independent evaluation of the overlay. */}
                {(() => {
                  const v = (aas96VetoQ.data ?? {}) as Record<string, any>;
                  const subtype = (v.by_subtype ?? {}) as Record<string, { fired: number; avoided: number; sacrificed: number; net: number }>;
                  const pattern = (v.by_pattern ?? {}) as Record<string, { total: number; fired: number; avoided: number; sacrificed: number; net: number }>;
                  const weekly = (v.weekly ?? []) as Array<Record<string, any>>;
                  const avoidedPerSac = v.avoided_per_sacrificed;
                  const avoidedPerSacStr = avoidedPerSac === Number.POSITIVE_INFINITY || avoidedPerSac === "Infinity"
                    ? "∞" : String(avoidedPerSac ?? 0);
                  return (
                    <div className="rounded-md border p-3 space-y-3">
                      <div className="text-xs font-medium">Cleanup Veto V1 Performance</div>

                      {/* Primary: wins − losses (net score). Win rate secondary. */}
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <Stat label="Baseline net (W−L)" value={String(v.baseline_net_score ?? 0)} />
                        <Stat label="Published net (W−L)" value={String(v.published_net_score ?? 0)} />
                        <Stat label="Net-score improvement" value={String(v.net_score_improvement ?? 0)} />
                        <Stat label="Coverage" value={`${v.coverage_pct ?? 0}%`} />
                        <Stat label="Predictions retained" value={String(v.predictions_retained ?? 0)} />
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <Stat label="Baseline W / L / A" value={`${v.baseline_wins ?? 0} / ${v.baseline_losses ?? 0} / ${v.published_abstains ?? 0}`} />
                        <Stat label="Published W / L / A" value={`${v.published_wins ?? 0} / ${v.published_losses ?? 0} / ${v.published_abstains ?? 0}`} />
                        <Stat label="Baseline win rate (2°)" value={`${v.baseline_win_rate ?? 0}%`} />
                        <Stat label="Published win rate (2°)" value={`${v.published_win_rate ?? 0}%`} />
                        <Stat label="Non-evaluable rows" value={String(v.non_evaluable ?? 0)} />
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <Stat label="Veto triggers" value={String(v.fired ?? 0)} />
                        <Stat label="Losses avoided" value={String(v.avoided_losses ?? 0)} />
                        <Stat label="Wins sacrificed" value={String(v.sacrificed_wins ?? 0)} />
                        <Stat label="Veto net effect" value={String(v.net_effect ?? 0)} />
                        <Stat label="Avoided / sacrificed" value={avoidedPerSacStr} />
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <Stat label="Fire rate" value={`${v.fire_rate ?? 0}%`} />
                        <Stat label="Precision (avoided/fired)" value={`${v.precision_when_fired ?? 0}%`} />
                        <Stat label="Baseline max DD" value={String(v.baseline_max_drawdown ?? 0)} />
                        <Stat label="Published max DD" value={String(v.published_max_drawdown ?? 0)} />
                        <Stat label="Longest losing streak (B / P)" value={`${v.baseline_longest_losing_streak ?? 0} / ${v.published_longest_losing_streak ?? 0}`} />
                      </div>

                      {Object.keys(subtype).length > 0 ? (
                        <div className="pt-1">
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">By conflict subtype</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="text-muted-foreground">
                                <tr>
                                  <th className="text-left px-2 py-1">Subtype</th>
                                  <th className="text-right px-2 py-1">Fired</th>
                                  <th className="text-right px-2 py-1">Avoided</th>
                                  <th className="text-right px-2 py-1">Sacrificed</th>
                                  <th className="text-right px-2 py-1">Net</th>
                                </tr>
                              </thead>
                              <tbody className="font-mono">
                                {Object.entries(subtype).map(([k, s]) => (
                                  <tr key={k} className="border-t border-border/50">
                                    <td className="px-2 py-1">{k}</td>
                                    <td className="px-2 py-1 text-right">{s.fired}</td>
                                    <td className="px-2 py-1 text-right">{s.avoided}</td>
                                    <td className="px-2 py-1 text-right">{s.sacrificed}</td>
                                    <td className="px-2 py-1 text-right">{s.net}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}

                      {Object.keys(pattern).length > 0 ? (
                        <div className="pt-1">
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">By exact horizon pattern (H32/H64/H96/H192)</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="text-muted-foreground">
                                <tr>
                                  <th className="text-left px-2 py-1">Pattern</th>
                                  <th className="text-right px-2 py-1">Total</th>
                                  <th className="text-right px-2 py-1">Fired</th>
                                  <th className="text-right px-2 py-1">Avoided</th>
                                  <th className="text-right px-2 py-1">Sacrificed</th>
                                  <th className="text-right px-2 py-1">Net</th>
                                </tr>
                              </thead>
                              <tbody className="font-mono">
                                {Object.entries(pattern).sort((a,b)=>b[1].total-a[1].total).map(([k, s]) => (
                                  <tr key={k} className="border-t border-border/50">
                                    <td className="px-2 py-1">{k}</td>
                                    <td className="px-2 py-1 text-right">{s.total}</td>
                                    <td className="px-2 py-1 text-right">{s.fired}</td>
                                    <td className="px-2 py-1 text-right">{s.avoided}</td>
                                    <td className="px-2 py-1 text-right">{s.sacrificed}</td>
                                    <td className="px-2 py-1 text-right">{s.net}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}

                      {weekly.length > 0 ? (
                        <div className="pt-1">
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Weekly (ISO week, Mon-start UTC)</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="text-muted-foreground">
                                <tr>
                                  <th className="text-left px-2 py-1">Week</th>
                                  <th className="text-right px-2 py-1">Fired</th>
                                  <th className="text-right px-2 py-1">Avoided</th>
                                  <th className="text-right px-2 py-1">Sacrificed</th>
                                  <th className="text-right px-2 py-1">Veto net</th>
                                  <th className="text-right px-2 py-1">Baseline net</th>
                                  <th className="text-right px-2 py-1">Published net</th>
                                  <th className="text-right px-2 py-1">Δ Net</th>
                                  <th className="text-right px-2 py-1">Coverage</th>
                                  <th className="text-right px-2 py-1">B DD</th>
                                  <th className="text-right px-2 py-1">P DD</th>
                                </tr>
                              </thead>
                              <tbody className="font-mono">
                                {weekly.slice(-12).reverse().map((w) => (
                                  <tr key={w.week_start} className="border-t border-border/50">
                                    <td className="px-2 py-1">{w.week_start}</td>
                                    <td className="px-2 py-1 text-right">{w.fired}</td>
                                    <td className="px-2 py-1 text-right">{w.avoided_losses}</td>
                                    <td className="px-2 py-1 text-right">{w.sacrificed_wins}</td>
                                    <td className="px-2 py-1 text-right">{w.net_effect}</td>
                                    <td className="px-2 py-1 text-right">{w.baseline_net}</td>
                                    <td className="px-2 py-1 text-right">{w.published_net}</td>
                                    <td className="px-2 py-1 text-right">{w.net_score_delta}</td>
                                    <td className="px-2 py-1 text-right">{w.coverage_pct}%</td>
                                    <td className="px-2 py-1 text-right">{w.baseline_max_drawdown}</td>
                                    <td className="px-2 py-1 text-right">{w.published_max_drawdown}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </>
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
              TD1-RC · Outcome follows TD1-RC
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2">Candle</th>
                  <th className="text-left px-3 py-2">TD1-RC</th>
                  <th className="text-left px-3 py-2">A2 Combined</th>
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
                    <td className="px-3 py-2"><PredictionBadge value={p.a2_combined ?? "—"} /></td>
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

function M7Stat({ label, value, tone }: { label: string; value: number | string; tone?: "bull" | "bear" }) {
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm mt-0.5">{value}</div>
    </div>
  );
}
