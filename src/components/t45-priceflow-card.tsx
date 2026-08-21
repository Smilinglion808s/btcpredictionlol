import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Any = Record<string, any>;

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${Number(v).toFixed(d)}%`);
const signed = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n) > 0 ? "+" : ""}${Number(n)}`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="t45-chip px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`text-sm font-mono font-semibold tabular-nums mt-0.5 ${tone ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{title}</span>
        <span className="h-px flex-1 bg-gradient-to-r from-lightning/40 to-transparent" />
      </div>
      {children}
    </div>
  );
}

/**
 * T45 PriceFlow Q37.5 — live hero tile.
 *
 * Separate identity, storage and statistics from T45 Balanced. No R2 prior is
 * an input. This is the only model permitted to emit outbound webhooks.
 */
export function T45PriceFlowCard({
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
  const live: Any = stats.live ?? {};
  const backfill: Any = stats.backfill ?? {};
  const combined: Any = stats.combined ?? {};
  const packet: Any = stats.packet ?? {};
  const readiness: Any = stats.readiness ?? {};
  const daily: Any[] = stats.daily ?? [];

  const liveTrades = Number(live.trades ?? 0);
  const hasLive = liveTrades > 0;
  const heroWr = Number((hasLive ? live.winRate : combined.winRate) ?? 0);
  const heroNet = Number((hasLive ? live.net : combined.net) ?? 0);
  const heroLabel = hasLive ? "Live" : "Backtest";

  const gaugeR = 34;
  const circumference = 2 * Math.PI * gaugeR;
  const gaugePct = Math.max(0, Math.min(100, heroWr));
  const above = heroWr >= 50;

  const webhooksLive = stats.webhooksEnabled === true;
  const wouldTrade = pending?.active_would_trade === true;
  const dir = Number(pending?.active_prediction ?? 0);
  const dirLabel = wouldTrade ? (dir > 0 ? "GREEN" : dir < 0 ? "RED" : "TRADE") : "NO TRADE";
  const dirTone = !wouldTrade
    ? "border-lightning/40 text-lightning bg-lightning/10"
    : dir > 0
      ? "border-bull/50 text-bull bg-bull/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bull)_70%,transparent)]"
      : "border-bear/50 text-bear bg-bear/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bear)_70%,transparent)]";

  const targetMs = pending?.target_ts ? new Date(String(pending.target_ts)).getTime() : NaN;
  const candleLabel = Number.isFinite(targetMs)
    ? `${new Date(targetMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${new Date(
        targetMs + 15 * 60 * 1000,
      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : null;

  return (
    <Card className="t45-shell rounded-2xl p-6">
      <span className="t45-orbit-ring" aria-hidden />

      <div className="relative flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.28em] text-lightning/80 mb-1">
            Active model · webhook source
          </div>
          <h3 className="t45-title text-4xl font-bold font-heading tracking-tight leading-none">
            T45 PriceFlow
          </h3>
          <div className="text-[10px] text-muted-foreground mt-1 font-mono">
            T+45s cutoff · Q37.5 rank gate · no R2 input
          </div>
          <div className="text-[9px] text-muted-foreground/80 mt-0.5 font-mono truncate">
            {stats.modelVersion ?? "t45-price-flow-q375-r1"}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-lightning/30 hover:border-lightning/60"
            onClick={onExport}
            disabled={exporting}
          >
            {exporting ? "…" : "CSV"}
          </Button>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-lightning/40 bg-lightning/10 text-[10px] font-bold uppercase tracking-[0.16em] text-lightning">
            <span className="size-1.5 rounded-full bg-lightning t45-live-dot" />
            {webhooksLive ? "Live" : (stats.activationMode ?? "Shadow")}
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
              stroke={above ? "var(--bull)" : "var(--bear)"}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - gaugePct / 100)}
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-lg font-bold tabular-nums leading-none">
              {heroWr.toFixed(1)}%
            </span>
            <span className="text-[8px] uppercase tracking-[0.14em] text-muted-foreground mt-0.5">
              win rate
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Net · {heroLabel}
          </div>
          <div
            className={`font-mono text-5xl font-bold tracking-tighter tabular-nums leading-none mt-1 ${
              heroNet > 0 ? "text-bull" : heroNet < 0 ? "text-bear" : "text-foreground"
            }`}
          >
            {signed(heroNet)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5 tabular-nums">
            break-even 50.00%
            <span className={`ml-1.5 font-semibold ${above ? "text-bull" : "text-bear"}`}>
              {above ? "▲ above" : "▼ below"}
            </span>
          </div>
        </div>
      </div>

      <Section title="Current candle">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`px-4 py-1.5 rounded-lg border text-sm font-bold uppercase tracking-[0.16em] font-mono ${dirTone}`}
          >
            {dirLabel}
          </span>
          {candleLabel ? (
            <span className="text-[10px] font-mono text-lightning tabular-nums">{candleLabel}</span>
          ) : null}
          {pending?.webhook_sent ? (
            <span className="text-[10px] font-mono text-bull">webhook sent</span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono opacity-80">
          {pending ? (
            <>
              <span>
                p{" "}
                {pending.probability_green == null
                  ? "—"
                  : Number(pending.probability_green).toFixed(4)}
              </span>
              <span>
                rank{" "}
                {pending.confidence_rank == null
                  ? "—"
                  : Number(pending.confidence_rank).toFixed(3)}
              </span>
              <span className="truncate">{String(pending.decision_reason ?? "—")}</span>
            </>
          ) : (
            <span>No live row yet.</span>
          )}
        </div>
      </Section>

      <div className="relative mt-4">
        <Section title="Live tracking">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Trades" value={String(liveTrades)} />
            <Stat label="Wins" value={String(live.wins ?? 0)} tone="text-bull" />
            <Stat label="Losses" value={String(live.losses ?? 0)} tone="text-bear" />
            <Stat label="Pushes" value={String(live.pushes ?? 0)} />
            <Stat label="Win rate" value={pct(live.winRate, 2)} />
            <Stat
              label="Net"
              value={signed(live.net)}
              tone={Number(live.net ?? 0) >= 0 ? "text-bull" : "text-bear"}
            />
            <Stat label="Coverage" value={pct(live.evaluableCoverage)} />
            <Stat label="Webhooks sent" value={String(stats.webhookProof?.sentRows ?? 0)} />
          </div>
        </Section>
      </div>

      <div className="relative mt-4">
        <Section title="Backtest baseline">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Trades" value={String(combined.trades ?? 0)} />
            <Stat label="Win rate" value={pct(combined.winRate, 2)} />
            <Stat
              label="Net"
              value={signed(combined.net)}
              tone={Number(combined.net ?? 0) >= 0 ? "text-bull" : "text-bear"}
            />
            <Stat label="Coverage" value={pct(combined.evaluableCoverage)} />
            <Stat label="Max DD" value={String(combined.maxDrawdown ?? 0)} />
            <Stat label="Max loss streak" value={String(combined.maxLossStreak ?? 0)} />
            <Stat label="Neg. days" value={String(stats.negativeDays ?? 0)} />
            <Stat
              label="Worst day"
              value={stats.worstDay ? signed(stats.worstDay.net) : "—"}
              tone="text-bear"
            />
          </div>
        </Section>
      </div>

      <div className="relative mt-4">
        <Section title="Pipeline health">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Live rows" value={String(live.scheduled ?? 0)} />
            <Stat label="Backfill rows" value={String(backfill.scheduled ?? 0)} />
            <Stat label="Packet 45/45" value={String(packet.full45 ?? 0)} />
            <Stat label="Capture coverage" value={pct(packet.coverage)} />
            <Stat label="Timing failures" value={String(packet.timingFailures ?? 0)} />
            <Stat label="Packet failures" value={String(packet.packetFailures ?? 0)} />
            <Stat
              label="Fit ready"
              value={readiness.fitReady ? "YES" : "NO"}
              tone={readiness.fitReady ? "text-bull" : "text-bear"}
            />
            <Stat
              label="Rank ready"
              value={readiness.rankReady ? "YES" : "NO"}
              tone={readiness.rankReady ? "text-bull" : "text-bear"}
            />
          </div>
        </Section>
      </div>

      {daily.length > 0 && (
        <div className="relative mt-4 flex flex-wrap gap-1">
          {daily.slice(-14).map((d) => (
            <span
              key={d.date}
              className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                d.net >= 0 ? "border-bull/30 text-bull" : "border-bear/30 text-bear"
              }`}
            >
              {String(d.date).slice(5)} {signed(d.net)}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
