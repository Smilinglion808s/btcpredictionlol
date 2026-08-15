import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Any = Record<string, any>;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="b4-chip px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`text-sm font-mono font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${n}`;
}

export function B4x4Es1Card({
  stats,
  pending,
  onExport,
  exporting,
}: {
  stats: Any;
  pending: Any | null;
  onExport: () => void;
  exporting: boolean;
}) {
  const wins = Number(stats.wins ?? 0);
  const losses = Number(stats.losses ?? 0);
  const net = Number(stats.net ?? 0);
  const wr = Number(stats.win_rate ?? 0);
  const coverage = Number(stats.coverage ?? 0);
  const last7: Array<{ date: string; net: number; wins: number; losses: number; trades: number }> =
    stats.last7 ?? [];
  const warmup: Any | null = (stats.warmup as Any | undefined) ?? null;

  const traded = pending?.would_trade === true;
  const upper = String(pending?.final_prediction ?? pending?.hybrid_direction ?? "—").toUpperCase();
  const candleMs = pending?.target_candle_ts
    ? new Date(String(pending.target_candle_ts)).getTime()
    : NaN;
  const candleLabel = Number.isFinite(candleMs)
    ? `${new Date(candleMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${new Date(
        candleMs + 15 * 60 * 1000,
      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : null;
  const predTone =
    traded && upper === "GREEN"
      ? "border-bull/50 text-bull bg-bull/10"
      : traded && upper === "RED"
        ? "border-bear/50 text-bear bg-bear/10"
        : "border-amber/40 text-amber bg-amber/10";

  const glowTone =
    traded && upper === "GREEN"
      ? "from-bull/20"
      : traded && upper === "RED"
        ? "from-bear/20"
        : "from-amber/15";

  return (
    <Card className="relative overflow-hidden p-0">
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${glowTone} via-transparent to-transparent`}
      />
      <div className="relative p-5 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="font-heading text-lg tracking-tight">B4x4-ES1</h3>
              <span className="rounded-full border border-bull/40 bg-bull/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-bull">
                Active
              </span>
            </div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-mono">
              {String(stats.variant ?? "es1")}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>

        <div className={`rounded-lg border px-4 py-3 ${predTone}`}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[9px] uppercase tracking-[0.18em] opacity-80">
                Pending candle {candleLabel ? `· ${candleLabel}` : ""}
              </div>
              <div className="text-2xl font-heading font-semibold leading-tight">
                {traded ? upper : "ABSTAIN"}
              </div>
            </div>
            <div className="text-right text-[10px] font-mono opacity-85 max-w-[55%]">
              {String(pending?.decision_reason ?? "—")}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono opacity-80">
            <span>route {String(pending?.hybrid_route ?? "—")}</span>
            <span>
              A2{" "}
              {pending?.a2_agrees === true
                ? "agree"
                : pending?.a2_agrees === false
                  ? "disagree"
                  : "—"}
            </span>
            <span>
              rank{" "}
              {pending?.combined_confidence_rank != null
                ? Number(pending.combined_confidence_rank).toFixed(2)
                : "—"}
            </span>
            <span>cell {String(pending?.b4_cell ?? "—")}</span>
            <span>
              p {pending?.b4_p_correct != null ? Number(pending.b4_p_correct).toFixed(3) : "—"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Win rate" value={`${wr.toFixed(1)}%`} />
          <Stat
            label="Net"
            value={signed(net)}
            tone={net > 0 ? "text-bull" : net < 0 ? "text-bear" : ""}
          />
          <Stat label="W / L" value={`${wins} / ${losses}`} />
          <Stat label="Coverage" value={`${coverage.toFixed(1)}%`} />
          <Stat label="Trades" value={String(stats.trades ?? 0)} />
          <Stat label="Pending" value={String(stats.pending ?? 0)} />
          <Stat
            label="Price / OB route"
            value={`${stats.price_route_trades ?? 0} / ${stats.ob_route_trades ?? 0}`}
          />
          <Stat label="Max DD" value={String(stats.max_drawdown ?? 0)} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Guard avoided" value={String(stats.guard_avoided_losses ?? 0)} />
          <Stat label="Guard sacrificed" value={String(stats.guard_sacrificed_wins ?? 0)} />
          <Stat
            label="Guard net"
            value={signed(Number(stats.guard_incremental_net ?? 0))}
            tone={
              Number(stats.guard_incremental_net ?? 0) > 0
                ? "text-bull"
                : Number(stats.guard_incremental_net ?? 0) < 0
                  ? "text-bear"
                  : ""
            }
          />
          <Stat label="Abstain (disagree)" value={String(stats.abstain_disagree ?? 0)} />
        </div>


      {last7.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left py-1">Day</th>
                <th className="text-right py-1">Trades</th>
                <th className="text-right py-1">W</th>
                <th className="text-right py-1">L</th>
                <th className="text-right py-1">Net</th>
              </tr>
            </thead>
            <tbody>
              {last7.map((d) => (
                <tr key={d.date} className="border-t border-border/50">
                  <td className="py-1">{d.date}</td>
                  <td className="text-right">{d.trades}</td>
                  <td className="text-right">{d.wins}</td>
                  <td className="text-right">{d.losses}</td>
                  <td
                    className={`text-right ${d.net > 0 ? "text-bull" : d.net < 0 ? "text-bear" : ""}`}
                  >
                    {signed(d.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {warmup && (
        <p className="text-[10px] text-muted-foreground font-mono">
          Warmup / backfill segment (excluded from the live test): {warmup.trades ?? 0} trades ·{" "}
          {Number(warmup.win_rate ?? 0).toFixed(1)}% · net {signed(Number(warmup.net ?? 0))} over{" "}
          {warmup.total_opportunities ?? 0} opportunities.
        </p>
      )}
      </div>
    </Card>

  );
}
