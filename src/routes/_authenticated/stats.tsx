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
import {
  getModel8V3Stats,
  getModel8V3Pending,
  exportModel8V3Csv,
  getModel8V3PendingCandidate,
  approveModel8V3Candidate,
  rejectModel8V3Candidate,
} from "@/lib/model8_v3.functions";
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
  const exportA96Fn = useServerFn(exportA96Csv);
  const exportA96CombinedFn = useServerFn(exportA96CombinedCsv);
  const resetA96Fn = useServerFn(resetA96VisualStats);
  const resetTd1Fn = useServerFn(resetTd1RcVisualStats);

  const m8v3StatsFn = useServerFn(getModel8V3Stats);
  const m8v3PendingFn = useServerFn(getModel8V3Pending);
  const exportM8v3Fn = useServerFn(exportModel8V3Csv);
  const m8v3StatsQ = useQuery({ queryKey: ["model8-v3-stats"], queryFn: () => m8v3StatsFn(), refetchInterval: 10_000, refetchIntervalInBackground: true, staleTime: 0 });
  const m8v3PendingQ = useQuery({ queryKey: ["model8-v3-pending"], queryFn: () => m8v3PendingFn(), refetchInterval: 10_000, refetchIntervalInBackground: true, staleTime: 0 });
  const m8v3CandidateFn = useServerFn(getModel8V3PendingCandidate);
  const approveM8v3Fn = useServerFn(approveModel8V3Candidate);
  const rejectM8v3Fn = useServerFn(rejectModel8V3Candidate);
  const [m8v3ReviewNotes, setM8v3ReviewNotes] = useState("");
  const [m8v3ReviewBusy, setM8v3ReviewBusy] = useState(false);
  const runM8v3Review = async (decision: "approve" | "reject" | "continue") => {
    const fitId = (m8v3CandidateQ.data as { fit_id?: string } | null)?.fit_id;
    if (!fitId) return;
    setM8v3ReviewBusy(true);
    try {
      if (decision === "approve") await approveM8v3Fn({ data: { fit_id: fitId, notes: m8v3ReviewNotes } });
      else await rejectM8v3Fn({ data: { fit_id: fitId, decision, notes: m8v3ReviewNotes } });
      setM8v3ReviewNotes("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["model8-v3-candidate"] }),
        qc.invalidateQueries({ queryKey: ["model8-v3-stats"] }),
      ]);
    } catch (e) {
      alert(`Review failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setM8v3ReviewBusy(false);
    }
  };
  const m8v3CandidateQ = useQuery({ queryKey: ["model8-v3-candidate"], queryFn: () => m8v3CandidateFn(), refetchInterval: 15_000, refetchIntervalInBackground: true, staleTime: 0 });
  const [exportingM8v3, setExportingM8v3] = useState(false);
  const [exportingA96, setExportingA96] = useState(false);
  const [exportingA96Combined, setExportingA96Combined] = useState(false);
  const [resettingA96, setResettingA96] = useState(false);
  const [resettingTd1, setResettingTd1] = useState(false);
  const [exportingTd1, setExportingTd1] = useState(false);

  async function downloadM8v3Csv() {
    try {
      setExportingM8v3(true);
      const rows = await exportM8v3Fn();
      if (!rows || rows.length === 0) { alert("No Model 3 FWD rows to export."); return; }
      triggerDownload(rowsToCsv(rows as any[]), `model3-fwd-${stamp()}.csv`);
    } finally {
      setExportingM8v3(false);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "a96_predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["a96-stats"] });
        qc.invalidateQueries({ queryKey: ["a96-pending"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "model8_v3_predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["model8-v3-stats"] });
        qc.invalidateQueries({ queryKey: ["model8-v3-pending"] });
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

  const m8v3Stats = (m8v3StatsQ.data ?? {}) as Record<string, any>;
  const m8v3Qualified = (m8v3Stats.qualified ?? {}) as Record<string, any>;
  const m8v3Pending = m8v3PendingQ.data as Record<string, any> | null;
  const m8v3Q = m8v3Pending?.qualified_prediction ?? null;

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
          subtitle="a96-r1"
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
            <MiniStat label="Fit overrides" value={Number(a96Stats.overrides ?? 0)} />
            <MiniStat label="Agreement vetoes" value={Number(a96Stats.agreement_vetoes ?? 0)} />
          </div>
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

        <ModelCard
          title="Model 3 FWD"
          subtitle="v3.0.1 Shadow"
          status={m8v3CandidateQ.data ? "Review" : "Auto"}
          tone="violet"
          winRate={Number(m8v3Qualified.win_rate ?? 0)}
          wins={Number(m8v3Qualified.wins ?? 0)}
          losses={Number(m8v3Qualified.losses ?? 0)}
          pushes={Number(m8v3Qualified.pushes ?? 0)}
          pending={Number(m8v3Stats.pending ?? 0)}
          predictionLabel="Current Prediction"
          predictionTs={m8v3Pending?.target_candle_ts}
          predictionValue={m8v3Q ?? "—"}
          actions={(
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={downloadM8v3Csv} disabled={exportingM8v3}>
              {exportingM8v3 ? "…" : "CSV"}
            </Button>
          )}
        >
          {(() => {
            const cand = m8v3CandidateQ.data as Record<string, any> | null;
            if (!cand) {
              return (
                <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                  No candidate awaiting review. A candidate is trained after every 96 resolved non-PUSH official predictions and must be manually approved.
                </div>
              );
            }
            const rep = (cand.review_report ?? {}) as Record<string, any>;
            const w = rep.windows ?? {};
            const line = (label: string, win: any) => {
              const a = win?.active?.qualified ?? {};
              const c = win?.candidate_counterfactual?.qualified ?? {};
              return (
                <div key={label} className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                  <span className="text-muted-foreground">{label}</span>
                  <span>active {a.win_rate ?? 0}% ({a.wins ?? 0}-{a.losses ?? 0}) · cand {c.win_rate ?? 0}% ({c.wins ?? 0}-{c.losses ?? 0})</span>
                </div>
              );
            };
            return (
              <div className="mb-4 rounded-lg border border-amber/20 bg-amber/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-amber-400">Candidate awaiting manual approval</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{cand.fit_id}</div>
                </div>
                <div className="space-y-1">
                  {line("Last 96 qualified", w.last_96)}
                  {line("Last 384 qualified", w.last_384)}
                  {line("Cumulative qualified", w.cumulative)}
                </div>
                <textarea
                  value={m8v3ReviewNotes}
                  onChange={(e) => setM8v3ReviewNotes(e.target.value)}
                  placeholder="Review notes (optional)"
                  className="w-full text-xs rounded border border-border bg-background p-2"
                  rows={2}
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => runM8v3Review("approve")} disabled={m8v3ReviewBusy}>
                    {m8v3ReviewBusy ? "Working…" : "Approve"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => runM8v3Review("reject")} disabled={m8v3ReviewBusy}>
                    Reject
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => runM8v3Review("continue")} disabled={m8v3ReviewBusy}>
                    Continue
                  </Button>
                </div>
              </div>
            );
          })()}
        </ModelCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <BreakdownCard title="By Setup Type" data={s.by_setup as Record<string, BucketStat> | undefined} />
        <BreakdownCard title="By Confidence" data={s.by_confidence_bucket as Record<string, BucketStat> | undefined} />
        <BreakdownCard title="By Market Condition" data={s.by_market_condition as Record<string, BucketStat> | undefined} />
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

interface BucketStat { total: number; wins: number; losses: number; win_rate: number }

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
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

function ModelCard({ title, subtitle, status, tone, winRate, wins, losses, pushes, pending, predictionLabel, predictionTs, predictionValue, actions, children }: ModelCardProps) {
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
        {(pending ?? 0) > 0 && (
          <div className="text-[10px] text-muted-foreground mt-1 text-right tabular-nums">
            {pending} pending
          </div>
        )}
      </div>
    </Card>
  );
}

function BreakdownCard({ title, data }: { title: string; data?: Record<string, BucketStat> }) {
  const entries = Object.entries(data ?? {});
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base font-heading">{title}</CardTitle></CardHeader>
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
