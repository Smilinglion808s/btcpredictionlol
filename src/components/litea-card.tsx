import { Card } from "@/components/ui/card";

type Stats = Record<string, any>;

/**
 * Version 1 tile.
 *
 * Deliberate omissions: no bankroll, no stake, no execution toggle, no
 * artifact paths, no feature internals. The status badge is driven by the
 * server's phase, which needs a live heartbeat AND a recent scheduled close —
 * a fresh daily head or a saved research row never reads as live.
 */

const PHASES = {
  LIVE_SHADOW: {
    label: "Live shadow",
    dot: "bg-emerald-400",
    chip: "border-emerald-400/40 text-emerald-300 bg-emerald-400/10",
  },
  WAITING_FOR_LIVE_DATA: {
    label: "Waiting for live data",
    dot: "bg-sky-400",
    chip: "border-sky-400/40 text-sky-300 bg-sky-400/10",
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
    title: "Held back",
    note: "The day's running result hit the stop-for-the-day rule.",
    tone: "text-amber-300",
  },
  BASE_NO_CALL: {
    title: "No call",
    note: "Not confident enough on this close.",
    tone: "text-muted-foreground",
  },
  CONFIDENCE_ABSTAIN: {
    title: "No call",
    note: "Not confident enough on this close.",
    tone: "text-muted-foreground",
  },
  RANK_WARMUP: {
    title: "Warming up",
    note: "Still building enough recent history to judge confidence.",
    tone: "text-sky-300",
  },
  INPUT_UNAVAILABLE: {
    title: "Skipped",
    note: "Market data for this close was incomplete, so no guess was made.",
    tone: "text-amber-300",
  },
};

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
    <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium tabular-nums truncate">{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{hint}</div> : null}
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
      <Card className="rounded-2xl p-6">
        <h3 className="text-2xl font-heading font-semibold tracking-tight">Version 1</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Couldn't load this model's status just now. It will retry on its own.
        </p>
      </Card>
    );
  }

  if (loading && !stats?.phase) {
    return (
      <Card className="rounded-2xl p-6 space-y-4">
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
  const liveOpportunities = Number(live.opportunities ?? 0);
  const graded = Number(live.wins ?? 0) + Number(live.losses ?? 0);
  const decision = latest ? (DECISIONS[latest.status] ?? DECISIONS.BASE_NO_CALL) : null;
  const sideLabel = latest?.final_side === 1 ? "UP" : latest?.final_side === -1 ? "DOWN" : null;

  return (
    <Card className="rounded-2xl border-border/70 bg-gradient-to-b from-primary/[0.05] to-transparent p-5 sm:p-6 space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-2xl sm:text-3xl font-heading font-semibold tracking-tight leading-none">
            Version 1
          </h3>
          <p className="mt-1.5 text-xs sm:text-[13px] text-muted-foreground">
            BTC 15-minute · shadow only
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${phase.chip}`}
          >
            <span className={`size-1.5 rounded-full ${phase.dot}`} />
            {phase.label}
          </span>
          <span className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Betting off
          </span>
        </div>
      </header>

      <p className="text-[13px] leading-relaxed text-muted-foreground">{stats?.phase_detail}</p>

      <section className="rounded-xl border border-border/60 bg-background/40 p-4">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Latest recorded 15-minute close
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
            Nothing recorded yet — the first close will appear here.
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
          hint={stats?.head_cutoff_utc ? `refreshed ${ago(stats?.head_age_s)}` : "not reported yet"}
        />
      </div>

      <section>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Live shadow results
          </span>
          <span className="h-px flex-1 bg-border/60" />
        </div>
        {liveOpportunities === 0 ? (
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            No live results yet. Results start counting from the first close it records while
            running — nothing from testing is carried over.
          </p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Field label="Closes seen" value={String(liveOpportunities)} />
              <Field
                label="Calls"
                value={String(live.calls ?? 0)}
                hint={`${live.ordinary_calls ?? 0} ordinary · ${live.exception_calls ?? 0} exception`}
              />
              <Field
                label="Passed"
                value={String((live.confidence_abstains ?? 0) + (live.floor_holds ?? 0))}
                hint={`${live.floor_holds ?? 0} held back by the daily rule`}
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
              Counted only from closes recorded live. Passes never count as wins.
            </p>
          </>
        )}
      </section>

      {Number(stats?.research_rows ?? 0) > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {stats.research_rows} earlier{" "}
          {Number(stats.research_rows) === 1 ? "close was" : "closes were"} rebuilt after the fact
          during testing and are kept out of the results above.
        </p>
      ) : null}
    </Card>
  );
}
