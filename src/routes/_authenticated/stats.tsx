import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPredictionStats, listPredictions } from "@/lib/predictions.functions";
import { PredictionBadge, StatusBadge } from "@/components/status-badges";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/stats")({
  head: () => ({ meta: [{ title: "Stats — BTC 15m" }] }),
  component: StatsPage,
});

function StatsPage() {
  const qc = useQueryClient();
  const statsFn = useServerFn(getPredictionStats);
  const listFn = useServerFn(listPredictions);
  const statsQ = useQuery({ queryKey: ["stats"], queryFn: () => statsFn() });
  const listQ = useQuery({ queryKey: ["predictions-list"], queryFn: () => listFn() });

  useEffect(() => {
    const ch = supabase
      .channel("stats-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["stats"] });
        qc.invalidateQueries({ queryKey: ["predictions-list"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const s = (statsQ.data ?? {}) as Record<string, unknown>;
  const num = (k: string) => Number(s[k] ?? 0);

  return (
    <div className="px-4 sm:px-6 py-5 space-y-5 max-w-[1600px] mx-auto">
      <h1 className="text-xl font-semibold">Performance Stats</h1>

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
                {(listQ.data ?? []).slice(0, 25).map((p) => (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="px-3 py-2">{new Date(p.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2"><PredictionBadge value={p.prediction} /></td>
                    <td className="px-3 py-2">{Number(p.confidence).toFixed(0)}%</td>
                    <td className="px-3 py-2 text-xs">{p.setup_type ?? "—"}</td>
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
