import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listPredictions, overridePrediction } from "@/lib/predictions.functions";
import { PredictionBadge, StatusBadge } from "@/components/status-badges";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [{ title: "History — BTC 15m" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPredictions);
  const overrideFn = useServerFn(overridePrediction);
  const listQ = useQuery({ queryKey: ["predictions-list"], queryFn: () => listFn() });

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pred, setPred] = useState("all");
  const [status, setStatus] = useState("all");
  const [setup, setSetup] = useState("");
  const [model, setModel] = useState("");
  const [confMin, setConfMin] = useState("");
  const [confMax, setConfMax] = useState("");

  useEffect(() => {
    const ch = supabase
      .channel("history-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["predictions-list"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const filtered = useMemo(() => {
    return (listQ.data ?? []).filter((p) => {
      const t = new Date(p.created_at).getTime();
      if (from && t < new Date(from).getTime()) return false;
      if (to && t > new Date(to).getTime() + 86400000) return false;
      if (pred !== "all" && p.prediction !== pred) return false;
      if (status !== "all" && p.status !== status) return false;
      if (setup && !(p.setup_type ?? "").toLowerCase().includes(setup.toLowerCase())) return false;
      if (model && !(p.model_version ?? "").toLowerCase().includes(model.toLowerCase())) return false;
      const c = Number(p.confidence);
      if (confMin && c < Number(confMin)) return false;
      if (confMax && c > Number(confMax)) return false;
      return true;
    });
  }, [listQ.data, from, to, pred, status, setup, model, confMin, confMax]);

  const overrideMut = useMutation({
    mutationFn: (vars: { id: string; status: string }) =>
      overrideFn({ data: { id: vars.id, status: vars.status as "win" | "loss" | "push" | "pending" | "manual_review" } }),
    onSuccess: () => { toast.success("Outcome updated"); qc.invalidateQueries({ queryKey: ["predictions-list"] }); qc.invalidateQueries({ queryKey: ["stats"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  return (
    <div className="px-4 sm:px-6 py-5 space-y-5 max-w-[1600px] mx-auto">
      <h1 className="text-xl font-semibold">Prediction History</h1>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <FilterField label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></FilterField>
          <FilterField label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></FilterField>
          <FilterField label="Pred">
            <Select value={pred} onValueChange={setPred}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="YES">YES</SelectItem>
                <SelectItem value="NO">NO</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Status">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="win">Win</SelectItem>
                <SelectItem value="loss">Loss</SelectItem>
                <SelectItem value="push">Push</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="manual_review">Manual Review</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Conf Min"><Input type="number" min={0} max={100} value={confMin} onChange={(e) => setConfMin(e.target.value)} /></FilterField>
          <FilterField label="Conf Max"><Input type="number" min={0} max={100} value={confMax} onChange={(e) => setConfMax(e.target.value)} /></FilterField>
          <FilterField label="Setup"><Input value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="e.g. reclaim" /></FilterField>
          <FilterField label="Model"><Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. 1.9" /></FilterField>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Candle</th>
                  <th className="text-left px-3 py-2">Pred</th>
                  <th className="text-left px-3 py-2">Conf</th>
                  <th className="text-left px-3 py-2">Price</th>
                  <th className="text-left px-3 py-2">Actual</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Setup</th>
                  <th className="text-left px-3 py-2">Model</th>
                  <th className="text-left px-3 py-2">Reason</th>
                  <th className="text-left px-3 py-2">Override</th>
                </tr>
              </thead>
              <tbody className="font-mono align-top">
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{new Date(p.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{new Date(p.candle_ts).toLocaleString()}</td>
                    <td className="px-3 py-2"><PredictionBadge value={p.prediction} /></td>
                    <td className="px-3 py-2">{Number(p.confidence).toFixed(0)}%</td>
                    <td className="px-3 py-2 text-xs">${Number(p.btc_price_at_prediction).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs">
                      {p.actual_next_candle_close
                        ? `O ${Number(p.actual_next_candle_open).toFixed(1)} → C ${Number(p.actual_next_candle_close).toFixed(1)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                    <td className="px-3 py-2 text-xs">{p.setup_type ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{p.model_version}</td>
                    <td className="px-3 py-2 text-xs max-w-[280px] truncate" title={p.reasoning_summary ?? ""}>{p.reasoning_summary ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Select value={p.status} onValueChange={(v) => overrideMut.mutate({ id: p.id, status: v })}>
                        <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="win">Win</SelectItem>
                          <SelectItem value="loss">Loss</SelectItem>
                          <SelectItem value="push">Push</SelectItem>
                          <SelectItem value="manual_review">Manual Review</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-10 text-center text-sm text-muted-foreground">No predictions match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}
