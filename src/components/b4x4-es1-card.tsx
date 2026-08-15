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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{title}</span>
        <span className="h-px flex-1 bg-gradient-to-r from-amber/40 to-transparent" />
      </div>
      {children}
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
  const pushes = Number(stats.pushes ?? 0);
  const net = Number(stats.net ?? 0);
  const wr = Number(stats.win_rate ?? 0);
  const coverage = Number(stats.coverage ?? 0);
  const pendingCount = Number(stats.pending ?? 0);
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
      ? "border-bull/50 text-bull bg-bull/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bull)_70%,transparent)]"
      : traded && upper === "RED"
        ? "border-bear/50 text-bear bg-bear/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bear)_70%,transparent)]"
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
            Active model · B4x4-ES1
          </div>
          <h3 className="b4-title text-4xl font-bold font-heading tracking-tight leading-none">ES1</h3>
          <div className="text-[10px] text-muted-foreground mt-1 font-mono">
            11-step directional engine · price-head + OB fade + A2 agreement
          </div>
          <div className="text-[9px] text-muted-foreground/80 mt-0.5 font-mono truncate">
            {String(stats.variant ?? "es1")}
            {stats.model_version ? ` · ${String(stats.model_version)}` : ""}
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

      <div className="relative grid grid-cols-4 gap-2 mb-4">
        <Stat label="Wins" value={String(wins)} tone="text-bull" />
        <Stat label="Losses" value={String(losses)} tone="text-bear" />
        <Stat label="Pushes" value={String(pushes)} />
        <Stat label="Pending" value={String(pendingCount)} />
      </div>

      <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Stat label="W / L" value={`${wins} / ${losses}`} />
        <Stat label="Coverage" value={`${coverage.toFixed(1)}%`} />
        <Stat label="Trades" value={String(stats.trades ?? 0)} />
        <Stat label="Max DD" value={String(stats.max_drawdown ?? 0)} />
        <Stat label="Price route" value={String(stats.price_route_trades ?? 0)} />
        <Stat label="OB route" value={String(stats.ob_route_trades ?? 0)} />
        <Stat label="Today" value={`${signed(Number(stats.today_net ?? 0))} · ${stats.today_trades ?? 0}t`} />
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
      </div>

      <Section title="Current candle">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-4 py-1.5 rounded-lg border text-sm font-bold uppercase tracking-[0.16em] font-mono ${predTone}`}>
            {traded ? upper : "NO TRADE"}
          </span>
          {candleLabel ? (
            <span className="text-[10px] font-mono text-amber tabular-nums">{candleLabel}</span>
          ) : null}
          <span className="text-[10px] font-mono text-muted-foreground">
            {String(pending?.decision_reason ?? "—")}
          </span>
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
      </Section>

      <Section title="Guard attribution">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Guard avoided" value={String(stats.guard_avoided_losses ?? 0)} tone="text-bull" />
          <Stat label="Guard sacrificed" value={String(stats.guard_sacrificed_wins ?? 0)} tone="text-bear" />
          <Stat label="Abstain (disagree)" value={String(stats.abstain_disagree ?? 0)} />
          <Stat label="Abstain (guard)" value={String(stats.abstain_guard ?? 0)} />
          <Stat label="Abstain (confidence)" value={String(stats.abstain_confidence ?? 0)} />
          <Stat label="Abstain (not ready)" value={String(stats.abstain_not_ready ?? 0)} />
        </div>
      </Section>

      <Section title="Last 7 local days">
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
      </Section>

      {warmup && Number(warmup.trades ?? 0) > 0 ? (
        <div className="relative b4-chip px-3 py-2 mb-4 opacity-70">
          <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Warmup / backfill segment · excluded from headline
          </div>
          <div className="text-[11px] font-mono tabular-nums mt-0.5">
            {Number(warmup.trades ?? 0)} trades · {Number(warmup.wins ?? 0)}W / {Number(warmup.losses ?? 0)}L ·
            net {signed(Number(warmup.net ?? 0))} · {Number(warmup.win_rate ?? 0).toFixed(1)}% over{" "}
            {warmup.total_opportunities ?? 0} opportunities
          </div>
        </div>
      ) : null}
    </Card>
  );
}
