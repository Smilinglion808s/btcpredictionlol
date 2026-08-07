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

export function B4x4Card({
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
  const grid: Array<{ cell: string; resolvedCount: number; wins: number; losses: number; pCorrect: number }> =
    stats.grid ?? [];
  const last7: Array<{ date: string; net: number; wins: number; losses: number }> = stats.last7 ?? [];

  const upper = String(pending?.final_prediction ?? pending?.raw_direction ?? "—").toUpperCase();
  const traded = pending?.would_trade === true;
  const candleMs = pending?.target_candle_ts ? new Date(String(pending.target_candle_ts)).getTime() : NaN;
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

  const gaugeR = 34;
  const circumference = 2 * Math.PI * gaugeR;
  const pct = Math.max(0, Math.min(100, wr));
  const aboveBreakeven = wr >= 50;

  return (
    <Card className="b4-shell rounded-2xl p-6">
      <span className="b4-orbit-ring" aria-hidden />
      <span className="v6-sheen" aria-hidden />

      <div className="relative flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.28em] text-amber/80 mb-1">
            Active model · frozen B4x4-v1
          </div>
          <h3 className="b4-title text-4xl font-bold font-heading tracking-tight leading-none">B4x4</h3>
          <div className="text-[10px] text-muted-foreground mt-1 font-mono">
            A2_Combined ranks · 4×4 correctness grid · loss brake
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber/30 hover:border-amber/60"
            onClick={onExport}
            disabled={exporting}
          >
            {exporting ? "…" : "CSV"}
          </Button>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber/40 bg-amber/10 text-[10px] font-bold uppercase tracking-[0.16em] text-amber">
            <span className="size-1.5 rounded-full bg-amber b4-live-dot" />
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
            <span className="font-mono text-lg font-bold tabular-nums leading-none">{wr.toFixed(1)}%</span>
            <span className="text-[8px] uppercase tracking-[0.14em] text-muted-foreground mt-0.5">win rate</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Raw net · primary</div>
          <div
            className={`font-mono text-5xl font-bold tracking-tighter tabular-nums leading-none mt-1 ${
              net > 0 ? "text-bull" : net < 0 ? "text-bear" : "text-foreground"
            }`}
          >
            {signed(net)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5 tabular-nums">
            break-even 50.00%
            <span className={`ml-1.5 font-semibold ${aboveBreakeven ? "text-bull" : "text-bear"}`}>
              {aboveBreakeven ? "▲ above" : "▼ below"}
            </span>
          </div>
        </div>
      </div>

      <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Stat label="W / L" value={`${wins} / ${losses}`} />
        <Stat label="Coverage" value={`${coverage.toFixed(1)}%`} />
        <Stat label="Trades" value={String(stats.trades ?? 0)} />
        <Stat label="Max DD" value={String(stats.max_drawdown ?? 0)} />
      </div>

      <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        <Stat
          label="Today"
          value={`${signed(Number(stats.today_net ?? 0))} · ${stats.today_trades ?? 0}t`}
          tone={Number(stats.today_net ?? 0) < 0 ? "text-bear" : ""}
        />
        <Stat
          label="Loss brake"
          value={stats.brake_active_now ? "ACTIVE" : "armed"}
          tone={stats.brake_active_now ? "text-bear" : "text-muted-foreground"}
        />
      </div>


      <div className="relative mb-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Current candle</span>
          {candleLabel ? (
            <span className="text-[10px] font-mono text-amber tabular-nums">{candleLabel}</span>
          ) : null}
          <span className="h-px flex-1 bg-gradient-to-r from-amber/40 to-transparent" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-3 py-1 rounded-lg border text-xs font-mono font-semibold ${predTone}`}>
            {traded ? upper : "NO TRADE"}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {pending?.selected_route ?? pending?.decision_reason ?? "—"}
          </span>
          {pending?.grid_cell ? (
            <span className="text-[10px] font-mono text-amber">
              {String(pending.grid_cell)} · p={Number(pending.p_correct ?? 0).toFixed(3)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative mb-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            4×4 correctness grid (latest snapshot)
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-amber/40 to-transparent" />
        </div>
        {grid.length === 16 ? (
          <div className="grid grid-cols-4 gap-1">
            {grid.map((g) => {
              const p = g.pCorrect;
              const strength = Math.max(0, Math.min(1, (p - 0.35) / 0.3));
              return (
                <div
                  key={g.cell}
                  className="rounded-md border border-border/60 px-1.5 py-1.5 text-center"
                  style={{
                    background: `color-mix(in oklab, var(--${p >= 0.5 ? "bull" : "bear"}) ${Math.round(
                      (p >= 0.5 ? strength : 1 - strength) * 34,
                    )}%, transparent)`,
                  }}
                  title={`${g.cell}: ${g.wins}W / ${g.losses}L over ${g.resolvedCount}`}
                >
                  <div className="text-[8px] font-mono text-muted-foreground">{g.cell}</div>
                  <div className="text-xs font-mono font-semibold">{p.toFixed(2)}</div>
                  <div className="text-[8px] font-mono text-muted-foreground">n={g.resolvedCount}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-[10px] font-mono text-muted-foreground">Grid warming up…</div>
        )}
      </div>

      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Last 7 local days</span>
          <span className="h-px flex-1 bg-gradient-to-r from-amber/40 to-transparent" />
        </div>
        <div className="grid grid-cols-7 gap-1">
          {last7.map((d) => (
            <div key={d.date} className="b4-chip px-1 py-1.5 text-center">
              <div className="text-[8px] font-mono text-muted-foreground">{d.date.slice(5)}</div>
              <div
                className={`text-xs font-mono font-semibold ${d.net > 0 ? "text-bull" : d.net < 0 ? "text-bear" : ""}`}
              >
                {signed(d.net)}
              </div>
              <div className="text-[8px] font-mono text-muted-foreground">
                {d.wins}-{d.losses}
              </div>
            </div>
          ))}
          {last7.length === 0 ? (
            <div className="col-span-7 text-[10px] font-mono text-muted-foreground">No resolved days yet.</div>
          ) : null}
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Core-only net" value={signed(Number(stats.core_only_net ?? 0))} />
        <Stat label="Expansion-only net" value={signed(Number(stats.expansion_only_net ?? 0))} />
        <Stat label="No-brake net" value={signed(Number(stats.base_no_brake_net ?? 0))} />
        <Stat
          label="Brake Δ"
          value={`${signed(Number(stats.brake_incremental_net ?? 0))} (${stats.brake_avoided_losses ?? 0}/${
            stats.brake_sacrificed_wins ?? 0
          })`}
        />
      </div>
    </Card>
  );
}
