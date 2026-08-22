import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Any = Record<string, any>;

const pct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${Number(v).toFixed(d)}%`;
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
        <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
          {title}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-primary/40 to-transparent" />
      </div>
      {children}
    </div>
  );
}

/**
 * T30 PriceFlow Balanced R1 — shadow tile.
 *
 * Fully separate identity, storage, fit and statistics from T45. Shadow only:
 * this model never emits an outbound webhook.
 */
export function T30Card({
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
  const graded = wins + losses;
  const wr = stats.win_rate == null ? null : Number(stats.win_rate);
  const today: Any = stats.today ?? {};
  const shadows: Any[] = stats.shadows ?? [];

  const gaugeR = 34;
  const circumference = 2 * Math.PI * gaugeR;
  const gaugePct = Math.max(0, Math.min(100, wr ?? 0));
  const above = (wr ?? 0) >= 50;

  const wouldTrade = pending?.model_would_trade === true;
  const dir = Number(pending?.model_direction ?? 0);
  const dirLabel = wouldTrade ? (dir > 0 ? "GREEN" : "RED") : "NO TRADE";
  const dirTone = !wouldTrade
    ? "border-primary/40 text-primary bg-primary/10"
    : dir > 0
      ? "border-bull/50 text-bull bg-bull/10"
      : "border-bear/50 text-bear bg-bear/10";

  const targetMs = pending?.target_ts ? new Date(String(pending.target_ts)).getTime() : NaN;
  const candleLabel = Number.isFinite(targetMs)
    ? `${new Date(targetMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${new Date(
        targetMs + 15 * 60_000,
      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "—";

  return (
    <Card className="relative overflow-hidden p-5 space-y-5 border-primary/25">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight">T30 PriceFlow Balanced</h3>
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-primary">
              Shadow only
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 font-mono">
            {stats.model_version ?? "t30-price-flow-balanced-r1"} · T+30s · 28 features · dual
            rank 0.625 / 0.50
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onExport} disabled={exporting}>
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      <div className="grid gap-5 sm:grid-cols-[auto_1fr] items-center">
        <div className="relative h-[92px] w-[92px]">
          <svg viewBox="0 0 92 92" className="h-full w-full -rotate-90">
            <circle cx="46" cy="46" r={gaugeR} fill="none" strokeWidth="8" className="stroke-muted" />
            <circle
              cx="46"
              cy="46"
              r={gaugeR}
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              className={above ? "stroke-bull" : "stroke-bear"}
              strokeDasharray={`${(gaugePct / 100) * circumference} ${circumference}`}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="text-lg font-mono font-bold tabular-nums">{pct(wr)}</div>
              <div className="text-[8px] uppercase tracking-[0.16em] text-muted-foreground">
                Win rate
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Traded" value={String(graded)} />
          <Stat label="Wins" value={String(wins)} tone="text-bull" />
          <Stat label="Losses" value={String(losses)} tone="text-bear" />
          <Stat label="Net" value={signed(stats.net_units)} />
          <Stat label="Abstains" value={String(stats.abstains ?? 0)} />
          <Stat label="Pushes" value={String(stats.pushes ?? 0)} />
          <Stat label="Pending" value={String(stats.pending ?? 0)} />
          <Stat label="Packet ready" value={pct(stats.packet_ready_rate, 0)} />
        </div>
      </div>

      <Section title="Pending candle">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${dirTone}`}
          >
            {dirLabel}
          </span>
          <span className="text-xs font-mono text-muted-foreground">{candleLabel}</span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {pending?.decision_reason ?? "—"}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <Stat
            label="P(green)"
            value={
              pending?.probability_green == null
                ? "—"
                : Number(pending.probability_green).toFixed(4)
            }
          />
          <Stat
            label="Long rank"
            value={pending?.long_rank == null ? "—" : Number(pending.long_rank).toFixed(3)}
          />
          <Stat
            label="Fast rank"
            value={pending?.fast_rank == null ? "—" : Number(pending.fast_rank).toFixed(3)}
          />
          <Stat
            label="Latency"
            value={
              pending?.decision_latency_ms == null
                ? "—"
                : `${Number(pending.decision_latency_ms)} ms`
            }
          />
        </div>
      </Section>

      <Section title={`Today · ${today.date ?? "—"}`}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Traded" value={String(today.traded ?? 0)} />
          <Stat label="Wins" value={String(today.wins ?? 0)} tone="text-bull" />
          <Stat label="Losses" value={String(today.losses ?? 0)} tone="text-bear" />
          <Stat label="Win rate" value={pct(today.win_rate)} />
        </div>
      </Section>

      {shadows.length > 0 && (
        <Section title="Reporting-only shadow policies">
          <div className="grid gap-1.5">
            {shadows.map((s) => (
              <div
                key={s.policy}
                className="flex items-center justify-between rounded-md border border-border/60 px-3 py-1.5"
              >
                <span className="text-[11px] font-mono text-muted-foreground">{s.policy}</span>
                <span className="text-[11px] font-mono tabular-nums">
                  {s.wins}W / {s.losses}L · {pct(s.win_rate)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <p className="text-[10px] text-muted-foreground font-mono">
        config {String(stats.config_hash ?? "").slice(0, 12)} · features{" "}
        {String(stats.feature_order_hash ?? "").slice(0, 12)} · webhooks{" "}
        {stats.webhooks_enabled ? "ON" : "OFF"}
      </p>
    </Card>
  );
}
