import { Card } from "@/components/ui/card";

type Stats = Record<string, any>;

/**
 * Version 1 tile.
 *
 * Deliberate omissions: no bankroll, no stake, no execution toggle, no
 * artifact paths, no feature internals. The status badge is driven by the
 * server's phase, which needs a live heartbeat, a scoring-ready worker, a
 * daily model valid right now, and a fresh genuinely scored record. A fresh
 * daily model alone, or a saved research row, never reads as live.
 */

const PHASES = {
  LIVE_SHADOW: {
    label: "Live shadow",
    dot: "bg-signal-orange v1-live-dot",
    chip: "border-signal-orange/45 text-signal-orange bg-signal-orange/10",
  },
  WAITING_FOR_LIVE_DATA: {
    label: "Waiting for live data",
    dot: "bg-steel",
    chip: "border-steel/40 text-steel bg-steel/10",
  },
  STALE: {
    label: "Paused",
    dot: "bg-signal-orange",
    chip: "border-signal-orange/40 text-signal-orange bg-signal-orange/10",
  },
  RECORDING_ONLY: {
    label: "Warming up",
    dot: "bg-steel",
    chip: "border-steel/40 text-steel bg-steel/10",
  },
  PREPARING: {
    label: "Preparing",
    dot: "bg-muted-foreground",
    chip: "border-border text-muted-foreground bg-muted/30",
  },
} as const;

/** Plain language for every decision the engine and the daily floor can make. */
const DECISIONS: Record<string, { title: string; note: string; tone: string }> = {
  ORDINARY_CALL: {
    title: "Called",
    note: "Confident enough to pick a side.",
    tone: "text-emerald-300",
  },
  HIGH_CONFIDENCE_EXCEPTION: {
    title: "Called — top-confidence exception",
    note: "Among its most confident recent reads, so it was allowed through while the day was being held back.",
    tone: "text-emerald-300",
  },
  DAILY_FLOOR_ABSTAIN: {
    title: "Held by the daily risk rule",
    note: "The rule reserves room for what is still open today. It can allow predictions again after wins, and top-confidence reads can still come through.",
    tone: "text-amber-300",
  },
  BASE_NO_CALL: {
    title: "No prediction",
    note: "Not confident enough on this interval.",
    tone: "text-muted-foreground",
  },
  CONFIDENCE_ABSTAIN: {
    title: "No prediction",
    note: "Not confident enough on this interval.",
    tone: "text-muted-foreground",
  },
  RANK_WARMUP: {
    title: "Warming up",
    note: "Still building enough recent history to judge confidence.",
    tone: "text-sky-300",
  },
  FIT_UNAVAILABLE: {
    title: "No prediction made",
    note: "The daily model for this interval was not in place, so nothing was scored.",
    tone: "text-amber-300",
  },
  INPUT_UNAVAILABLE: {
    title: "No prediction made",
    note: "Market data for this interval was incomplete, so nothing was scored.",
    tone: "text-amber-300",
  },
};

/**
 * The engine's own reason wins when it explains WHY there was no prediction.
 * A `BASE_NO_CALL` caused by missing data or by warm-up must never read as
 * "not confident enough".
 */
function describe(latest: any) {
  const reason = latest?.engine_reason as string | undefined;
  if (reason && DECISIONS[reason] && reason !== "MODEL_CALL" && reason !== "DAILY_RISK_ABSTAIN") {
    if (latest?.status === "DAILY_FLOOR_ABSTAIN" && reason === "CONFIDENCE_ABSTAIN") {
      return DECISIONS.DAILY_FLOOR_ABSTAIN;
    }
    if (["INPUT_UNAVAILABLE", "FIT_UNAVAILABLE", "RANK_WARMUP"].includes(reason)) {
      return DECISIONS[reason];
    }
  }
  return DECISIONS[latest?.status] ?? DECISIONS.BASE_NO_CALL;
}

function ago(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "—";
  const s = Math.max(0, Math.round(Number(seconds)));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 172_800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

function clock(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Boise",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="v1-chip px-3 py-2.5">
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
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value * 100));
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
          stroke={above ? "var(--bull)" : "var(--signal-orange)"}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
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

export function LiteACard({
  stats,
  loading,
  error,
}: {
  stats: Stats;
  loading?: boolean;
  error?: boolean;
}) {
  if (error) {
    return (
      <Card className="v1-shell self-start rounded-2xl p-6">
        <span className="v1-orbit-ring" aria-hidden />
        <h3 className="v1-title relative text-4xl font-heading font-bold tracking-tight">Version 1</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Couldn't load this model's status just now. It will retry on its own.
        </p>
      </Card>
    );
  }

  if (loading && !stats?.phase) {
    return (
      <Card className="v1-shell self-start rounded-2xl p-6 space-y-4">
        <span className="v1-orbit-ring" aria-hidden />
        <div className="h-7 w-40 rounded bg-muted/50 animate-pulse" />
        <div className="h-4 w-56 rounded bg-muted/40 animate-pulse" />
        <div className="grid grid-cols-2 gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      </Card>
    );
  }

  const phase = PHASES[(stats?.phase as keyof typeof PHASES) ?? "PREPARING"] ?? PHASES.PREPARING;
  const latest = stats?.latest ?? null;
  const live = stats?.live ?? {};
  const today = stats?.today ?? {};
  const daily: any[] = Array.isArray(stats?.daily) ? stats.daily : [];
  const liveOpportunities = Number(live.opportunities ?? 0);
  const graded = Number(live.wins ?? 0) + Number(live.losses ?? 0);
  const winRate = live.win_rate == null ? null : Number(live.win_rate);
  const dailyWinRate = today.win_rate == null ? null : Number(today.win_rate);
  const netWins = Number(live.wins ?? 0) - Number(live.losses ?? 0);
  const todayNet = Number(today.wins ?? 0) - Number(today.losses ?? 0);
  const coverage = live.coverage == null ? null : Number(live.coverage);
  // Raw net wins: wins minus losses → break-even at 50%.
  const BREAK_EVEN = 0.5;
  const aboveBreakeven = winRate != null && winRate >= BREAK_EVEN;
  const decision = latest ? describe(latest) : null;
  const sideLabel = latest?.final_side === 1 ? "UP" : latest?.final_side === -1 ? "DOWN" : null;

  return (
    <Card className="v1-shell self-start rounded-2xl p-5 sm:p-6 space-y-5">
      <span className="v1-orbit-ring" aria-hidden />

      <header className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.28em] text-signal-orange/85">
            Shadow model · betting disabled
          </div>
          <h3 className="v1-title text-4xl font-heading font-bold tracking-tight leading-none">
            Version 1
          </h3>
          <div className="mt-1 text-[10px] font-mono text-muted-foreground">
            BTC 15-minute · first 5s after open · daily fit
          </div>
          <div className="mt-0.5 max-w-[220px] truncate text-[9px] font-mono text-muted-foreground/80 sm:max-w-none">
            lite-a-floor4-top10-r1
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={`inline-flex max-w-[138px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-right text-[10px] font-bold uppercase leading-tight tracking-[0.12em] ${phase.chip}`}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${phase.dot}`} />
            {phase.label}
          </span>
          <span className="rounded-full border border-steel/25 bg-steel/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-steel/80">
            Betting off
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
              coverage != null && coverage > 0
                ? "border-signal-orange/30 bg-signal-orange/10 text-signal-orange/90"
                : "border-steel/25 bg-steel/5 text-steel/80"
            }`}
          >
            Coverage {coverage == null ? "—" : `${(coverage * 100).toFixed(0)}%`}
          </span>
        </div>
      </header>

      <p className="text-[13px] leading-relaxed text-muted-foreground">{stats?.phase_detail}</p>

      <section className="relative flex flex-wrap items-center gap-4 sm:gap-5">
        <div className="flex items-center gap-3 sm:gap-4">
          <Gauge value={winRate} label="win rate" sublabel="total" />
          <Gauge value={dailyWinRate} label="win rate" sublabel="today" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Net wins · shadow
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
        <Field label="Wins" value={String(live.wins ?? 0)} />
        <Field label="Losses" value={String(live.losses ?? 0)} />
        <Field label="Pending" value={String(live.pending ?? 0)} />
        <Field label="Today calls" value={String(today.calls ?? 0)} />
        <Field
          label="Today win rate"
          value={today.win_rate == null ? "—" : `${(Number(today.win_rate) * 100).toFixed(0)}%`}
        />
        <Field
          label="Today net"
          value={`${todayNet > 0 ? "+" : ""}${todayNet}`}
        />
      </div>

      <section className="v1-chip relative p-4">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Latest 15-minute interval
        </div>
        {latest ? (
          <>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className={`text-lg font-semibold ${decision?.tone ?? ""}`}>
                {decision?.title}
              </span>
              {sideLabel ? (
                <span className="rounded-md border border-border/70 px-1.5 py-0.5 text-xs font-semibold tracking-wide">
                  {sideLabel}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{decision?.note}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
              <span>{clock(latest.target_open_utc)}</span>
              <span className="opacity-40">·</span>
              <span>{ago(latest.age_s)}</span>
              {!stats?.latest_is_live ? (
                <>
                  <span className="opacity-40">·</span>
                  <span className="rounded border border-border/70 px-1.5 py-0.5 uppercase tracking-[0.1em]">
                    Rebuilt afterwards, not live
                  </span>
                </>
              ) : null}
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
          label="Connection"
          value={stats?.connected ? "Connected" : "Not connected"}
          hint={stats?.connected ? `heartbeat ${ago(stats?.heartbeat_age_s)}` : "no heartbeat yet"}
        />
        <Field
          label="Daily model"
          value={stats?.head_cutoff_utc ? String(stats.head_cutoff_utc).slice(0, 10) : "—"}
          hint={
            stats?.head_cutoff_utc
              ? stats?.head_current
                ? "current"
                : "not current"
              : "not reported yet"
          }
        />
      </div>

      <section>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Live shadow results
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-signal-orange/40 via-steel/20 to-transparent" />
        </div>
        {liveOpportunities === 0 ? (
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            No live results yet. Results start counting from the first prediction it makes while
            running — nothing from testing is carried over.
          </p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Field label="Intervals seen" value={String(liveOpportunities)}
                hint={`${live.scored ?? 0} scored`} />
              <Field
                label="Calls"
                value={String(live.calls ?? 0)}
                hint={`${live.ordinary_calls ?? 0} ordinary · ${live.exception_calls ?? 0} exception`}
              />
              <Field
                label="Passed"
                value={String((live.confidence_abstains ?? 0) + (live.floor_holds ?? 0))}
                hint={`${live.floor_holds ?? 0} held by the daily risk rule`}
              />
              <Field
                label="Settled"
                value={
                  graded === 0
                    ? "—"
                    : `${live.wins ?? 0}–${live.losses ?? 0}${
                        live.win_rate == null ? "" : ` · ${(live.win_rate * 100).toFixed(0)}%`
                      }`
                }
                hint={graded === 0 ? "awaiting results" : `${live.pending ?? 0} awaiting result`}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Counted only from intervals predicted live. Passes never count as wins.
            </p>
          </>
        )}
      </section>

      {daily.length > 0 ? (
        <section>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Daily net · last {daily.length} {daily.length === 1 ? "day" : "days"}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-signal-orange/40 via-steel/20 to-transparent" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {daily.map((d) => {
              const dNet = Number(d.wins ?? 0) - Number(d.losses ?? 0);
              return (
                <span
                  key={String(d.date)}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[9px] tabular-nums ${
                    dNet >= 0 ? "border-bull/30 text-bull" : "border-bear/30 text-bear"
                  }`}
                >
                  {String(d.date).slice(5)} {dNet > 0 ? "+" : ""}
                  {dNet}
                  {d.win_rate == null ? "" : ` · ${(Number(d.win_rate) * 100).toFixed(0)}%`}
                </span>
              );
            })}
          </div>
        </section>
      ) : null}

      {Number(stats?.research_rows ?? 0) > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {Number(stats.research_rows) === 1
            ? "1 earlier interval was rebuilt after the fact during testing and is kept out of the results above."
            : `${stats.research_rows} earlier intervals were rebuilt after the fact during testing and are kept out of the results above.`}
        </p>
      ) : null}
    </Card>
  );
}
