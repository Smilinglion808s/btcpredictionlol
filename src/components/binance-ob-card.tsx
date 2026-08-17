import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { downloadCsvText } from "@/lib/csvDownload";
import {
  exportBinanceObCombinedCsv,
  exportBinanceObFeaturesCsv,
  exportBinanceObObservationsCsv,
  exportBinanceObPolicyCsv,
} from "@/lib/binanceOb.functions";

type Any = Record<string, any>;

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${n}`;
}

function pct(n: number | null | undefined, digits = 1) {
  return n == null ? "—" : `${Number(n).toFixed(digits)}%`;
}

function ms(n: number | null | undefined) {
  return n == null ? "—" : `${Math.round(Number(n))}ms`;
}

function shortPolicy(name: string) {
  return name.replace("SPOT_PERP_CONSENSUS_", "CONSENSUS ").replace("SPOT_", "").replace(/_/g, " ");
}

function netClass(n: number | null | undefined) {
  return (n ?? 0) > 0 ? "text-emerald-500" : (n ?? 0) < 0 ? "text-destructive" : "text-muted-foreground";
}

function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{children}</span>
      {right ? <span className="text-[9px] font-mono text-muted-foreground">{right}</span> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="text-[11px] font-mono text-foreground">{value}</div>
    </div>
  );
}

/**
 * Binance order-book shadow monitor. Observational only — these policies never
 * publish a webhook and never influence the ES1 decision. With no collector
 * data present, every panel reports NOT READY rather than a fake success.
 */
export function BinanceObCard({ dashboard }: { dashboard: Any | null }) {
  const d = dashboard ?? {};
  const connection: Any[] = d.connection ?? [];
  const capture: Any[] = d.capture ?? [];
  const policies: Any[] = d.policies ?? [];
  const dataPresent = d.data_present === true;

  const combined = useServerFn(exportBinanceObCombinedCsv);
  const features = useServerFn(exportBinanceObFeaturesCsv);
  const policiesCsv = useServerFn(exportBinanceObPolicyCsv);
  const observationsFn = useServerFn(exportBinanceObObservationsCsv);
  const [busy, setBusy] = useState<string | null>(null);

  const exports: Array<{ id: string; label: string; base: string; run: () => Promise<any> }> = [
    {
      id: "combined",
      label: "Full dataset",
      base: "B4x4-ES1-Binance-OB",
      run: () => combined(),
    },
    { id: "features", label: "Features", base: "Binance_OB_Features", run: () => features() },
    { id: "policies", label: "Policies", base: "Binance_OB_Policies", run: () => policiesCsv() },
    {
      id: "obs",
      label: "Raw 1s",
      base: "Binance_OB_Observations",
      run: () => observationsFn({ data: { targets: 96 } }),
    },
  ];

  const runExport = async (e: (typeof exports)[number]) => {
    setBusy(e.id);
    try {
      const res = (await e.run().catch(() => null)) as { csv: string; rows: number } | null;
      if (!res || !res.csv || res.rows === 0) {
        toast.error(`${e.label}: no rows available yet.`);
        return;
      }
      downloadCsvText(res.csv, e.base);
      toast.success(`${e.label}: ${res.rows.toLocaleString()} rows exported.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-muted/30 px-4 py-3">
        <div className="space-y-0.5">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Shadow only · no webhooks · never influences ES1
          </div>
          <h3 className="text-base font-semibold tracking-tight">Binance Order Book R1</h3>
        </div>
        <Badge variant="outline" className="font-mono text-[10px]">
          {d.mode ?? "SHADOW_ONLY"}
        </Badge>
      </div>

      <div className="space-y-4 p-4">
        {!dataPresent && (
          <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            NOT READY — no collector data has ever been received. Deploy the external collector to
            begin capture.
          </div>
        )}

        {/* Connection state per market */}
        <div className="grid grid-cols-2 gap-2">
          {(connection.length
            ? connection
            : [{ market_kind: "SPOT" }, { market_kind: "USD_M_PERP" }]
          ).map((c) => (
            <div key={c.market_kind} className="rounded-lg border border-border/60 bg-card px-3 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                  {c.market_kind === "SPOT" ? "Spot" : "USD-M Perp"}
                </span>
                <span
                  className={`size-1.5 rounded-full ${c.alive ? "bg-emerald-500" : "bg-destructive"}`}
                />
              </div>
              <div
                className={`text-sm font-mono font-semibold ${
                  c.alive ? "text-emerald-500" : "text-destructive"
                }`}
              >
                {c.alive ? "LIVE" : (c.status ?? "NOT_REPORTING")}
              </div>
              <div className="text-[10px] font-mono text-muted-foreground">
                hb {c.heartbeat_age_ms == null ? "—" : `${Math.round(c.heartbeat_age_ms / 1000)}s`} ·
                rsync {c.resync_count ?? 0} · gap {c.sequence_gap_count ?? 0} · rc{" "}
                {c.reconnect_count ?? 0}
              </div>
              <div className="text-[10px] font-mono text-muted-foreground truncate">
                {c.last_event ?? "no events"}
                {c.region_blocked ? " · REGION BLOCKED" : ""}
              </div>
            </div>
          ))}
        </div>

        {/* Capture quality per market */}
        <div className="space-y-2">
          <SectionLabel>Capture quality</SectionLabel>
          {capture.map((c) => (
            <div key={c.market_kind} className="rounded-lg border border-border/60 p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-semibold">
                  {c.market_kind === "SPOT" ? "SPOT" : "PERP"}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {c.history_ready ? "percentiles active" : `warm-up ${pct(c.history_warmup_pct, 0)}`}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <Stat label="Coverage" value={`${pct(c.coverage_pct)} / 96 ${pct(c.coverage_last96_pct)}`} />
                <Stat label="Obs" value={`${c.actual_observations ?? 0}/${c.expected_observations ?? 0}`} />
                <Stat label="Age p50/p95" value={`${ms(c.capture_age_p50_ms)} / ${ms(c.capture_age_p95_ms)}`} />
                <Stat label="History" value={`${c.history_valid_count ?? 0}/${c.history_window ?? 96}`} />
              </div>
              <div className="text-[10px] font-mono text-muted-foreground">
                gaps {c.sequence_gaps ?? 0} · stale {c.stale ?? 0} · missing {c.missing ?? 0} · crossed{" "}
                {c.crossed ?? 0} · watchdog {c.watchdog_rows ?? 0}
              </div>
            </div>
          ))}
          {capture.length === 0 && (
            <div className="text-xs text-muted-foreground">No boundaries captured yet.</div>
          )}
        </div>

        {/* Six frozen policies */}
        <div className="space-y-1">
          <SectionLabel right="cov · win% · net · maxDD">Policy shadows</SectionLabel>
          {policies.map((p) => {
            const evaluable = p.evaluable ?? 0;
            return (
              <div
                key={p.policy_name}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px] font-mono odd:bg-muted/30"
              >
                <span className="truncate">{shortPolicy(p.policy_name)}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-muted-foreground">{Math.round(p.coverage ?? 0)}%</span>
                  <span>{evaluable > 0 ? `${(p.win_rate ?? 0).toFixed(1)}%` : "—"}</span>
                  <span className={netClass(p.net)}>{signed(p.net ?? 0)}</span>
                  <span className="text-muted-foreground">{p.max_drawdown ?? 0}</span>
                </span>
              </div>
            );
          })}
          {policies.length === 0 && (
            <div className="text-xs text-muted-foreground">Awaiting collector data…</div>
          )}
        </div>

        {/* Comparisons */}
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-muted-foreground sm:grid-cols-4">
          {([
            ["Follow", d.follow_vs_fade?.follow],
            ["Fade", d.follow_vs_fade?.fade],
            ["Spot only", d.spot_vs_spot_perp?.spot],
            ["Spot+Perp", d.spot_vs_spot_perp?.spot_perp],
          ] as Array<[string, Any]>).map(([label, s]) => (
            <div key={label} className="rounded-md bg-muted/40 px-2 py-1.5">
              <div className="uppercase tracking-[0.14em]">{label}</div>
              <div>
                {s?.evaluable ? `${(s.win_rate ?? 0).toFixed(1)}%` : "—"} ·{" "}
                <span className={netClass(s?.net)}>{signed(s?.net ?? 0)}</span> · n {s?.resolved ?? 0}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Exports */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-muted/20 px-4 py-3">
        <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          Download CSV
        </span>
        {exports.map((e, i) => (
          <Button
            key={e.id}
            size="sm"
            variant={i === 0 ? "default" : "outline"}
            className="h-7 gap-1.5 text-[11px]"
            disabled={busy === e.id}
            onClick={() => void runExport(e)}
          >
            <Download className="size-3" />
            {busy === e.id ? "Preparing…" : e.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}
