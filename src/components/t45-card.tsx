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

function pct(v: number | null | undefined) {
  return v == null ? "—" : `${Number(v).toFixed(2)}%`;
}

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${n}`;
}

/**
 * T45 Balanced — shadow-only dashboard card.
 *
 * Live and research performance are kept in separate buckets on purpose: the
 * 25,056 backfilled research rows must never be blended into the live record.
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

  const prediction = pending?.active_prediction as number | null | undefined;
  const wouldTrade = pending?.active_would_trade === true;
  const dir = prediction === 1 ? "GREEN" : prediction === -1 ? "RED" : "NO TRADE";
  const candleMs = pending?.target_ts ? new Date(String(pending.target_ts)).getTime() : NaN;
  const candleLabel = Number.isFinite(candleMs)
    ? `${new Date(candleMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${new Date(
        candleMs + 15 * 60 * 1000,
      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : null;
  const predTone =
    wouldTrade && dir === "GREEN"
      ? "border-bull/50 text-bull bg-bull/10"
      : wouldTrade && dir === "RED"
        ? "border-bear/50 text-bear bg-bear/10"
        : "border-amber/40 text-amber bg-amber/10";

  return (
    <Card className="p-5 space-y-4 overflow-hidden relative">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">T45 Balanced</h3>
          <p className="text-[10px] font-mono text-muted-foreground">
            {String(stats.modelVersion ?? "t45-balanced")} · T+45s cutoff
          </p>
        </div>
        <span className="b4-chip px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-amber">
          {String(stats.mode ?? "SHADOW_ONLY")}
        </span>
      </div>

      <Section title="Pending candle">
        <div className={`rounded-md border px-3 py-3 ${predTone}`}>
          <div className="flex items-center justify-between">
            <span className="text-lg font-mono font-bold">{dir}</span>
            <span className="text-[10px] font-mono opacity-80">{candleLabel ?? "—"}</span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-muted-foreground">
            p(green){" "}
            {pending?.probability_green == null
              ? "—"
              : Number(pending.probability_green).toFixed(4)}{" "}
            · rank{" "}
            {pending?.confidence_rank == null ? "—" : Number(pending.confidence_rank).toFixed(3)} ·{" "}
            {String(pending?.decision_invalid_reason ?? pending?.active_sleeve ?? "—")}
          </div>
        </div>
      </Section>

      <Section title="Live (shadow)">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Win rate" value={pct(live.winRate)} />
          <Stat label="Trades" value={String(live.trades ?? 0)} />
          <Stat label="Net" value={signed(Number(live.net ?? 0))} />
          <Stat label="Wins" value={String(live.wins ?? 0)} tone="text-bull" />
          <Stat label="Losses" value={String(live.losses ?? 0)} tone="text-bear" />
          <Stat label="Abstain" value={String(live.abstains ?? 0)} />
          <Stat label="Pushes" value={String(live.pushes ?? 0)} />
          <Stat label="Pending" value={String(live.unresolved ?? 0)} />
          <Stat label="Rows" value={String(live.rows ?? 0)} />
        </div>
      </Section>

      <Section title="Research backfill">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Win rate" value={pct(research.winRate)} />
          <Stat label="Trades" value={String(research.trades ?? 0)} />
          <Stat label="Rows" value={String(research.rows ?? 0)} />
        </div>
      </Section>

      <Section title="1s collector">
        <div className="grid grid-cols-3 gap-2">
          <Stat
            label="Status"
            value={String(collector.status ?? "NO_DATA")}
            tone={collector.alive ? "text-bull" : "text-bear"}
          />
          <Stat label="Last target" value={String(collector.lastTargetTs ?? "—").slice(11, 16)} />
          <Stat
            label="Seconds"
            value={
              collector.lastTargetSeconds == null ? "—" : `${collector.lastTargetSeconds}/45`
            }
          />
        </div>
      </Section>

      {blockers.length > 0 && (
        <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2">
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

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onExport} disabled={exporting}>
          {exporting ? "Exporting…" : "Decisions CSV"}
        </Button>
        <Button size="sm" variant="outline" onClick={onExportFeatures} disabled={exporting}>
          Features CSV
        </Button>
      </div>
    </Card>
  );
}
