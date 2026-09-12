// Version 1.1 tile — combined V1 + improved T45 R2 fallback.
//
// Same stats presentation as the Version 1 tile, on V1's palette reversed
// (orange body, steel accent) and more vibrant.

type Stats = Record<string, any>;

interface V11Props {
  stats: Stats;
  loading?: boolean;
  error?: boolean;
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;

const PHASES: Record<string, { label: string; dot: string; chip: string }> = {
  LIVE_SHADOW: {
    label: "Live shadow",
    dot: "bg-steel-vivid v11-live-dot",
    chip: "border-steel-vivid/50 text-steel-vivid bg-steel-vivid/10",
  },
  RECORDING_ONLY: {
    label: "Warming up",
    dot: "bg-signal-orange-vivid",
    chip: "border-signal-orange-vivid/40 text-signal-orange-vivid bg-signal-orange-vivid/10",
  },
  PREPARING: {
    label: "Preparing",
    dot: "bg-muted-foreground",
    chip: "border-border text-muted-foreground bg-muted/30",
  },
};

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="v11-chip px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium tabular-nums truncate">{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{hint}</div> : null}
    </div>
  );
}

function Gauge({
  value,
  label,
  sublabel,
}: {
  value: number | null;
  label: string;
  sublabel?: string;
}) {
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const p = value == null ? 0 : Math.max(0, Math.min(100, value * 100));
  const above = value != null && value >= 0.5;
  return (
    <div className="relative size-[72px] shrink-0">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={above ? "var(--bull)" : "var(--steel-vivid)"}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - p / 100)}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-base font-bold tabular-nums leading-none">
          {value == null ? "—" : `${(value * 100).toFixed(1)}%`}
        </span>
        <span className="mt-0.5 text-[7px] uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        {sublabel ? (
          <span className="text-[6px] uppercase tracking-[0.1em] text-muted-foreground/70">
            {sublabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function LegRecord({ title, r }: { title: string; r: any }) {
  const rec = r ?? { calls: 0, wins: 0, losses: 0, pending: 0, winRate: null, netWins: 0 };
  return (
    <div className="v11-chip px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{title}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          rec.netWins > 0 ? "text-bull" : rec.netWins < 0 ? "text-bear" : ""
        }`}
      >
        {rec.netWins > 0 ? `+${rec.netWins}` : rec.netWins}
        <span className="ml-1 text-[10px] font-normal text-muted-foreground">net</span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
        {pct(rec.winRate)} · {rec.wins}W/{rec.losses}L · {rec.pending} pending · {rec.calls} calls
      </div>
    </div>
  );
}

export function V11Card({ stats, loading, error }: V11Props) {
  if (error) {
    return (
      <section className="v11-shell self-start rounded-2xl p-6">
        <span className="v11-orbit-ring" aria-hidden />
        <h3 className="v11-title relative text-4xl font-heading font-bold tracking-tight">
          Version 1.1
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Couldn't load this model's status just now. It will retry on its own.
        </p>
      </section>
    );
  }

  if (loading && !stats?.phase) {
    return (
      <section className="v11-shell self-start rounded-2xl p-6 space-y-4">
        <span className="v11-orbit-ring" aria-hidden />
        <div className="h-7 w-40 rounded bg-muted/50 animate-pulse" />
        <div className="h-4 w-56 rounded bg-muted/40 animate-pulse" />
        <div className="grid grid-cols-2 gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  const phase = PHASES[stats?.phase as string] ?? PHASES.PREPARING;
  const live = stats?.live ?? {};
  const research = stats?.research;
  const combined = live?.combined ?? {};
  const today = live?.today ?? {};
  const latest = stats?.latest ?? null;
  const coverage = live?.coverage == null ? null : Number(live.coverage);
  const winRate = combined?.winRate == null ? null : Number(combined.winRate);
  const dailyWinRate = today?.winRate == null ? null : Number(today.winRate);
  const netWins = Number(combined?.netWins ?? 0);
  const todayNet = Number(today?.netWins ?? 0);
  // Raw net wins: wins minus losses → break-even at 50%.
  const BREAK_EVEN = 0.5;
  const aboveBreakeven = winRate != null && winRate >= BREAK_EVEN;
  const sideLabel = latest?.side === 1 ? "UP" : latest?.side === -1 ? "DOWN" : null;

  return (
    <section className="v11-shell self-start rounded-2xl p-5 sm:p-6 space-y-5">
      <span className="v11-orbit-ring" aria-hidden />

      <header className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.28em] text-steel-vivid/85">
            Shadow model · combined stream
          </div>
          <h3 className="v11-title text-4xl font-heading font-bold tracking-tight leading-none">
            Version 1.1
          </h3>
          <div className="mt-1 text-[10px] font-mono text-muted-foreground">
            V1 + improved T45 R2 fallback · daily fit
          </div>
          <div className="mt-0.5 max-w-[220px] truncate text-[9px] font-mono text-muted-foreground/80 sm:max-w-none">
            {stats?.modelVersion ?? "v11-original-confidence-rank80-4"}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={`inline-flex max-w-[138px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-right text-[10px] font-bold uppercase leading-tight tracking-[0.12em] ${phase.chip}`}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${phase.dot}`} />
            {phase.label}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
              coverage != null && coverage > 0
                ? "border-steel-vivid/35 bg-steel-vivid/10 text-steel-vivid/90"
                : "border-signal-orange-vivid/25 bg-signal-orange-vivid/5 text-signal-orange-vivid/80"
            }`}
          >
            Coverage {coverage == null ? "—" : `${(coverage * 100).toFixed(0)}%`}
          </span>
        </div>
      </header>

      <section className="relative flex flex-wrap items-center gap-4 sm:gap-5">
        <div className="flex items-center gap-3 sm:gap-4">
          <Gauge value={winRate} label="win rate" sublabel="total" />
          <Gauge value={dailyWinRate} label="win rate" sublabel="today" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Net wins · live shadow
          </div>
          <div
            className={`mt-1 font-mono text-5xl font-bold tracking-tighter tabular-nums leading-none ${
              netWins > 0 ? "text-bull" : netWins < 0 ? "text-bear" : "text-foreground"
            }`}
          >
            {netWins > 0 ? "+" : ""}
            {netWins}
          </div>
          <div className="mt-1.5 text-[10px] text-muted-foreground tabular-nums">
            wins minus losses · break-even {(BREAK_EVEN * 100).toFixed(0)}%
            {winRate != null ? (
              <span className={`ml-1.5 font-semibold ${aboveBreakeven ? "text-bull" : "text-bear"}`}>
                {aboveBreakeven ? "▲ above" : "▼ below"}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2.5">
        <Field label="Wins" value={String(combined?.wins ?? 0)} />
        <Field label="Losses" value={String(combined?.losses ?? 0)} />
        <Field label="Pending" value={String(combined?.pending ?? 0)} />
        <Field label="Today calls" value={String(today?.calls ?? 0)} />
        <Field label="Today win rate" value={dailyWinRate == null ? "—" : `${(dailyWinRate * 100).toFixed(0)}%`} />
        <Field label="Today net" value={`${todayNet > 0 ? "+" : ""}${todayNet}`} />
      </div>

      <section className="v11-chip relative p-4">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Latest 15-minute interval
        </div>
        {latest ? (
          <>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className={`text-lg font-semibold ${sideLabel ? "text-emerald-300" : "text-muted-foreground"}`}>
                {sideLabel ? "Called" : "No prediction"}
              </span>
              {sideLabel ? (
                <span className="rounded-md border border-border/70 px-1.5 py-0.5 text-xs font-semibold tracking-wide">
                  {sideLabel}
                </span>
              ) : null}
              {latest.leg ? (
                <span className="rounded-md border border-steel-vivid/40 bg-steel-vivid/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-steel-vivid">
                  {latest.leg === "T45R2" ? "T45 R2 leg" : `${latest.leg} leg`}
                </span>
              ) : null}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
              <span>
                {latest.targetTs
                  ? new Date(latest.targetTs).toISOString().slice(5, 16).replace("T", " ")
                  : "—"}{" "}
                UTC
              </span>
              <span className="opacity-40">·</span>
              <span>{latest.reason ?? "—"}</span>
            </div>
          </>
        ) : (
          <p className="mt-1.5 text-sm text-muted-foreground">
            Nothing recorded yet — the first prediction will appear here.
          </p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-2.5">
        <Field
          label="Daily model"
          value={stats?.headDate ?? "—"}
          hint={stats?.headQuarantined ? "held" : stats?.headDate ? "current" : "not reported yet"}
        />
        <Field
          label="Scored (live)"
          value={`${live?.scored ?? 0}/${live?.opportunities ?? 0}`}
          hint="intervals scored live"
        />
      </div>

      <section>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Live shadow by leg · official settlement only
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-steel-vivid/40 via-signal-orange-vivid/25 to-transparent" />
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <LegRecord title="Combined" r={live?.combined} />
          <LegRecord title="V1 leg" r={live?.v1Leg} />
          <LegRecord title="T45 R2 fallback" r={live?.fallbackLeg} />
        </div>
      </section>

    </section>
  );
}
