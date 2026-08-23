import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Any = Record<string, any>;

const pct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${Number(v).toFixed(d)}%`;
const signed = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n) > 0 ? "+" : ""}${Number(n)}`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="t30-chip px-3 py-2">
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
        <span className="h-px flex-1 bg-gradient-to-r from-voltgreen/40 to-transparent" />
      </div>
      {children}
    </div>
  );
}

/**
 * T30 PriceFlow Balanced R1 — shadow hero tile (lightning green).
 *
 * Fully separate identity, storage, fit and statistics from T45. Live model:
 * emits outbound webhooks on tradeable decisions.
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
  const net = stats.net_units == null ? null : Number(stats.net_units);
  const today: Any = stats.today ?? {};
  const shadows: Any[] = stats.shadows ?? [];

  const gaugeR = 34;
  const circumference = 2 * Math.PI * gaugeR;
  const gaugePct = Math.max(0, Math.min(100, wr ?? 0));
  const above = (wr ?? 0) >= 50;

  const wouldTrade = pending?.model_would_trade === true;
  const dir = Number(pending?.model_direction ?? 0);
  const dirLabel = wouldTrade ? (dir > 0 ? "GREEN" : dir < 0 ? "RED" : "TRADE") : "NO TRADE";
  const dirTone = !wouldTrade
    ? "border-voltgreen/40 text-voltgreen bg-voltgreen/10"
    : dir > 0
      ? "border-bull/50 text-bull bg-bull/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bull)_70%,transparent)]"
      : "border-bear/50 text-bear bg-bear/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bear)_70%,transparent)]";

  const secs = (ms: unknown) =>
    ms == null || !Number.isFinite(Number(ms)) ? "—" : `T+${(Number(ms) / 1000).toFixed(1)}s`;
  const millis = (ms: unknown) =>
    ms == null || !Number.isFinite(Number(ms)) ? "—" : `${Math.round(Number(ms))} ms`;

  const targetMs = pending?.target_ts ? new Date(String(pending.target_ts)).getTime() : NaN;
  const candleLabel = Number.isFinite(targetMs)
    ? `${new Date(targetMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${new Date(
        targetMs + 15 * 60_000,
      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : null;

  return (
    <Card className="t30-shell rounded-2xl p-6 space-y-5">
      <span className="t30-orbit-ring" aria-hidden />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.28em] text-voltgreen/80 mb-1">
            {stats.webhooks_enabled ? "Active model · webhook source" : "Shadow model · no webhooks"}
          </div>
          <h3 className="t30-title text-4xl font-bold font-heading tracking-tight leading-none">
            T30 PriceFlow
          </h3>
          <div className="text-[10px] text-muted-foreground mt-1 font-mono">
            T+30s cutoff · 28 features · dual rank 0.625 / 0.50
          </div>
          <div className="text-[9px] text-muted-foreground/80 mt-0.5 font-mono truncate">
            {stats.model_version ?? "t30-price-flow-balanced-r1"}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-voltgreen/30 hover:border-voltgreen/60"
            onClick={onExport}
            disabled={exporting}
          >
            {exporting ? "…" : "CSV"}
          </Button>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-voltgreen/40 bg-voltgreen/10 text-[10px] font-bold uppercase tracking-[0.16em] text-voltgreen">
            <span className="size-1.5 rounded-full bg-voltgreen t30-live-dot" />
            {stats.webhooks_enabled ? "Live" : "Shadow"}
          </div>
        </div>
      </div>

      <div className="relative flex items-center gap-5">
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
            <span className="font-mono text-lg font-bold tabular-nums leading-none">{pct(wr)}</span>
            <span className="text-[8px] uppercase tracking-[0.14em] text-muted-foreground mt-0.5">
              win rate
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Net units · {graded} traded
          </div>
          <div
            className={`font-mono text-5xl font-bold tracking-tighter tabular-nums leading-none mt-1 ${
              (net ?? 0) > 0 ? "text-bull" : (net ?? 0) < 0 ? "text-bear" : "text-foreground"
            }`}
          >
            {signed(net)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5 tabular-nums">
            break-even 50.00%
            <span className={`ml-1.5 font-semibold ${above ? "text-bull" : "text-bear"}`}>
              {above ? "▲ above" : "▼ below"}
            </span>
          </div>
        </div>
      </div>

      <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Wins" value={String(wins)} tone="text-bull" />
        <Stat label="Losses" value={String(losses)} tone="text-bear" />
        <Stat label="Abstains" value={String(stats.abstains ?? 0)} />
        <Stat label="Pushes" value={String(stats.pushes ?? 0)} />
        <Stat label="Pending" value={String(stats.pending ?? 0)} />
        <Stat label="Packet ready" value={pct(stats.packet_ready_rate, 0)} />
        <Stat label="Today traded" value={String(today.traded ?? 0)} />
        <Stat label="Today WR" value={pct(today.win_rate)} />
      </div>

      <Section title="Current candle">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`px-4 py-1.5 rounded-lg border text-sm font-bold uppercase tracking-[0.16em] font-mono ${dirTone}`}
          >
            {dirLabel}
          </span>
          {candleLabel ? (
            <span className="text-[10px] font-mono text-voltgreen tabular-nums">
              {candleLabel}
            </span>
          ) : null}
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

      <Section title="Decision & delivery timing (last live candle)">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Predicted at" value={secs(stats.last_decision_offset_ms)} />
          <Stat
            label="Webhook at"
            value={stats.last_webhook_sent ? secs(stats.last_webhook_offset_ms) : "—"}
          />
          <Stat
            label="Send time"
            value={stats.last_webhook_sent ? millis(stats.last_webhook_latency_ms) : "—"}
          />
          <Stat label="Compute" value={millis(stats.last_latency_ms)} />
        </div>
      </Section>

      {shadows.length > 0 && (
        <Section title="Reporting-only shadow policies">
          <div className="grid gap-1.5">
            {shadows.map((s) => (
              <div
                key={s.policy}
                className="t30-chip flex items-center justify-between px-3 py-1.5"
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

      <p className="relative text-[10px] text-muted-foreground/80 font-mono truncate">
        config {String(stats.config_hash ?? "").slice(0, 12)} · features{" "}
        {String(stats.feature_order_hash ?? "").slice(0, 12)} · webhooks{" "}
        {stats.webhooks_enabled ? "ON" : "OFF"}
      </p>
    </Card>
  );
}
