import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Any = Record<string, any>;

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${n}`;
}

function pct(v: number | null | undefined, digits = 1) {
  return v == null ? "—" : `${Number(v).toFixed(digits)}%`;
}

function num(v: number | null | undefined) {
  return v == null ? "—" : String(Number(v));
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="t45-chip px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`text-sm font-mono font-semibold mt-0.5 tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative mt-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{title}</span>
        <span className="h-px flex-1 bg-gradient-to-r from-lightning/40 to-transparent" />
      </div>
      {children}
    </div>
  );
}

/**
 * T45 Balanced — hero-style dashboard tile in lightning blue.
 *
 * Live and research rows are kept in separate buckets so the 25k+ backfill
 * rows never contaminate the live shadow record.
 */
export function T45Card({
  stats,
  pending,
  onExport,
  onExportFeatures,
  exporting,
}: {
  stats: Any;
  pending: Any | null;
  onExport: () => void;
  onExportFeatures: () => void;
  exporting: boolean;
}) {
  const live: Any = stats.live ?? {};
  const research: Any = stats.research ?? {};
  const collector: Any = stats.collector ?? {};
  const blockers: string[] = stats.blockers ?? [];

  const winRate = Number(live.winRate ?? 0);
  const net = Number(live.net ?? 0);
  const aboveBreakeven = winRate >= 50;
  const coverage =
    Number(live.rows ?? 0) > 0 ? (Number(live.trades ?? 0) / Number(live.rows ?? 0)) * 100 : 0;

  const prediction = pending?.active_prediction as number | null | undefined;
  const wouldTrade = pending?.active_would_trade === true;
  const dir = wouldTrade ? (prediction === 1 ? "GREEN" : prediction === -1 ? "RED" : "ABSTAIN") : "ABSTAIN";

  const candleMs = pending?.target_ts ? new Date(String(pending.target_ts)).getTime() : NaN;
  const candleLabel = Number.isFinite(candleMs)
    ? `${new Date(candleMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${new Date(
        candleMs + 15 * 60 * 1000,
      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : null;

  const predTone =
    dir === "GREEN"
      ? "border-bull/50 text-bull bg-bull/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bull)_70%,transparent)]"
      : dir === "RED"
        ? "border-bear/50 text-bear bg-bear/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bear)_70%,transparent)]"
        : "border-lightning/40 text-lightning bg-lightning/10";

  const gaugeR = 34;
  const circumference = 2 * Math.PI * gaugeR;
  const wrPct = Math.max(0, Math.min(100, winRate));

  return (
    <Card className="t45-shell rounded-2xl p-6">
      <span className="t45-orbit-ring" aria-hidden />
      <span className="v6-sheen" aria-hidden />

      <div className="relative flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.28em] text-lightning/80 mb-1">
            Shadow only · T+45s cutoff
          </div>
          <h3 className="t45-title text-4xl font-bold font-heading tracking-tight leading-none">
            T45 Balanced
          </h3>
          <div className="text-[10px] text-muted-foreground mt-1 font-mono">
            1s Spot bars · offsets 0-44 · RobustScaler(10,90) · L-BFGS
          </div>
          <div className="text-[9px] text-muted-foreground/80 mt-0.5 font-mono truncate">
            {String(stats.modelVersion ?? "t45-balanced")} · Q37.5 ≥ {Number(stats.rankThreshold ?? 0.625).toFixed(3)}
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
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-lightning/30 hover:border-lightning/60"
            onClick={onExportFeatures}
            disabled={exporting}
          >
            {exporting ? "…" : "Features"}
          </Button>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-lightning/40 bg-lightning/10 text-[10px] font-bold uppercase tracking-[0.16em] text-lightning">
            <span className="size-1.5 rounded-full bg-lightning t45-live-dot" />
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
              stroke={aboveBreakeven ? "var(--bull)" : "var(--lightning)"}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - wrPct / 100)}
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-lg font-bold tabular-nums leading-none">{winRate.toFixed(1)}%</span>
            <span className="text-[8px] uppercase tracking-[0.14em] text-muted-foreground mt-0.5">win rate</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Raw net · shadow</div>
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

      <div className="relative grid grid-cols-4 gap-2">
        <Stat label="Wins" value={String(live.wins ?? 0)} tone="text-bull" />
        <Stat label="Losses" value={String(live.losses ?? 0)} tone="text-bear" />
        <Stat label="Pushes" value={String(live.pushes ?? 0)} />
        <Stat label="Pending" value={String(live.unresolved ?? 0)} />
      </div>

      <Section title="Live shadow detail">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Trades" value={String(live.trades ?? 0)} />
          <Stat label="Abstains" value={String(live.abstains ?? 0)} />
          <Stat label="Coverage" value={pct(coverage)} />
          <Stat label="Rows" value={String(live.rows ?? 0)} />
          <Stat label="First" value={live.firstTs ? new Date(String(live.firstTs)).toLocaleDateString() : "—"} />
          <Stat label="Last" value={live.lastTs ? new Date(String(live.lastTs)).toLocaleDateString() : "—"} />
        </div>
      </Section>

      <Section title="Research backfill">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Win rate" value={pct(research.winRate)} />
          <Stat label="Trades" value={String(research.trades ?? 0)} />
          <Stat label="Rows" value={String(research.rows ?? 0)} />
          <Stat label="Net" value={signed(Number(research.net ?? 0))} />
        </div>
      </Section>

      <Section title="1s collector">
        <div className="grid grid-cols-3 gap-2">
          <Stat
            label="Status"
            value={String(collector.status ?? "NO_DATA")}
            tone={collector.alive ? "text-bull" : "text-bear"}
          />
          <Stat
            label="Last target"
            value={collector.lastTargetTs ? new Date(String(collector.lastTargetTs)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
          />
          <Stat
            label="Offset"
            value={collector.lastTargetSeconds == null ? "—" : `${collector.lastTargetSeconds}/45`}
          />
        </div>
      </Section>

      {blockers.length > 0 && (
        <div className="relative mt-5 rounded-xl border border-amber/25 bg-amber/5 p-3">
          <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground mb-1">
            Publication blockers
          </div>
          <ul className="space-y-0.5">
            {blockers.map((b) => (
              <li key={b} className="text-[10px] font-mono text-amber">
                • {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="relative mt-6 pt-4 border-t border-lightning/20">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Current prediction</div>
            {candleLabel ? (
              <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums truncate">{candleLabel}</div>
            ) : null}
          </div>
          <span className={`px-4 py-1.5 rounded-lg border text-sm font-bold uppercase tracking-[0.16em] font-mono ${predTone}`}>
            {dir}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground">
          <span>p(green) {pending?.probability_green == null ? "—" : Number(pending.probability_green).toFixed(4)}</span>
          <span>rank {pending?.confidence_rank == null ? "—" : Number(pending.confidence_rank).toFixed(3)}</span>
          <span>sleeve {String(pending?.active_sleeve ?? "—")}</span>
          <span>{String(pending?.decision_invalid_reason ?? "—")}</span>
        </div>
      </div>
    </Card>
  );
}
