import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Any = Record<string, any>;

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${n}`;
}

function shortPolicy(name: string) {
  return name.replace("SPOT_PERP_CONSENSUS_", "CONSENSUS ").replace("SPOT_", "").replace(/_/g, " ");
}

/**
 * Binance order-book shadow monitor. Observational only — these policies never
 * publish a webhook and never influence the ES1 decision.
 */
export function BinanceObCard({ stats, health }: { stats: Any; health: Any | null }) {
  const policies: Any[] = stats?.policies ?? [];
  const collectors: Any[] = health?.collectors ?? [];
  const recent: Any[] = health?.recent_boundaries ?? [];
  const lastSpot = recent.find((r) => r.market_kind === "SPOT") ?? null;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Shadow only · no webhooks
          </div>
          <h3 className="text-base font-semibold">Binance Order Book R1</h3>
        </div>
        <Badge variant="outline" className="font-mono text-[10px]">
          {stats?.total_targets ?? 0} targets
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {collectors.map((c) => (
          <div key={c.marketKind} className="b4-chip px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              {c.marketKind === "SPOT" ? "Spot" : "USD-M Perp"}
            </div>
            <div
              className={`text-sm font-mono font-semibold ${c.alive ? "text-emerald-500" : "text-destructive"}`}
            >
              {c.alive ? "LIVE" : (c.status ?? "DOWN")}
            </div>
          </div>
        ))}
      </div>

      {lastSpot && (
        <div className="text-[11px] font-mono text-muted-foreground">
          last boundary {String(lastSpot.target_ts).slice(11, 16)}Z ·{" "}
          {String(lastSpot.capture_status)} · {lastSpot.ready ? "ready" : String(lastSpot.ready_reason)}{" "}
          · history {lastSpot.history_valid_count ?? 0}/96
        </div>
      )}

      <div className="space-y-1">
        {policies.map((p) => {
          const evaluable = (p.wins ?? 0) + (p.losses ?? 0);
          return (
            <div
              key={p.policy_name}
              className="flex items-center justify-between gap-2 text-[11px] font-mono border-b border-border/40 py-1 last:border-0"
            >
              <span className="truncate">{shortPolicy(p.policy_name)}</span>
              <span className="flex items-center gap-3 shrink-0">
                <span className="text-muted-foreground">{Math.round(p.coverage ?? 0)}% cov</span>
                <span>{evaluable > 0 ? `${(p.win_rate ?? 0).toFixed(1)}%` : "—"}</span>
                <span
                  className={
                    (p.net ?? 0) > 0
                      ? "text-emerald-500"
                      : (p.net ?? 0) < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {signed(p.net ?? 0)}
                </span>
              </span>
            </div>
          );
        })}
        {policies.length === 0 && (
          <div className="text-xs text-muted-foreground">Awaiting collector data…</div>
        )}
      </div>
    </Card>
  );
}
