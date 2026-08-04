import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getPredictionStats,
  listPredictions,
  listModelVersions,
  getTd1RcShadowStats,
  getTd1RcShadowPending,
  exportTd1RcShadow,
  getTd1RcTrainingProgress,
  listTd1RcRecent,
  getA96Stats,
  getA96Pending,
  exportA96Csv,
  exportA96CombinedCsv,
  resetA96VisualStats,
  resetTd1RcVisualStats,
} from "@/lib/predictions.functions";
import { getV6Stats, getV6Pending, exportV6Csv, getV6Warmup, getV6RegimeInverter, resetV6VisualStats } from "@/lib/v6.functions";
import { initV6Warmup, runV6AtBoundary } from "@/lib/v6-admin.functions";
import { Button } from "@/components/ui/button";
import { getActiveSettings } from "@/lib/settings.functions";
import { PredictionBadge, StatusBadge } from "@/components/status-badges";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/stats")({
  head: () => ({
    meta: [
      { title: "Stats — BTC 15m" },
      { name: "description", content: "Model performance stats for BTC 15-minute predictions." },
      { property: "og:title", content: "Stats — BTC 15m" },
      { name: "twitter:title", content: "Stats — BTC 15m" },
      { property: "og:description", content: "Model performance stats for BTC 15-minute predictions." },
      { name: "twitter:description", content: "Model performance stats for BTC 15-minute predictions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StatsPage,
});

const ALL_VERSIONS = "__all__";

function StatsPage() {
  const qc = useQueryClient();
  const statsFn = useServerFn(getPredictionStats);
  const settingsFn = useServerFn(getActiveSettings);
  const versionsFn = useServerFn(listModelVersions);

  const settingsQ = useQuery({ queryKey: ["active-settings"], queryFn: () => settingsFn() });
  const versionsQ = useQuery({ queryKey: ["model-versions"], queryFn: () => versionsFn(), refetchInterval: 60_000 });

  const td1Fn = useServerFn(getTd1RcShadowStats);
  const td1Q = useQuery({ queryKey: ["td1-rc-shadow-stats"], queryFn: () => td1Fn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const td1PendingFn = useServerFn(getTd1RcShadowPending);
  const td1PendingQ = useQuery({ queryKey: ["td1-rc-shadow-pending"], queryFn: () => td1PendingFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const exportTd1Fn = useServerFn(exportTd1RcShadow);
  const td1ProgressFn = useServerFn(getTd1RcTrainingProgress);
  const td1ProgressQ = useQuery({ queryKey: ["td1-rc-training-progress"], queryFn: () => td1ProgressFn(), refetchInterval: 15_000, refetchIntervalInBackground: true, staleTime: 0 });

  const a96Fn = useServerFn(getA96Stats);
  const a96Q = useQuery({ queryKey: ["a96-stats"], queryFn: () => a96Fn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const a96PendingFn = useServerFn(getA96Pending);
  const a96PendingQ = useQuery({ queryKey: ["a96-pending"], queryFn: () => a96PendingFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const v6Fn = useServerFn(getV6Stats);
  const v6Q = useQuery({ queryKey: ["v6-stats"], queryFn: () => v6Fn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const v6PendingFn = useServerFn(getV6Pending);
  const v6PendingQ = useQuery({ queryKey: ["v6-pending"], queryFn: () => v6PendingFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const v6WarmupFn = useServerFn(getV6Warmup);
  const v6WarmupQ = useQuery({ queryKey: ["v6-warmup"], queryFn: () => v6WarmupFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const v6InverterFn = useServerFn(getV6RegimeInverter);
  const v6InverterQ = useQuery({ queryKey: ["v6-regime-inverter"], queryFn: () => v6InverterFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const exportV6Fn = useServerFn(exportV6Csv);
  const exportA96Fn = useServerFn(exportA96Csv);
  const exportA96CombinedFn = useServerFn(exportA96CombinedCsv);
  const resetA96Fn = useServerFn(resetA96VisualStats);
  const resetTd1Fn = useServerFn(resetTd1RcVisualStats);

  const [exportingV6, setExportingV6] = useState(false);
  const [resettingV6, setResettingV6] = useState(false);
  const resetV6Fn = useServerFn(resetV6VisualStats);

  async function doResetV6Stats() {
    if (!confirm("Reset V6 visual stats to zero? The CSV export and all tracking keep every historical row.")) return;
    try {
      setResettingV6(true);
      await resetV6Fn();
      qc.invalidateQueries({ queryKey: ["v6-stats"] });
    } finally {
      setResettingV6(false);
    }
  }

  const [exportingA96, setExportingA96] = useState(false);
  const [exportingA96Combined, setExportingA96Combined] = useState(false);
  const [resettingA96, setResettingA96] = useState(false);
  const [resettingTd1, setResettingTd1] = useState(false);
  const [exportingTd1, setExportingTd1] = useState(false);


  async function downloadV6Csv() {
    try {
      setExportingV6(true);
      const res = await exportV6Fn();
      if (!res || res.rows === 0) { alert("No V6 rows to export."); return; }
      triggerDownload(res.csv, `V6-${stamp()}.csv`);
    } finally {
      setExportingV6(false);
    }
  }

  async function downloadA96Csv() {
    try {
      setExportingA96(true);
      const rows = await exportA96Fn();
      if (rows.length === 0) { alert("No a96 rows to export."); return; }
      triggerDownload(rowsToCsv(rows as any[]), `a96-${stamp()}.csv`);
    } finally {
      setExportingA96(false);
    }
  }

  async function downloadA96CombinedCsv() {
    try {
      setExportingA96Combined(true);
      const rows = await exportA96CombinedFn();
      if (rows.length === 0) { alert("No a96 / AAS96 rows to export."); return; }
      triggerDownload(rowsToCsv(rows as any[]), `a96-combined-${stamp()}.csv`);
    } finally {
      setExportingA96Combined(false);
    }
  }

  async function doResetA96Stats() {
    if (!confirm("Reset a96 visual stats to zero? The CSV export will keep all historical rows.")) return;
    try {
      setResettingA96(true);
      await resetA96Fn();
      qc.invalidateQueries({ queryKey: ["a96-stats"] });
    } finally {
      setResettingA96(false);
    }
  }

  async function doResetTd1Stats() {
    if (!confirm("Reset TD1-RC visual stats to zero? The CSV export will keep all historical rows.")) return;
    try {
      setResettingTd1(true);
      await resetTd1Fn();
      qc.invalidateQueries({ queryKey: ["td1-rc-shadow-stats"] });
      qc.invalidateQueries({ queryKey: ["td1-rc-recent-stats"] });
    } finally {
      setResettingTd1(false);
    }
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

  function rowsToCsv(rows: any[]): string {
    if (rows.length === 0) return "";
    const headerSet = new Set<string>();
    for (const r of rows) {
      if (r && typeof r === "object") for (const k of Object.keys(r)) headerSet.add(k);
    }
    const headers = Array.from(headerSet);
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r?.[h])).join(","))].join("\n");
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

  const activeVersion = settingsQ.data?.model_version ?? null;
  const [selected, setSelected] = useState<string>(ALL_VERSIONS);

  useEffect(() => {
    if (activeVersion && selected === ALL_VERSIONS) setSelected(activeVersion);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "v6_predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["v6-stats"] });
        qc.invalidateQueries({ queryKey: ["v6-pending"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "a96_predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["a96-stats"] });
        qc.invalidateQueries({ queryKey: ["a96-pending"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const s = (statsQ.data ?? {}) as Record<string, unknown>;
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
    td1_vetoes: Number(td1Stats.td1_vetoes ?? 0),
    containment_vetoes: Number(td1Stats.containment_vetoes ?? 0),
    a2_baseline_win_rate: Number(td1Stats.a2_baseline_win_rate ?? 0),
    a2_baseline_wins: Number(td1Stats.a2_baseline_wins ?? 0),
    a2_baseline_losses: Number(td1Stats.a2_baseline_losses ?? 0),
  };
  const b2Resolved = b2Hero.wins + b2Hero.losses + b2Hero.pushes;
  const isLive = Boolean(settingsQ.data?.auto_run_enabled);

  const versions = versionsQ.data ?? [];
  const versionOptions = useMemo(() => {
    const list = versions.map((v) => v.version);
    if (activeVersion && !list.includes(activeVersion)) list.unshift(activeVersion);
    return list;
  }, [versions, activeVersion]);

  const a96Stats = (a96Q.data ?? {}) as Record<string, any>;
  const a96Episode = (a96Stats.active_episode ?? {}) as Record<string, any>;
  const a96Pending = a96PendingQ.data as Record<string, any> | null;
  const a96Wins = Number(a96Stats.wins ?? 0);
  const a96Losses = Number(a96Stats.losses ?? 0);
  const a96Total = a96Wins + a96Losses + Number(a96Stats.pushes ?? 0);
  const a96WinRate = Number(a96Stats.win_rate ?? 0);

  const v6Stats = (v6Q.data ?? {}) as Record<string, any>;
  const v6Pending = v6PendingQ.data as Record<string, any> | null;
  const v6Fmt = (n: unknown, digits = 2) => (n == null || n === "" ? "—" : Number(n).toFixed(digits));


  return (
    <div className="px-4 sm:px-6 py-5 space-y-6 max-w-[1600px] mx-auto">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 italic">
        Actual candle outcomes are determined by the Kalshi KXBTC15M 15-minute prediction market (CF Benchmarks BRTI settlement).
      </p>

      <Card className="border-cyan/20 bg-cyan/5">
        <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-cyan/10 border border-cyan/30 flex items-center justify-center font-mono font-bold text-cyan-400">
              TD1
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Model Status</div>
              <div className="text-base font-semibold flex items-center gap-2 font-heading">
                TD1-RC (A2 Combined Layer) · BTCUSDT 15m
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${isLive ? "border-cyan/30 text-cyan-400 bg-cyan/10" : "border-border text-muted-foreground"}`}>
                  <span className={`size-1.5 rounded-full ${isLive ? "bg-cyan-400 animate-pulse" : "bg-muted-foreground"}`} />
                  {isLive ? "AUTO LIVE" : "MANUAL"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">
                autobet: TD1-RC (A2 Combined + TD1 veto/containment) · feature engine: Model {modelVersion} · breakdowns below: {versionFilter ? `Model ${versionFilter}` : "All models"}
              </div>
            </div>
          </div>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ModelCard
          title="TD1-RC"
          subtitle="Active Layer"
          status="Live"
          tone="cyan"
          winRate={b2Hero.win_rate}
          wins={b2Hero.wins}
          losses={b2Hero.losses}
          pushes={b2Hero.pushes}
          pending={b2Hero.pending}
          predictionLabel="Current Prediction"
          predictionTs={td1PendingQ.data?.candle_ts}
          predictionValue={td1PendingQ.data?.external_final_decision ?? "—"}
          abstainReason={(td1PendingQ.data as any)?.skip_reason ?? null}
          actions={(
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={doResetTd1Stats} disabled={resettingTd1}>
                {resettingTd1 ? "…" : "Reset"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={downloadTd1Csv} disabled={exportingTd1}>
                {exportingTd1 ? "…" : "CSV"}
              </Button>
            </div>
          )}
        >
          {(() => {
            const prog = td1ProgressQ.data as null | { phase: string; label: string; current: number; target: number; remaining: number; percent: number; ready: boolean };
            if (!prog || prog.phase === "ready") return null;
            return (
              <div className="mb-4 rounded-lg border border-amber/20 bg-amber/5 p-3">
                <div className="flex items-center justify-between text-xs mb-2">
                  <div className="font-medium text-amber-400">{prog.label}</div>
                  <div className="text-muted-foreground tabular-nums">
                    {prog.current} / {prog.target} <span className="ml-1">({prog.remaining} left)</span>
                  </div>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full transition-all bg-amber-500" style={{ width: `${Math.max(2, Math.min(100, prog.percent))}%` }} />
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Collecting resolved A2 Combined signals — TD1 will fail-closed (SKIP) until the first fit promotes.
                </div>
              </div>
            );
          })()}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <MiniStat label="Resolved" value={b2Resolved} />
            <MiniStat label="Pending" value={b2Hero.pending} />
            <MiniStat label="TD1 Vetoes" value={b2Hero.td1_vetoes} />
            <MiniStat label="Containment" value={b2Hero.containment_vetoes} />
          </div>
        </ModelCard>

        <ModelCard
          title="a96"
          subtitle="a96-r4"
          status="Stable"
          tone="emerald"
          winRate={a96WinRate}
          wins={a96Wins}
          losses={a96Losses}
          pushes={Number(a96Stats.pushes ?? 0)}
          pending={Number(a96Stats.pending ?? 0)}
          predictionLabel="Current Prediction"
          predictionTs={a96Pending?.target_candle_ts}
          predictionValue={a96Pending?.final_prediction ?? "—"}
          abstainReason={(a96Pending as any)?.decision_reason ?? null}
          actions={(
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={doResetA96Stats} disabled={resettingA96}>
                {resettingA96 ? "…" : "Reset"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={downloadA96Csv} disabled={exportingA96}>
                {exportingA96 ? "…" : "CSV"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={downloadA96CombinedCsv} disabled={exportingA96Combined}>
                {exportingA96Combined ? "…" : "CSV+"}
              </Button>
            </div>
          )}
        >
          <div className="grid grid-cols-2 gap-3 mb-4">
            <MiniStat label="Total rows" value={Number(a96Stats.total ?? 0)} />
            <MiniStat label="Abstains" value={Number(a96Stats.abstains ?? 0)} />
            <MiniStat label="Body ratio vetoes" value={Number(a96Stats.body_ratio_vetoes ?? 0)} />
            <MiniStat label="Wick pressure vetoes" value={Number(a96Stats.wick_pressure_vetoes ?? 0)} />
            <MiniStat label="MACD vetoes" value={Number(a96Stats.macd_vetoes ?? 0)} />
            <MiniStat label="Agreement vetoes" value={Number(a96Stats.agreement_vetoes ?? 0)} />
            <MiniStat label="Efficiency vetoes (r3 legacy)" value={Number(a96Stats.efficiency_vetoes ?? 0)} />
          </div>
          <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              r3 counterfactual (audit only)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Win rate" value={`${Number(a96Stats.r3_cf_win_rate ?? 0)}%`} />
              <MiniStat label="Wins" value={Number(a96Stats.r3_cf_wins ?? 0)} />
              <MiniStat label="Losses" value={Number(a96Stats.r3_cf_losses ?? 0)} />
              <MiniStat label="Abstains" value={Number(a96Stats.r3_cf_abstains ?? 0)} />
            </div>
          </div>
          {a96Pending && (a96Pending.aligned_macd_hist_atr != null || a96Pending.four_candle_aligned_wick_pressure != null) && (
            <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                r4 structure &amp; momentum audit
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MiniStat
                  label="Mean 2c body ratio"
                  value={a96Pending.mean_2_candle_body_to_range_r4 != null ? Number(a96Pending.mean_2_candle_body_to_range_r4).toFixed(4) : "—"}
                />
                <MiniStat label="Body veto" value={a96Pending.body_ratio_veto_fired ? "Fired" : a96Pending.body_ratio_condition ? "In band" : "Clear"} />
                <MiniStat
                  label="Aligned wick pressure"
                  value={a96Pending.four_candle_aligned_wick_pressure != null ? Number(a96Pending.four_candle_aligned_wick_pressure).toFixed(4) : "—"}
                />
                <MiniStat label="Wick veto" value={a96Pending.wick_pressure_veto_fired ? "Fired" : a96Pending.wick_pressure_condition ? "In band" : "Clear"} />
                <MiniStat
                  label="Aligned MACD/ATR"
                  value={a96Pending.aligned_macd_hist_atr != null ? Number(a96Pending.aligned_macd_hist_atr).toFixed(4) : "—"}
                />
                <MiniStat label="MACD veto" value={a96Pending.macd_veto_fired ? "Fired" : a96Pending.macd_veto_condition ? "In band" : "Clear"} />
                <MiniStat label="r3 would have" value={a96Pending.r3_counterfactual_direction ?? a96Pending.r3_counterfactual_decision ?? "—"} />
              </div>
            </div>
          )}

          {a96Pending && (a96Pending.four_candle_path_efficiency != null || a96Pending.efficiency_veto_condition != null) && (
            <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                Four-candle efficiency audit
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MiniStat
                  label="Net displacement"
                  value={a96Pending.four_candle_net_displacement != null ? Number(a96Pending.four_candle_net_displacement).toFixed(2) : "—"}
                />
                <MiniStat
                  label="Total body path"
                  value={a96Pending.four_candle_total_body_path != null ? Number(a96Pending.four_candle_total_body_path).toFixed(2) : "—"}
                />
                <MiniStat
                  label="Path efficiency"
                  value={a96Pending.four_candle_path_efficiency != null ? Number(a96Pending.four_candle_path_efficiency).toFixed(4) : "—"}
                />
                <MiniStat
                  label="Toxic band"
                  value={a96Pending.efficiency_veto_condition ? "In band" : "Out of band"}
                />
                <MiniStat
                  label="Veto fired"
                  value={a96Pending.efficiency_veto_fired ? "Yes" : "No"}
                />
              </div>
            </div>
          )}
          {a96Episode && (a96Episode.comparable_resolved_count ?? 0) > 0 && (
            <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Active fit episode</div>
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Comparable" value={a96Episode.comparable_resolved_count ?? 0} />
                <MiniStat label="Layer A net" value={a96Episode.layer_a_net ?? 0} />
                <MiniStat label="Layer B net" value={a96Episode.layer_b_net ?? 0} />
                <MiniStat label="Activated" value={a96Episode.activated_at ? new Date(a96Episode.activated_at).toLocaleDateString() : "—"} />
              </div>
            </div>
          )}
        </ModelCard>

        <V6Card
          stats={v6Stats}
          pending={v6Pending}
          warmup={(v6WarmupQ.data as Record<string, any> | null) ?? null}
          fmt={v6Fmt}
          onExport={downloadV6Csv}
          exporting={exportingV6}
          onReset={doResetV6Stats}
          resetting={resettingV6}
        />


        <V6RegimeInverterPanel
          state={(v6InverterQ.data as Record<string, any> | null) ?? null}
          stats={v6Stats}
          pending={v6Pending}
        />
      </div>


      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 font-heading">
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

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}

interface ModelCardProps {
  title: string;
  subtitle: string;
  status: string;
  tone: "cyan" | "emerald" | "rose" | "violet" | "amber";
  winRate: number;
  wins: number;
  losses: number;
  pushes?: number;
  pending?: number;
  predictionLabel?: string;
  predictionTs?: string | null;
  predictionValue?: string | null;
  abstainReason?: string | null;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

function ModelCard({ title, subtitle, status, tone, winRate, wins, losses, pushes, pending, predictionLabel, predictionTs, predictionValue, abstainReason, actions, children }: ModelCardProps) {
  const toneMap: Record<string, { border: string; hover: string; bg: string; text: string; badge: string }> = {
    cyan: { border: "border-cyan/30", hover: "hover:border-cyan/60", bg: "bg-cyan/10", text: "text-cyan-400", badge: "bg-cyan-600 text-white shadow-[0_0_15px_rgba(6,182,212,0.3)]" },
    emerald: { border: "border-emerald-500/30", hover: "hover:border-emerald-500/60", bg: "bg-emerald-500/10", text: "text-emerald-400", badge: "bg-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]" },
    rose: { border: "border-rose-500/30", hover: "hover:border-rose-500/60", bg: "bg-rose-500/10", text: "text-rose-400", badge: "bg-rose-600 text-white shadow-[0_0_15px_rgba(225,29,72,0.3)]" },
    violet: { border: "border-violet/30", hover: "hover:border-violet/60", bg: "bg-violet/10", text: "text-violet-400", badge: "bg-violet-600 text-white shadow-[0_0_15px_rgba(139,92,246,0.3)]" },
    amber: { border: "border-amber/30", hover: "hover:border-amber/60", bg: "bg-amber/10", text: "text-amber-400", badge: "bg-amber-600 text-white shadow-[0_0_15px_rgba(217,119,6,0.3)]" },
  };
  const t = toneMap[tone];
  const upper = String(predictionValue ?? "—").toUpperCase();
  const predTone = upper === "YES" || upper === "GREEN" || upper.includes("LONG") ? "bg-bull border-bull/40 text-white shadow-[0_0_15px_rgba(var(--bull),0.3)]"
    : upper === "NO" || upper === "RED" || upper.includes("SHORT") ? "bg-bear border-bear/40 text-white shadow-[0_0_15px_rgba(var(--bear),0.3)]"
    : t.badge;
  return (
    <Card className={`relative group overflow-hidden rounded-2xl border bg-card/50 p-6 transition-all ${t.border} ${t.hover}`}>
      <div className="flex justify-between items-start mb-8">
        <div className="min-w-0">
          <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wider mb-1">{subtitle}</h3>
          <p className="text-xl font-bold text-foreground tracking-tight font-heading truncate">{title}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {actions}
          <div className={`px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest ${t.bg} ${t.text} ${t.border}`}>
            {status}
          </div>
        </div>
      </div>

      <div className="mb-8">
        <span className="text-muted-foreground text-sm block mb-1">Win Rate</span>
        <div className="flex items-baseline gap-2">
          <span className="text-5xl font-bold text-foreground tracking-tighter font-mono">{winRate}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
          <span className="text-muted-foreground text-[10px] uppercase font-bold block mb-1">Wins</span>
          <span className="text-lg font-bold text-bull font-mono">{wins}</span>
        </div>
        <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
          <span className="text-muted-foreground text-[10px] uppercase font-bold block mb-1">Losses</span>
          <span className="text-lg font-bold text-bear font-mono">{losses}</span>
        </div>
      </div>

      {children}

      <div className="pt-4 border-t border-border/60">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground text-xs">{predictionLabel ?? "Current Prediction"}</span>
          <span className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest ${predTone}`}>
            {upper}
          </span>
        </div>
        {predictionTs && (
          <div className="text-[10px] text-muted-foreground mt-1.5 text-right tabular-nums">
            {new Date(predictionTs).toLocaleString()}
          </div>
        )}
        {(() => {
          const isAbstain = ["ABSTAIN", "SKIP", "—", ""].includes(String(predictionValue ?? "").toUpperCase());
          if (!isAbstain || !abstainReason) return null;
          return (
            <div className="mt-2 rounded-md border border-amber/20 bg-amber/5 px-2.5 py-1.5">
              <span className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Abstain reason</span>
              <div className="text-[11px] text-muted-foreground font-mono break-words leading-snug mt-0.5">{abstainReason}</div>
            </div>
          );
        })()}
        {(pending ?? 0) > 0 && (
          <div className="text-[10px] text-muted-foreground mt-1 text-right tabular-nums">
            {pending} pending
          </div>
        )}
      </div>
    </Card>
  );
}


function V6Stat({ label, value, tone }: { label: string; value: string | number; tone?: "bull" | "bear" | "violet" }) {
  const toneClass = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : tone === "violet" ? "text-violet" : "text-foreground";
  return (
    <div className="v6-chip px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm font-semibold mt-0.5 tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function V6Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{title}</span>
        <span className="h-px flex-1 bg-gradient-to-r from-violet/40 to-transparent" />
      </div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function V6Card({
  stats,
  pending,
  warmup,
  fmt,
  onExport,
  exporting,
  onReset,
  resetting,
}: {
  stats: Record<string, any>;
  pending: Record<string, any> | null;
  warmup: Record<string, any> | null;
  fmt: (n: unknown, digits?: number) => string;
  onExport: () => void;
  exporting: boolean;
  onReset: () => void;
  resetting: boolean;
}) {

  const winRate = Number(stats.win_rate ?? 0);
  const breakeven = 50;
  const rawNet = Number(stats.raw_net ?? 0);
  const wins = Number(stats.wins ?? 0);
  const losses = Number(stats.losses ?? 0);
  const pushes = Number(stats.pushes ?? 0);
  const pendingCount = Number(stats.pending ?? 0);
  const aboveBreakeven = winRate >= breakeven;


  const upper = String(pending?.final_prediction ?? "—").toUpperCase();
  const predTone =
    upper === "GREEN"
      ? "border-bull/50 text-bull bg-bull/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bull)_70%,transparent)]"
      : upper === "RED"
        ? "border-bear/50 text-bear bg-bear/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bear)_70%,transparent)]"
        : "border-violet/40 text-violet bg-violet/10";

  const gaugeR = 34;
  const circumference = 2 * Math.PI * gaugeR;
  const pct = Math.max(0, Math.min(100, winRate));

  return (
    <Card className="v6-shell rounded-2xl p-6">
      <span className="v6-orbit-ring" aria-hidden />
      <span className="v6-sheen" aria-hidden />

      <div className="relative flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.28em] text-violet/80 mb-1">Frozen forward test</div>
          <h3 className="v6-title text-4xl font-bold font-heading tracking-tight leading-none">V6</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs border-violet/30 hover:border-violet/60" onClick={onExport} disabled={exporting}>
            {exporting ? "…" : "CSV"}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs border-violet/30 hover:border-violet/60" onClick={onReset} disabled={resetting}>
            {resetting ? "…" : "Reset"}
          </Button>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-violet/40 bg-violet/10 text-[10px] font-bold uppercase tracking-[0.16em] text-violet">
            <span className="size-1.5 rounded-full bg-violet v6-live-dot" />
            Live
          </div>
        </div>
      </div>

      <div className="relative flex items-center gap-5 mb-5">
        <div className="relative size-[86px] shrink-0">
          <svg viewBox="0 0 80 80" className="size-full -rotate-90">
            <circle cx="40" cy="40" r={gaugeR} fill="none" stroke="var(--border)" strokeWidth="7" />
            <circle
              cx="40"
              cy="40"
              r={gaugeR}
              fill="none"
              stroke={aboveBreakeven ? "var(--bull)" : "var(--violet)"}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct / 100)}
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-lg font-bold tabular-nums leading-none">{winRate}%</span>
            <span className="text-[8px] uppercase tracking-[0.14em] text-muted-foreground mt-0.5">win rate</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Raw net · primary</div>
          <div
            className={`font-mono text-5xl font-bold tracking-tighter tabular-nums leading-none mt-1 ${rawNet > 0 ? "text-bull" : rawNet < 0 ? "text-bear" : "text-foreground"}`}
          >
            {rawNet > 0 ? "+" : ""}{fmt(rawNet)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5 tabular-nums">
            break-even {fmt(breakeven, 2)}%
            <span className={`ml-1.5 font-semibold ${aboveBreakeven ? "text-bull" : "text-bear"}`}>
              {aboveBreakeven ? "▲ above" : "▼ below"}
            </span>
          </div>

        </div>
      </div>

      <div className="relative grid grid-cols-4 gap-2">
        <V6Stat label="Wins" value={wins} tone="bull" />
        <V6Stat label="Losses" value={losses} tone="bear" />
        <V6Stat label="Pushes" value={pushes} />
        <V6Stat label="Pending" value={pendingCount} />
      </div>

      <div className="relative">
        <V6Section title="Forward test">
          <V6Stat label="Coverage" value={`${Number(stats.coverage ?? 0)}%`} />
          <V6Stat label="Strategic abstains" value={Number(stats.strategic_abstains ?? 0)} />
          <V6Stat label="Operational failures" value={Number(stats.op_fails ?? 0)} />
          <V6Stat label="Longest loss streak" value={Number(stats.max_loss_streak ?? 0)} />
          <V6Stat label="GREEN W/L" value={`${Number(stats.green_wins ?? 0)}/${Number(stats.green_losses ?? 0)}`} />
          <V6Stat label="RED W/L" value={`${Number(stats.red_wins ?? 0)}/${Number(stats.red_losses ?? 0)}`} />
          <V6Stat label="Max raw drawdown" value={fmt(stats.max_raw_drawdown)} tone="bear" />
          <V6Stat label="Rolling 96 raw net" value={fmt(stats.rolling96_raw_net)} />

          <V6Stat label="Rolling 96 coverage" value={`${Number(stats.rolling96_coverage ?? 0)}%`} />
        </V6Section>

        <V6Section title="Current candle">
          <V6Stat label="Base V6" value={pending?.base_v6_prediction ?? "—"} />
          <V6Stat label="Source" value={pending?.prediction_source ?? "—"} />
          <V6Stat label="Final score" value={fmt(pending?.final_score, 6)} />
          <V6Stat
            label="Thresholds"
            value={pending ? `${fmt(pending.red_threshold, 4)} / ${fmt(pending.green_threshold, 4)}` : "—"}
          />
          <V6Stat label="Ridge pct" value={fmt(pending?.ridge_percentile, 4)} />
          <V6Stat label="Boosted pct" value={fmt(pending?.gb_percentile, 4)} />
          <V6Stat label="Broad pct" value={fmt(pending?.broad_percentile, 4)} />
          <V6Stat label="Anchor pct" value={fmt(pending?.anchor_percentile, 4)} />
        </V6Section>

        <V6Section title="Overlay rules · count · raw">
          <V6Stat label="GREEN saturation veto" value={`${Number(stats.saturation_veto_count ?? 0)} · ${fmt(stats.saturation_veto_raw)}`} />
          <V6Stat label="Weak-broad RED veto" value={`${Number(stats.weak_red_veto_count ?? 0)} · ${fmt(stats.weak_red_veto_raw)}`} />
          <V6Stat label="Consensus RED pickup" value={`${Number(stats.red_pickup_count ?? 0)} · ${fmt(stats.red_pickup_raw)}`} />
          <V6Stat label="Momentum GREEN pickup" value={`${Number(stats.green_pickup_count ?? 0)} · ${fmt(stats.green_pickup_raw)}`} />
        </V6Section>

      </div>

      <V6WarmupPanel warmup={warmup} />

      <div className="relative mt-6 pt-4 border-t border-violet/20">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Current prediction</div>
            {pending?.target_candle_ts && (
              <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums truncate">
                {new Date(pending.target_candle_ts).toLocaleString()}
              </div>
            )}
          </div>
          <span className={`px-4 py-1.5 rounded-lg border text-sm font-bold uppercase tracking-[0.16em] font-mono ${predTone}`}>
            {upper}
          </span>
        </div>
        {(pending?.abstain_reason || pending?.operational_error) && (
          <div className="text-[10px] text-muted-foreground mt-2 text-right">
            {pending.abstain_reason ?? pending.operational_error}
          </div>
        )}
      </div>
    </Card>
  );
}

/** V6-r1 Regime Inverter — rolling shadow reliability of the ORIGINAL V6_BASE direction. */
function V6RegimeInverterPanel({
  state,
  stats,
  pending,
}: {
  state: Record<string, any> | null;
  stats: Record<string, any>;
  pending: Record<string, any> | null;
}) {
  const ready = Boolean(state?.regime_inverter_ready);
  const active = Boolean(state?.regime_inverter_active);
  const count = Number(state?.regime_inverter_history_count ?? 0);
  const wins = Number(state?.regime_inverter_last20_wins ?? 0);
  const losses = Number(state?.regime_inverter_last20_losses ?? 0);
  const net = Number(state?.regime_inverter_last20_adjusted_net ?? 0);
  const threshold = -2.8;
  const history = Array.isArray(state?.regime_inverter_history_json)
    ? (state?.regime_inverter_history_json as Array<Record<string, any>>)
    : [];

  const tone = active
    ? "border-bear/50 text-bear bg-bear/10"
    : ready
      ? "border-bull/50 text-bull bg-bull/10"
      : "border-violet/40 text-violet bg-violet/10";
  const label = active ? "INVERTING" : ready ? "ARMED · DORMANT" : `WARMING ${count}/20`;

  const num = (v: unknown, d = 2) =>
    v === null || v === undefined || v === "" || !Number.isFinite(Number(v))
      ? "—"
      : Number(v).toFixed(d);

  return (
    <Card className="relative overflow-hidden border-violet/30">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_10%_0%,hsl(var(--violet)/0.14),transparent_60%)]" />
      <CardHeader className="relative pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2 font-heading">
          <span className="flex items-center gap-2">
            V6 Regime Inverter
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
              V6-r1 · adaptive layer
            </span>
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}>
            {label}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="relative space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Window" value={`${count} / 20`} />
          <MiniStat label="Base wins" value={wins} />
          <MiniStat label="Base losses" value={losses} />
          <MiniStat label="Rolling net" value={num(net)} />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Activation threshold</span>
            <span className="font-mono">
              {num(net)} vs {threshold.toFixed(1)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full ${active ? "bg-bear" : "bg-violet"}`}
              style={{
                width: `${Math.max(0, Math.min(100, ((16 - Math.max(-16, Math.min(16, net))) / 32) * 100))}%`,
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Flips fired" value={stats.inverter_trigger_count ?? 0} />
          <MiniStat label="Flip wins" value={stats.inverter_wins ?? 0} />
          <MiniStat label="Flip losses" value={stats.inverter_losses ?? 0} />
          <MiniStat label="Flip raw value" value={num(stats.inverter_raw_contribution)} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Published raw net" value={num(stats.raw_net)} />
          <MiniStat label="Uninverted raw net" value={num(stats.pre_inverter_raw_net)} />
          <MiniStat label="Coverage" value={`${num(stats.coverage, 1)}%`} />
          <MiniStat label="Revision" value={String(stats.model_revision ?? "V6-r1-regime-inverter")} />
        </div>

        {pending && (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Current candle
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
              <span>base: {String(pending.original_v6_base_prediction ?? pending.base_v6_prediction ?? "—")}</span>
              <span>pre-inverter: {String(pending.pre_inverter_prediction ?? "—")}</span>
              <span>published: {String(pending.final_prediction ?? "—")}</span>
              <span>source: {String(pending.final_prediction_source ?? pending.prediction_source ?? "—")}</span>
              {pending.regime_inverter_triggered ? (
                <span className="text-bear">INVERTED</span>
              ) : null}
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {history.map((h, i) => (
              <span
                key={`${h.target_candle_ts}-${i}`}
                title={`${new Date(String(h.target_candle_ts)).toLocaleString()} · base ${h.original_v6_base_prediction} · actual ${h.actual_direction}`}
                className={`h-2.5 w-2.5 rounded-sm ${
                  Number(h.original_v6_shadow_adjusted_score) > 0 ? "bg-bull" : "bg-bear"
                }`}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


function V6WarmupPanel({ warmup }: { warmup: Record<string, any> | null }) {
  const status = String(warmup?.v6_warmup_status ?? "NOT_STARTED");
  const ready = status === "READY";
  const count = Number(warmup?.warmup_candle_count ?? 0);
  const baseCount = Number(warmup?.warmup_base_predictions_count ?? 0);
  const decisions = Array.isArray(warmup?.warmup_base_predictions_json)
    ? (warmup?.warmup_base_predictions_json as Array<Record<string, any>>)
    : [];
  const tone = ready
    ? "border-bull/50 text-bull bg-bull/10"
    : status === "FAILED"
      ? "border-bear/50 text-bear bg-bear/10"
      : "border-violet/40 text-violet bg-violet/10";
  const ts = (v: unknown) => (v ? new Date(String(v)).toLocaleString() : "—");

  const qc = useQueryClient();
  const initFn = useServerFn(initV6Warmup);
  const boundaryFn = useServerFn(runV6AtBoundary);
  const [initing, setIniting] = useState(false);
  const [init, setInit] = useState<Record<string, any> | null>(null);
  const [initErr, setInitErr] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);

  const onInit = async () => {
    setIniting(true);
    setInitErr(null);
    try {
      const res = (await initFn()) as Record<string, any>;
      setInit(res);
      setWatching(true);
      qc.invalidateQueries({ queryKey: ["v6-warmup"] });
    } catch (e) {
      setInitErr(e instanceof Error ? e.message : String(e));
    } finally {
      setIniting(false);
    }
  };

  // Once initialized, invoke runV6 at the next boundary and keep refreshing
  // readiness until the canonical replay reports READY or FAILED.
  useEffect(() => {
    if (!watching) return;
    if (status === "READY" || status === "FAILED") {
      setWatching(false);
      return;
    }
    const targetMs = init?.next_target_ts ? new Date(String(init.next_target_ts)).getTime() : 0;
    const tick = async () => {
      if (targetMs && Date.now() >= targetMs) {
        try {
          await boundaryFn();
        } catch (e) {
          setInitErr(e instanceof Error ? e.message : String(e));
        }
      }
      qc.invalidateQueries({ queryKey: ["v6-warmup"] });
      qc.invalidateQueries({ queryKey: ["v6-pending"] });
    };
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [watching, status, init, boundaryFn, qc]);

  return (
    <div className="relative mt-6 pt-4 border-t border-violet/20">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Warmup / readiness</div>
        <span className={`px-3 py-1 rounded-lg border text-[11px] font-bold uppercase tracking-[0.14em] font-mono ${tone}`}>
          {ready ? "V6 READY" : status}
        </span>
      </div>

      {ready && (
        <div className="mt-2 text-[11px] font-mono text-bull">
          {count} confirmed candles replayed · {baseCount} prior base predictions restored
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onInit} disabled={initing} className="h-7 text-[10px]">
          {initing ? "Initializing…" : "Initialize V6 Warmup"}
        </Button>
        {watching && <span className="text-[10px] text-muted-foreground">waiting for next boundary…</span>}
      </div>

      {init && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-muted-foreground tabular-nums">
          <div>Contiguous confirmed candles</div>
          <div className={`text-right ${init.sufficient_history ? "text-bull" : "text-bear"}`}>
            {init.contiguous_candles} / {init.required_candles}
          </div>
          <div>Next target candle</div>
          <div className="text-right text-foreground truncate">{ts(init.next_target_ts)}</div>
          <div>Canonical stream</div>
          <div className="text-right text-foreground truncate">{String(init.stream ?? "")}</div>
        </div>
      )}

      {(initErr || init?.error) && (
        <div className="mt-2 text-[10px] text-bear break-all">{String(initErr ?? init?.error)}</div>
      )}



      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-muted-foreground tabular-nums">
        <div>Confirmed history</div><div className="text-right text-foreground">{count}</div>
        <div>First warmup candle</div><div className="text-right text-foreground truncate">{ts(warmup?.warmup_first_candle_ts)}</div>
        <div>Last warmup candle</div><div className="text-right text-foreground truncate">{ts(warmup?.warmup_last_candle_ts)}</div>
        <div>Continuity valid</div><div className="text-right text-foreground">{warmup?.warmup_continuity_valid ? "yes" : "no"}</div>
        <div>Technical state valid</div><div className="text-right text-foreground">{warmup?.warmup_feature_valid ? "yes" : "no"}</div>
        <div>Prior base predictions</div><div className="text-right text-foreground">{baseCount} / 7</div>
        <div>Warmup completed</div><div className="text-right text-foreground truncate">{ts(warmup?.warmup_completed_at)}</div>
      </div>

      {decisions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {decisions.map((d, i) => {
            const dir = String(d.base_v6_prediction ?? "—").toUpperCase();
            const c = dir === "GREEN" ? "text-bull border-bull/40" : dir === "RED" ? "text-bear border-bear/40" : "text-muted-foreground border-border";
            return (
              <span key={i} className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${c}`} title={String(d.target_candle_ts ?? "")}>
                {dir}
              </span>
            );
          })}
        </div>
      )}

      {warmup?.warmup_error && (
        <div className="mt-2 text-[10px] text-bear break-all">{String(warmup.warmup_error)}</div>
      )}
    </div>
  );
}
