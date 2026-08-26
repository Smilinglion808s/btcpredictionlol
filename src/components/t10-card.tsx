import { Card } from "@/components/ui/card";

type Any = Record<string, any>;

const pct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${(Number(v) * 100).toFixed(d)}%`;
const signed = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n) > 0 ? "+" : ""}${Number(n)}`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="t10-chip px-3 py-2">
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
        <span className="h-px flex-1 bg-gradient-to-r from-hotpink/40 to-transparent" />
      </div>
      {children}
    </div>
  );
}

/**
 * T10 Bridge R1 — hero tile (electric pink).
 *
 * Fully separate identity, storage, fit and statistics from T30/T45. Live
 * model: emits outbound webhooks on tradeable decisions once activated.
 */
export function T10Card({
  stats,
  pending,
  onExport,
}: {
  stats: Any;
  pending: Any | null;
  onExport?: () => void;
}) {
  const wins = Number(stats.wins ?? 0);
  const losses = Number(stats.losses ?? 0);
  const graded = wins + losses;
  const wr = stats.win_rate == null ? null : Number(stats.win_rate) * 100;
  const net = wins - losses;
  const today: Any = stats.today ?? {};
  const todayNet = today.net_units == null ? null : Number(today.net_units);
  const daily: Any[] = stats.daily ?? [];

  const gaugeR = 34;
  const circumference = 2 * Math.PI * gaugeR;
  const gaugePct = Math.max(0, Math.min(100, wr ?? 0));
  const above = (wr ?? 0) >= 50;

  const wouldTrade = pending?.policy_would_trade === true;
  const dir = String(pending?.policy_direction ?? "");
  const dirLabel = wouldTrade ? dir || "TRADE" : "NO TRADE";
  const dirTone = !wouldTrade
    ? "border-hotpink/40 text-hotpink bg-hotpink/10"
    : dir === "GREEN"
      ? "border-bull/50 text-bull bg-bull/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bull)_70%,transparent)]"
      : "border-bear/50 text-bear bg-bear/10 shadow-[0_0_26px_-6px_color-mix(in_oklab,var(--bear)_70%,transparent)]";

  const secs = (ms: unknown) =>
    ms == null || !Number.isFinite(Number(ms)) ? "—" : `T+${(Number(ms) / 1000).toFixed(1)}s`;

  const targetMs = pending?.target_ts ? new Date(String(pending.target_ts)).getTime() : NaN;
  const candleLabel = Number.isFinite(targetMs)
    ? `${new Date(targetMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${new Date(
        targetMs + 15 * 60_000,
      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : null;

  return (
    <Card className="t10-shell rounded-2xl p-6 space-y-5">
      <span className="t10-orbit-ring" aria-hidden />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.28em] text-hotpink/80 mb-1">
            {stats.webhooks_enabled ? "Active model · webhook source" : "Shadow model · no webhooks"}
          </div>
          <h3 className="t10-title text-4xl font-bold font-heading tracking-tight leading-none">
            T10 Bridge
          </h3>
          <div className="text-[10px] text-muted-foreground mt-1 font-mono">
            T+10s cutoff · {stats.feature_count ?? 94} features · dual rank 0.75 / 0.60
          </div>
          <div className="text-[9px] text-muted-foreground/80 mt-0.5 font-mono truncate">
            {stats.model_version ?? "t10-bridge-r1"}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onExport ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-hotpink/30 hover:border-hotpink/60"
              onClick={onExport}
            >
              CSV
            </Button>
          ) : null}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-hotpink/40 bg-hotpink/10 text-[10px] font-bold uppercase tracking-[0.16em] text-hotpink">
            <span className="size-1.5 rounded-full bg-hotpink t10-live-dot" />
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
            <span className="font-mono text-lg font-bold tabular-nums leading-none">
              {wr == null ? "—" : `${wr.toFixed(1)}%`}
            </span>
            <span className="text-[8px] uppercase tracking-[0.14em] text-muted-foreground mt-0.5">
              win rate
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Net units · {graded} graded
          </div>
          <div
            className={`font-mono text-5xl font-bold tracking-tighter tabular-nums leading-none mt-1 ${
              net > 0 ? "text-bull" : net < 0 ? "text-bear" : "text-foreground"
            }`}
          >
            {signed(net)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5 tabular-nums">
            break-even 50.0%
            <span className={`ml-1.5 font-semibold ${above ? "text-bull" : "text-bear"}`}>
              {above ? "▲ above" : "▼ below"}
            </span>
          </div>
        </div>

        <div className="t10-chip shrink-0 px-4 py-3 text-right">
          <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Daily net
          </div>
          <div
            className={`font-mono text-3xl font-bold tabular-nums leading-none mt-1 ${
              (todayNet ?? 0) > 0
                ? "text-bull"
                : (todayNet ?? 0) < 0
                  ? "text-bear"
                  : "text-foreground"
            }`}
          >
            {signed(todayNet)}
          </div>
          <div className="text-[9px] font-mono text-muted-foreground mt-1 tabular-nums">
            {today.wins ?? 0}W / {today.losses ?? 0}L · {today.traded ?? 0} traded
          </div>
        </div>
      </div>

      <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Wins" value={String(wins)} tone="text-bull" />
        <Stat label="Losses" value={String(losses)} tone="text-bear" />
        <Stat label="Abstains" value={String(stats.abstains ?? 0)} />
        <Stat label="Pushes" value={String(stats.pushes ?? 0)} />
        <Stat label="Traded" value={String(stats.traded ?? 0)} />
        <Stat label="Pending" value={String(stats.pending ?? 0)} />
        <Stat label="Packet ready" value={pct(stats.packet_ready_rate, 0)} />
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
            <span className="text-[10px] font-mono text-hotpink tabular-nums">{candleLabel}</span>
          ) : null}
          <span className="text-[10px] font-mono text-muted-foreground truncate">
            {pending?.policy_decision_reason ?? "—"}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <Stat label="Correctness" value={pct(pending?.correctness_probability)} />
          <Stat label="Long rank" value={pct(pending?.long_rank)} />
          <Stat label="Fast rank" value={pct(pending?.fast_rank)} />
          <Stat label="Decision at" value={secs(pending?.decision_offset_ms)} />
        </div>
      </Section>

      <Section title="Last live candle">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Predicted at" value={secs(stats.last_decision_offset_ms)} />
          <Stat label="Mode" value={String(stats.mode ?? "SHADOW_ONLY")} />
          <Stat label="Webhooks" value={stats.webhooks_enabled ? "ON" : "OFF"} />
          <Stat
            label="Last target"
            value={
              stats.last_target_ts
                ? new Date(String(stats.last_target_ts)).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"
            }
          />
        </div>
      </Section>

      {daily.length > 0 && (
        <Section title="Daily net · last 14 days">
          <div className="flex flex-wrap gap-1">
            {daily.map((d) => (
              <span
                key={d.date}
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border tabular-nums ${
                  d.net >= 0 ? "border-bull/30 text-bull" : "border-bear/30 text-bear"
                }`}
              >
                {String(d.date).slice(5)} {signed(d.net)} · {pct(d.win_rate, 0)}
              </span>
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
