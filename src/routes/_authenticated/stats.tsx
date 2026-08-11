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
  getTd3ShadowStats,
  getTd3ShadowPending,
  getTd1RcShadowPending,
  exportTd1RcShadow,
  getTd1RcTrainingProgress,
  resetTd1RcVisualStats,
} from "@/lib/predictions.functions";

import { getV6Stats, getV6Pending, exportV6Csv, getV6Warmup, getV6RegimeInverter, resetV6VisualStats } from "@/lib/v6.functions";
import { initV6Warmup, runV6AtBoundary } from "@/lib/v6-admin.functions";
import { getB4x4Stats, getB4x4Pending, exportB4x4Csv, listB4x4Recent } from "@/lib/b4x4.functions";
import { B4x4Card } from "@/components/b4x4-card";
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
  const td3Fn = useServerFn(getTd3ShadowStats);
  const td3Q = useQuery({ queryKey: ["td3-shadow-stats"], queryFn: () => td3Fn(), refetchInterval: 10_000, refetchIntervalInBackground: true, staleTime: 0 });
  const td3PendingFn = useServerFn(getTd3ShadowPending);
  const td3PendingQ = useQuery({ queryKey: ["td3-shadow-pending"], queryFn: () => td3PendingFn(), refetchInterval: 10_000, refetchIntervalInBackground: true, staleTime: 0 });

  const td1PendingFn = useServerFn(getTd1RcShadowPending);
  const td1PendingQ = useQuery({ queryKey: ["td1-rc-shadow-pending"], queryFn: () => td1PendingFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const exportTd1Fn = useServerFn(exportTd1RcShadow);
  const td1ProgressFn = useServerFn(getTd1RcTrainingProgress);
  const td1ProgressQ = useQuery({ queryKey: ["td1-rc-training-progress"], queryFn: () => td1ProgressFn(), refetchInterval: 15_000, refetchIntervalInBackground: true, staleTime: 0 });


  const v6Fn = useServerFn(getV6Stats);
  const v6Q = useQuery({ queryKey: ["v6-stats"], queryFn: () => v6Fn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const v6PendingFn = useServerFn(getV6Pending);
  const v6PendingQ = useQuery({ queryKey: ["v6-pending"], queryFn: () => v6PendingFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const v6WarmupFn = useServerFn(getV6Warmup);
  const v6WarmupQ = useQuery({ queryKey: ["v6-warmup"], queryFn: () => v6WarmupFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const v6InverterFn = useServerFn(getV6RegimeInverter);
  const v6InverterQ = useQuery({ queryKey: ["v6-regime-inverter"], queryFn: () => v6InverterFn(), refetchInterval: 5_000, refetchIntervalInBackground: true, staleTime: 0 });
  const exportV6Fn = useServerFn(exportV6Csv);
  const resetV6Fn = useServerFn(resetV6VisualStats);
  const resetTd1Fn = useServerFn(resetTd1RcVisualStats);

  const b4x4Fn = useServerFn(getB4x4Stats);
  const b4x4Q = useQuery({ queryKey: ["b4x4-stats"], queryFn: () => b4x4Fn(), refetchInterval: 15_000, refetchIntervalInBackground: true, staleTime: 0 });
  const b4x4PendingFn = useServerFn(getB4x4Pending);
  const b4x4PendingQ = useQuery({ queryKey: ["b4x4-pending"], queryFn: () => b4x4PendingFn(), refetchInterval: 15_000, refetchIntervalInBackground: true, staleTime: 0 });
  const exportB4x4Fn = useServerFn(exportB4x4Csv);
  const [exportingB4x4, setExportingB4x4] = useState(false);





  async function downloadB4x4Csv() {
    try {
      setExportingB4x4(true);
      const res = await exportB4x4Fn();
      if (!res || res.rows === 0) { alert("No B4x4 rows to export."); return; }
      triggerDownload(res.csv, `B4x4-${stamp()}.csv`);
    } finally {
      setExportingB4x4(false);
    }
  }

  const [exportingV6, setExportingV6] = useState(false);
  const [resettingV6, setResettingV6] = useState(false);

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
  const b4x4RecentFn = useServerFn(listB4x4Recent);
  const listQ = useQuery({
    queryKey: ["b4x4-recent-stats"],
    queryFn: () => b4x4RecentFn(),
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
        qc.invalidateQueries({ queryKey: ["td3-shadow-stats"] });
        qc.invalidateQueries({ queryKey: ["td3-shadow-pending"] });
      })

      .on("postgres_changes", { event: "*", schema: "public", table: "v6_predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["v6-stats"] });
        qc.invalidateQueries({ queryKey: ["v6-pending"] });
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
    compressed_risk: (td1Stats.compressed_risk ?? null) as Record<string, any> | null,
    daily_3d: (td1Stats.daily_3d ?? []) as Array<Record<string, any>>,

  };

  const b2Resolved = b2Hero.wins + b2Hero.losses + b2Hero.pushes;
  const isLive = Boolean(settingsQ.data?.auto_run_enabled);

  const versions = versionsQ.data ?? [];
  const versionOptions = useMemo(() => {
    const list = versions.map((v) => v.version);
    if (activeVersion && !list.includes(activeVersion)) list.unshift(activeVersion);
    return list;
  }, [versions, activeVersion]);

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
        <TD1Card
          title="TD1-RC"
          eyebrow="Active layer · webhook source"
          showCompressedRisk={false}
          hero={b2Hero}
          resolved={b2Resolved}
          pending={td1PendingQ.data as any}
          progress={td1ProgressQ.data as any}
          onExport={downloadTd1Csv}
          exporting={exportingTd1}
          onReset={doResetTd1Stats}
          resetting={resettingTd1}
          dailyCount={7}
        />

        <TD3Card stats={(td3Q.data as any) ?? {}} />





        <V6Card
          stats={v6Stats}
          pending={v6Pending}
          warmup={(v6WarmupQ.data as Record<string, any> | null) ?? null}
          inverter={(v6InverterQ.data as Record<string, any> | null) ?? null}
          fmt={v6Fmt}
          onExport={downloadV6Csv}
          exporting={exportingV6}
          onReset={doResetV6Stats}
          resetting={resettingV6}
        />


      </div>

      <div className="grid grid-cols-1 gap-5">
        <B4x4Card
          stats={(b4x4Q.data as any) ?? {}}
          pending={(b4x4PendingQ.data as any) ?? null}
          onExport={downloadB4x4Csv}
          exporting={exportingB4x4}
        />
      </div>




      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 font-heading">
            Recent History
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
              B4x4 · Outcome follows B4x4
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2">Candle</th>
                  <th className="text-left px-3 py-2">B4x4</th>
                  <th className="text-left px-3 py-2">Raw</th>
                  <th className="text-left px-3 py-2">Cell</th>
                  <th className="text-left px-3 py-2">p</th>
                  <th className="text-left px-3 py-2">Close</th>
                  <th className="text-left px-3 py-2">Outcome</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {(listQ.data ?? []).slice(0, 25).map((p: any) => (
                  <tr key={p.id} className="border-b border-border/50 align-top">
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(p.candle_ts).toLocaleString()}</td>
                    <td className="px-3 py-2"><PredictionBadge value={p.prediction} /></td>
                    <td className="px-3 py-2"><PredictionBadge value={p.raw_direction ?? "—"} /></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{p.grid_cell ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {p.p_correct != null ? Number(p.p_correct).toFixed(3) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {p.actual_close != null ? `$${Number(p.actual_close).toLocaleString()}` : "—"}
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

function TD1Stat({ label, value, tone }: { label: string; value: string | number; tone?: "bull" | "bear" }) {
  const toneClass = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-foreground";
  return (
    <div className="td1-chip px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm font-semibold mt-0.5 tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

/** Last N calendar days (Mountain Time): win rate + net wins per day. */
function Daily3d({ days, accent = "bear", count = 3 }: { days: Array<Record<string, any>>; accent?: "bear" | "cyan"; count?: number }) {
  const rows = (days ?? []).slice(0, count);
  if (rows.length === 0) return null;
  const compact = count > 3;
  const line = accent === "cyan" ? "from-cyan-400/40" : "from-bear/40";
  const label = (dateKey: string, i: number) => {
    if (i === 0) return "Today";
    if (i === 1) return "Yest";
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-US", {
      timeZone: "UTC", month: "short", day: "numeric",
    });
  };
  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Last {count} days</span>
        <span className={`h-px flex-1 bg-gradient-to-r ${line} to-transparent`} />
      </div>
      <div className={`grid gap-2 ${compact ? "grid-cols-4 sm:grid-cols-7" : "grid-cols-3"}`}>
        {rows.map((d, i) => {
          const net = Number(d.net ?? 0);
          const trades = Number(d.trades ?? 0);
          const netCls = net > 0 ? "text-bull" : net < 0 ? "text-bear" : "text-muted-foreground";
          return (
            <div key={String(d.date ?? i)} className={`td1-chip ${compact ? "px-2 py-1.5" : "px-3 py-2"}`}>
              <div className={`uppercase tracking-[0.12em] text-muted-foreground truncate ${compact ? "text-[8px]" : "text-[9px]"}`}>
                {label(String(d.date ?? ""), i)}
              </div>
              <div className={`font-mono font-semibold tabular-nums ${compact ? "text-xs mt-0.5" : "text-sm mt-0.5"}`}>
                {trades === 0 ? "—" : `${Number(d.win_rate ?? 0).toFixed(1)}%`}
              </div>
              <div className={`font-mono tabular-nums ${netCls} ${compact ? "text-[9px] mt-0.5" : "text-[10px] mt-0.5"}`}>
                {trades === 0 ? "no trades" : `${net > 0 ? "+" : ""}${net} · ${d.wins}-${d.losses}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}



function TD1Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{title}</span>
        <span className="h-px flex-1 bg-gradient-to-r from-bear/40 to-transparent" />
      </div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

/** Basic TD3 tile (TD1 clone + Toxic Opposing Drift Veto) — green theme. */
function TD3Card({ stats }: { stats: Record<string, any> }) {
  const n = (k: string) => Number(stats?.[k] ?? 0);
  const winRate = n("win_rate");
  const cells: Array<[string, string]> = [
    ["Trades", String(n("total"))],
    ["Wins", String(n("wins"))],
    ["Losses", String(n("losses"))],
    ["Pushes", String(n("pushes"))],
    ["Pending", String(n("pending"))],
    ["Net", (n("net") > 0 ? "+" : "") + n("net")],
    ["Vetoes", String(n("vetoes"))],
    ["Avoided losses", String(n("avoided_losses"))],
    ["Sacrificed wins", String(n("sacrificed_wins"))],
  ];
  return (
    <Card className="relative overflow-hidden border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-background to-background">
      <div className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-emerald-500/20 blur-3xl" />
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] uppercase tracking-[0.25em] text-emerald-500/80">Shadow layer</p>
            <CardTitle className="text-base text-emerald-400">TD3 · Toxic Drift Veto</CardTitle>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums text-emerald-400">{winRate.toFixed(1)}%</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Win rate</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2">
          {cells.map(([label, value]) => (
            <div key={label} className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="text-sm font-semibold tabular-nums text-emerald-300">{value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TD1Card({
  title = "TD1-RC",
  eyebrow = "Active layer",
  showCompressedRisk = true,
  hero,
  resolved,
  pending,
  progress,
  onExport,
  exporting,
  onReset,
  resetting,
  dailyCount = 3,
}: {
  title?: string;
  eyebrow?: string;
  showCompressedRisk?: boolean;
  hero: Record<string, any>;
  resolved: number;
  pending: Record<string, any> | null;
  progress: null | { phase: string; label: string; current: number; target: number; remaining: number; percent: number; ready: boolean };
  onExport: () => void;
  exporting: boolean;
  onReset: () => void;
  resetting: boolean;
  dailyCount?: number;
}) {
  const winRate = Number(hero.win_rate ?? 0);
  const wins = Number(hero.wins ?? 0);
  const losses = Number(hero.losses ?? 0);
  const pushes = Number(hero.pushes ?? 0);
  const pendingCount = Number(hero.pending ?? 0);
  const net = wins - losses;
  const breakeven = 50;
  const aboveBreakeven = winRate >= breakeven;

  const upper = String(pending?.external_final_decision ?? "—").toUpperCase();
  const predTone =
    upper === "YES" || upper === "GREEN"
      ? "border-bull/50 text-bull bg-bull/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bull)_70%,transparent)]"
      : upper === "NO" || upper === "RED"
        ? "border-bear/50 text-bear bg-bear/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bear)_70%,transparent)]"
        : "border-bear/30 text-muted-foreground bg-bear/5";

  const gaugeR = 34;
  const circumference = 2 * Math.PI * gaugeR;
  const pct = Math.max(0, Math.min(100, winRate));
  const skipReason = pending?.skip_reason ?? null;

  return (
    <Card className="td1-shell rounded-2xl p-6">
      <span className="td1-orbit-ring" aria-hidden />
      <span className="v6-sheen" aria-hidden />

      <div className="relative flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.28em] text-bear/80 mb-1">{eyebrow}</div>
          <h3 className="td1-title text-4xl font-bold font-heading tracking-tight leading-none">{title}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs border-bear/30 hover:border-bear/60" onClick={onExport} disabled={exporting}>
            {exporting ? "…" : "CSV"}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs border-bear/30 hover:border-bear/60" onClick={onReset} disabled={resetting}>
            {resetting ? "…" : "Reset"}
          </Button>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-bear/40 bg-bear/10 text-[10px] font-bold uppercase tracking-[0.16em] text-bear">
            <span className="size-1.5 rounded-full bg-bear td1-live-dot" />
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
              stroke={aboveBreakeven ? "var(--bull)" : "var(--bear)"}
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
          <div className={`font-mono text-5xl font-bold tracking-tighter tabular-nums leading-none mt-1 ${net > 0 ? "text-bull" : net < 0 ? "text-bear" : "text-foreground"}`}>
            {net > 0 ? "+" : ""}{net}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5 tabular-nums">
            break-even {breakeven.toFixed(2)}%
            <span className={`ml-1.5 font-semibold ${aboveBreakeven ? "text-bull" : "text-bear"}`}>
              {aboveBreakeven ? "▲ above" : "▼ below"}
            </span>
          </div>
        </div>
      </div>

      {progress && progress.phase !== "ready" && (
        <div className="relative mb-4 rounded-xl border border-amber/25 bg-amber/5 p-3">
          <div className="flex items-center justify-between text-xs mb-2">
            <div className="font-medium text-amber-400">{progress.label}</div>
            <div className="text-muted-foreground tabular-nums">
              {progress.current} / {progress.target} <span className="ml-1">({progress.remaining} left)</span>
            </div>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full transition-all bg-amber-500" style={{ width: `${Math.max(2, Math.min(100, progress.percent))}%` }} />
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Collecting resolved A2 Combined signals — TD1 will fail-closed (SKIP) until the first fit promotes.
          </div>
        </div>
      )}

      <div className="relative grid grid-cols-4 gap-2">
        <TD1Stat label="Wins" value={wins} tone="bull" />
        <TD1Stat label="Losses" value={losses} tone="bear" />
        <TD1Stat label="Pushes" value={pushes} />
        <TD1Stat label="Pending" value={pendingCount} />
      </div>

      <div className="relative">
        <Daily3d days={hero.daily_3d ?? []} count={dailyCount} />
      </div>



      <div className="relative">
        <TD1Section title="Layer activity">
          <TD1Stat label="Resolved" value={resolved} />
          <TD1Stat label="Pending" value={pendingCount} />
          <TD1Stat label="TD1 vetoes" value={Number(hero.td1_vetoes ?? 0)} tone="bear" />
          <TD1Stat label="Containment vetoes" value={Number(hero.containment_vetoes ?? 0)} tone="bear" />
        </TD1Section>
      </div>

      {(() => {
        const rc = (hero as Record<string, any>).recovery as Record<string, any> | null;
        if (!rc || !showCompressedRisk) return null;
        const r1 = (rc.r1_counterfactual ?? {}) as Record<string, any>;
        const inc = Number(rc.incremental_net ?? 0);
        return (
          <div className="relative mt-4">
            <TD1Section title={`Opposing drift recovery · ${rc.policy_version} · ${rc.feature} ≥ ${rc.threshold}`}>
              <TD1Stat label="Evaluable" value={Number(rc.evaluable ?? 0)} />
              <TD1Stat label="Condition met" value={Number(rc.condition_count ?? 0)} />
              <TD1Stat label="Recovered trades" value={Number(rc.recovered ?? 0)} tone="bull" />
              <TD1Stat label="Recovered W/L" value={`${Number(rc.recovered_wins ?? 0)}/${Number(rc.recovered_losses ?? 0)}`} />
              <TD1Stat label="Recovered win rate" value={`${Number(rc.recovered_win_rate ?? 0).toFixed(1)}%`} />
              <TD1Stat label="Recovered pending" value={Number(rc.recovered_pending ?? 0)} />
              <TD1Stat label="Incremental net" value={`${inc > 0 ? "+" : ""}${inc}`} tone={inc >= 0 ? "bull" : "bear"} />
              <TD1Stat
                label="TD2-r1 counterfactual"
                value={`${Number(r1.trades ?? 0)} · ${Number(r1.net ?? 0) > 0 ? "+" : ""}${Number(r1.net ?? 0)}`}
              />
            </TD1Section>
          </div>
        );
      })()}

      {(() => {
        const cr = hero.compressed_risk as Record<string, any> | null;

        if (!cr || !showCompressedRisk) return null;
        const cur = (cr.current_policy ?? {}) as Record<string, any>;
        const prev = (cr.previous_policy ?? {}) as Record<string, any>;
        const nog = (cr.no_global_veto_policy ?? {}) as Record<string, any>;
        const daily = (cr.daily ?? []) as Array<Record<string, any>>;
        return (
          <div className="relative mt-4">
            <TD1Section title={`Compressed-risk audit · ${cr.policy_version} · ≥ ${cr.threshold} · ${cr.attribution_version ?? "policy-delta-v2"}`}>
              <TD1Stat label="Evaluable" value={Number(cr.evaluable ?? 0)} />
              <TD1Stat label="Condition met" value={Number(cr.condition_count ?? 0)} />
              <TD1Stat label="First-match abstentions" value={Number(cr.veto_count ?? 0)} tone="bear" />
              <TD1Stat label="Veto rate" value={`${Number(cr.veto_rate ?? 0).toFixed(1)}%`} />
              <TD1Stat label="Incremental changes" value={Number(cr.incremental_changes ?? 0)} />
              <TD1Stat label="Prev-policy overlaps" value={Number(cr.prev_policy_abstention_overlap ?? 0)} />
              <TD1Stat label="No incremental change" value={Number(cr.no_incremental_change ?? 0)} />
              <TD1Stat label="Avoided losses" value={Number(cr.avoided_losses ?? 0)} tone="bull" />
              <TD1Stat label="Sacrificed wins" value={Number(cr.sacrificed_wins ?? 0)} tone="bear" />
              <TD1Stat
                label="Net incremental veto value"
                value={Number(cr.net_veto_value ?? 0)}
                tone={Number(cr.net_veto_value ?? 0) >= 0 ? "bull" : "bear"}
              />
              <TD1Stat label="Max drawdown" value={Number(cr.max_drawdown ?? 0)} tone="bear" />
              <TD1Stat
                label="Worst daily net"
                value={Number(cr.worst_daily_net ?? 0)}
                tone={Number(cr.worst_daily_net ?? 0) >= 0 ? "bull" : "bear"}
              />
            </TD1Section>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[10px] font-mono tabular-nums">
                <thead>
                  <tr className="text-muted-foreground uppercase tracking-[0.14em] text-[9px]">
                    <th className="text-left py-1">Policy</th>
                    <th className="text-right">Trades</th>
                    <th className="text-right">W/L</th>
                    <th className="text-right">Win rate</th>
                    <th className="text-right">Coverage</th>
                    <th className="text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "Live (current)", d: cur },
                    { name: "Previous policy", d: prev },
                    { name: "No global veto", d: nog },
                  ].map((p) => (
                    <tr key={p.name} className="border-t border-bear/10">
                      <td className="py-1 text-left">{p.name}</td>
                      <td className="text-right">{Number(p.d.trades ?? 0)}</td>
                      <td className="text-right">{Number(p.d.wins ?? 0)}/{Number(p.d.losses ?? 0)}</td>
                      <td className="text-right">{Number(p.d.win_rate ?? 0).toFixed(1)}%</td>
                      <td className="text-right">{Number(p.d.coverage ?? 0).toFixed(1)}%</td>
                      <td className={`text-right ${Number(p.d.net ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                        {Number(p.d.net ?? 0) > 0 ? "+" : ""}{Number(p.d.net ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {daily.length > 0 && (
              <div className="mt-3">
                <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
                  Daily live vs counterfactual · {cr.reporting_timezone}
                </div>
                <div className="overflow-x-auto max-h-48 overflow-y-auto">
                  <table className="w-full text-[10px] font-mono tabular-nums">
                    <thead>
                      <tr className="text-muted-foreground uppercase tracking-[0.14em] text-[9px]">
                        <th className="text-left py-1">Date</th>
                        <th className="text-right">Trades</th>
                        <th className="text-right">Live net</th>
                        <th className="text-right">Prev net</th>
                        <th className="text-right">No-global net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((d) => (
                        <tr key={String(d.date)} className="border-t border-bear/10">
                          <td className="py-1 text-left">{String(d.date)}</td>
                          <td className="text-right">{Number(d.trades ?? 0)}</td>
                          <td className={`text-right ${Number(d.live_net ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                            {Number(d.live_net ?? 0) > 0 ? "+" : ""}{Number(d.live_net ?? 0)}
                          </td>
                          <td className="text-right">{Number(d.prev_policy_net ?? 0)}</td>
                          <td className="text-right">{Number(d.no_global_net ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })()}


      <div className="relative mt-6 pt-4 border-t border-bear/20">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Current prediction</div>
            {pending?.candle_ts && (
              <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums truncate">
                {new Date(pending.candle_ts).toLocaleString()}
              </div>
            )}
          </div>
          <span className={`px-4 py-1.5 rounded-lg border text-sm font-bold uppercase tracking-[0.16em] font-mono ${predTone}`}>
            {upper}
          </span>
        </div>
        {skipReason && (
          <div className="text-[10px] text-muted-foreground mt-2 text-right font-mono break-words">{skipReason}</div>
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
  inverter,
  fmt,
  onExport,
  exporting,
  onReset,
  resetting,
}: {
  stats: Record<string, any>;
  pending: Record<string, any> | null;
  warmup: Record<string, any> | null;
  inverter: Record<string, any> | null;
  fmt: (n: unknown, digits?: number) => string;
  onExport: () => void;
  exporting: boolean;
  onReset: () => void;
  resetting: boolean;
}) {

  const invWins = Number(stats.inverter_shadow_wins ?? 0);
  const invLosses = Number(stats.inverter_shadow_losses ?? 0);

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
          <div className="text-[10px] text-muted-foreground mt-1">V6-r4 Structure Confirmation</div>
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
        <Daily3d days={(stats.daily_3d ?? []) as Array<Record<string, any>>} accent="cyan" />
      </div>

      {/* Slimmed tile: high-level W/L only. Full rule-by-rule diagnostics,
          per-branch audits and current-candle internals stay in the V6 CSV. */}
      <div className="relative">
        <V6Section title="Forward test">
          <V6Stat label="Coverage" value={`${Number(stats.coverage ?? 0)}%`} />
          <V6Stat label="GREEN W/L" value={`${Number(stats.green_wins ?? 0)}/${Number(stats.green_losses ?? 0)}`} />
          <V6Stat label="RED W/L" value={`${Number(stats.red_wins ?? 0)}/${Number(stats.red_losses ?? 0)}`} />
          <V6Stat label="Longest loss streak" value={Number(stats.max_loss_streak ?? 0)} />
          <V6Stat label="Max raw drawdown" value={fmt(stats.max_raw_drawdown)} tone="bear" />
          <V6Stat label="Rolling 96 raw net" value={fmt(stats.rolling96_raw_net)} />
        </V6Section>

        <V6Section title="Selectivity · V6-r4">
          <V6Stat label="Strategic abstains" value={Number(stats.strategic_abstains ?? 0)} />
          <V6Stat label="Structure vetoes" value={Number(stats.structure_vetoes ?? 0)} />
          <V6Stat label="Avoided losses" value={Number(stats.structure_avoided_losses ?? 0)} tone="bull" />
          <V6Stat label="Sacrificed wins" value={Number(stats.structure_sacrificed_wins ?? 0)} tone="bear" />
          <V6Stat label="Inverter shadow W/L" value={`${invWins}/${invLosses}`} tone="violet" />
          <V6Stat label="Operational failures" value={Number(stats.op_fails ?? 0)} />
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
