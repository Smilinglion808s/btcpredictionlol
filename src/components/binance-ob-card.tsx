import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Shadow only · no webhooks · never influences ES1
          </div>
          <h3 className="text-base font-semibold">Binance Order Book R1</h3>
        </div>
        <Badge variant="outline" className="font-mono text-[10px]">
          {d.mode ?? "SHADOW_ONLY"}
        </Badge>
      </div>

      {!dataPresent && (
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          NOT READY — no collector data has ever been received. Deploy the external collector to
          begin capture.
        </div>
      )}

      {/* Connection state per market */}
      <div className="grid grid-cols-2 gap-2">
        {(connection.length ? connection : [{ market_kind: "SPOT" }, { market_kind: "USD_M_PERP" }]).map(
          (c) => (
            <div key={c.market_kind} className="b4-chip px-3 py-2 space-y-0.5">
              <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                {c.market_kind === "SPOT" ? "Spot" : "USD-M Perp"}
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
          ),
        )}
      </div>

      {/* Capture quality per market */}
      <div className="space-y-1">
        <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          Capture quality
        </div>
        {capture.map((c) => (
          <div key={c.market_kind} className="text-[11px] font-mono text-muted-foreground space-y-0.5">
            <div>
              {c.market_kind === "SPOT" ? "SPOT" : "PERP"} · coverage {pct(c.coverage_pct)} (last 96{" "}
              {pct(c.coverage_last96_pct)}) · obs {c.actual_observations ?? 0}/
              {c.expected_observations ?? 0}
            </div>
            <div>
              age p50 {ms(c.capture_age_p50_ms)} · p90 {ms(c.capture_age_p90_ms)} · p95{" "}
              {ms(c.capture_age_p95_ms)} · max {ms(c.capture_age_max_ms)}
            </div>
            <div>
              gaps {c.sequence_gaps ?? 0} · stale {c.stale ?? 0} · missing {c.missing ?? 0} · crossed{" "}
              {c.crossed ?? 0} · watchdog {c.watchdog_rows ?? 0}
            </div>
            <div>
              history {c.history_valid_count ?? 0}/{c.history_window ?? 96} ·{" "}
              {c.history_ready ? "percentiles active" : `warm-up ${pct(c.history_warmup_pct, 0)}`}
            </div>
          </div>
        ))}
        {capture.length === 0 && (
          <div className="text-xs text-muted-foreground">No boundaries captured yet.</div>
        )}
      </div>

      {/* Six frozen policies */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          <span>Policy shadows</span>
          <span>cov · win% · net · maxDD</span>
        </div>
        {policies.map((p) => {
          const evaluable = p.evaluable ?? 0;
          return (
            <div
              key={p.policy_name}
              className="flex items-center justify-between gap-2 text-[11px] font-mono border-b border-border/40 py-1 last:border-0"
            >
              <span className="truncate">{shortPolicy(p.policy_name)}</span>
              <span className="flex items-center gap-3 shrink-0">
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
      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-muted-foreground">
        {([
          ["Follow", d.follow_vs_fade?.follow],
          ["Fade", d.follow_vs_fade?.fade],
          ["Spot only", d.spot_vs_spot_perp?.spot],
          ["Spot+Perp", d.spot_vs_spot_perp?.spot_perp],
        ] as Array<[string, Any]>).map(([label, s]) => (
          <div key={label} className="b4-chip px-2 py-1">
            <div className="uppercase tracking-[0.14em]">{label}</div>
            <div>
              {s?.evaluable ? `${(s.win_rate ?? 0).toFixed(1)}%` : "—"} ·{" "}
              <span className={netClass(s?.net)}>{signed(s?.net ?? 0)}</span> · n {s?.resolved ?? 0}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
