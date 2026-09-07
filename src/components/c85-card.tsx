import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Any = Record<string, any>;

const pct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${(Number(v) * 100).toFixed(d)}%`;
const signed = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n) > 0 ? "+" : ""}${Number(n)}`;
const money = (cents: number | null | undefined) =>
  cents == null ? "—" : `${Number(cents) < 0 ? "-" : ""}$${(Math.abs(Number(cents)) / 100).toFixed(2)}`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2">
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
        <span className="h-px flex-1 bg-gradient-to-r from-amber-400/40 to-transparent" />
      </div>
      {children}
    </div>
  );
}

/**
 * C85 MULTI_META tile.
 *
 * Readiness is reported honestly: WARMING / READY / BLOCKED comes straight from
 * the worker heartbeat, and a missing heartbeat reads BLOCKED rather than idle.
 * Coverage uses matched opportunities as the denominator; win rate uses graded
 * calls only. Times are America/Boise with DST.
 */
export function C85Card({
  stats,
  pending,
  onExport,
}: {
  stats: Any;
  pending: Any | null;
  onExport?: () => void;
}) {
  const readiness = String(stats.readiness ?? "BLOCKED");
  const ready = readiness === "READY";
  const warming = readiness === "WARMING";
  const wins = Number(stats.wins ?? 0);
  const losses = Number(stats.losses ?? 0);
  const graded = wins + losses;
  const wr = stats.win_rate == null ? null : Number(stats.win_rate) * 100;
  const net = Number(stats.raw_net ?? 0);
  const today: Any = stats.today ?? {};
  const daily: Any[] = stats.daily ?? [];
  const bankroll: Any = stats.bankroll ?? {};

  const gaugeR = 34;
  const circumference = 2 * Math.PI * gaugeR;
  const gaugePct = Math.max(0, Math.min(100, wr ?? 0));
  const above = (wr ?? 0) >= 50;

  const side = Number(pending?.final_side ?? 0);
  const dirLabel = side === 1 ? "YES" : side === -1 ? "NO" : "ABSTAIN";
  const dirTone =
    side === 1
      ? "border-bull/50 text-bull bg-bull/10"
      : side === -1
        ? "border-bear/50 text-bear bg-bear/10"
        : "border-amber-400/40 text-amber-400 bg-amber-400/10";

  const readinessTone = ready
    ? "border-bull/50 text-bull bg-bull/10"
    : warming
      ? "border-amber-400/50 text-amber-400 bg-amber-400/10"
      : "border-bear/50 text-bear bg-bear/10";

  const secs = (ms: unknown) =>
    ms == null || !Number.isFinite(Number(ms)) ? "—" : `T+${(Number(ms) / 1000).toFixed(2)}s`;

  const boise = (iso: unknown) =>
    !iso
      ? "—"
      : new Date(String(iso)).toLocaleTimeString("en-US", {
          timeZone: "America/Boise",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });

  const progress: Any = stats.progress ?? {};
  const total = Number(progress.targets_total ?? 0);
  const done = Number(progress.targets_done ?? 0);

  return (
    <Card className="rounded-2xl p-6 space-y-5 border-amber-400/25 bg-gradient-to-b from-amber-400/[0.04] to-transparent">
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.28em] text-amber-400/80 mb-1">
            {Number(stats.signals_sent ?? 0) > 0
              ? "Live model · webhook source"
              : "Shadow model · no webhooks"}
          </div>
          <h3 className="text-4xl font-bold font-heading tracking-tight leading-none text-amber-300">
            C85
          </h3>
          <div className="text-[10px] text-muted-foreground mt-1 font-mono">
            MULTI_META · direction 60 + correctness 55 · publish by T+5s
          </div>
          <div className="text-[9px] text-muted-foreground/80 mt-0.5 font-mono truncate">
            {stats.model_version ?? "c85-multi-meta-r1"}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onExport ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-amber-400/30 hover:border-amber-400/60"
              onClick={onExport}
            >
              CSV
            </Button>
          ) : null}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-[0.16em] ${readinessTone}`}
          >
            <span className="size-1.5 rounded-full bg-current" />
            {readiness}
          </div>
        </div>
      </div>

      {!ready && (
        <div className="rounded-lg border border-bear/30 bg-bear/5 px-3 py-2">
          <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            {warming ? "Warming" : "Blocked"}
          </div>
          <div className="text-xs font-mono mt-0.5 break-words">
            {String(stats.blocking_reason ?? "unknown")}
          </div>
          {total > 0 && (
            <div className="mt-2">
              <div className="h-1 rounded bg-border overflow-hidden">
                <div
                  className="h-full bg-amber-400 transition-all"
                  style={{ width: `${Math.min(100, (done / total) * 100)}%` }}
                />
              </div>
              <div className="text-[9px] font-mono text-muted-foreground mt-1 tabular-nums">
                bridged {done} / {total} targets · stage {String(stats.stage ?? "—")}
              </div>
            </div>
          )}
        </div>
      )}

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
            Raw net · {graded} graded calls
          </div>
          <div
            className={`font-mono text-5xl font-bold tracking-tighter tabular-nums leading-none mt-1 ${
              net > 0 ? "text-bull" : net < 0 ? "text-bear" : "text-foreground"
            }`}
          >
            {signed(net)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5 tabular-nums">
            coverage {pct(stats.coverage, 1)} of {Number(stats.opportunities ?? 0)} opportunities
          </div>
        </div>

        <div className="shrink-0 rounded-lg border border-border/60 bg-card/40 px-4 py-3 text-right">
          <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Today net
          </div>
          <div
            className={`font-mono text-3xl font-bold tabular-nums leading-none mt-1 ${
              Number(today.net ?? 0) > 0
                ? "text-bull"
                : Number(today.net ?? 0) < 0
                  ? "text-bear"
                  : "text-foreground"
            }`}
          >
            {signed(today.net ?? 0)}
          </div>
          <div className="text-[9px] font-mono text-muted-foreground mt-1 tabular-nums">
            {today.wins ?? 0}W / {today.losses ?? 0}L · {today.calls ?? 0} calls
          </div>
        </div>
      </div>

      <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Wins" value={String(wins)} tone="text-bull" />
        <Stat label="Losses" value={String(losses)} tone="text-bear" />
        <Stat label="Abstentions" value={String(stats.abstains ?? 0)} />
        <Stat label="Calls" value={String(stats.calls ?? 0)} />
        <Stat label="Opportunities" value={String(stats.opportunities ?? 0)} />
        <Stat label="Pending" value={String(stats.pending ?? 0)} />
        <Stat label="Max drawdown" value={`-${Number(stats.max_drawdown ?? 0)}`} tone="text-bear" />
        <Stat label="Current DD" value={`-${Number(stats.current_drawdown ?? 0)}`} />
      </div>

      <Section title="Latest target">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`px-4 py-1.5 rounded-lg border text-sm font-bold uppercase tracking-[0.16em] font-mono ${dirTone}`}
          >
            {dirLabel}
          </span>
          <span className="text-[10px] font-mono text-amber-300 tabular-nums">
            {boise(pending?.target_open_utc)} MT
          </span>
          <span className="text-[10px] font-mono text-muted-foreground truncate">
            {String(pending?.ticker ?? "—")}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <Stat label="P(yes)" value={pct(pending?.probability_yes)} />
          <Stat label="P(correct)" value={pct(pending?.probability_correct)} />
          <Stat label="Admission rank" value={pct(pending?.admission_rank)} />
          <Stat label="Filter rank" value={pct(pending?.filter_rank)} />
        </div>
        {Array.isArray(pending?.gate_reasons) && pending.gate_reasons.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {pending.gate_reasons.map((reason: string) => (
              <span
                key={reason}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground"
              >
                {reason}
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section title="Publication timing (T+5s ceiling)">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Last publish" value={secs(stats.last_publication_offset_ms)} />
          <Stat label="Average" value={secs(stats.avg_publication_offset_ms)} />
          <Stat
            label="Worst"
            value={secs(stats.worst_publication_offset_ms)}
            tone={
              Number(stats.worst_publication_offset_ms ?? 0) > 5000 ? "text-bear" : "text-bull"
            }
          />
          <Stat label="Deadline met" value={pct(stats.deadline_met_rate, 1)} />
        </div>
      </Section>

      <Section title="Dispatch & worker">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Signals sent" value={String(stats.signals_sent ?? 0)} />
          <Stat label="Suppressed" value={String(stats.signals_suppressed ?? 0)} />
          <Stat label="Expired" value={String(stats.signals_expired ?? 0)} />
          <Stat
            label="Heartbeat"
            value={
              stats.heartbeat_age_s == null ? "none" : `${Number(stats.heartbeat_age_s)}s ago`
            }
            tone={stats.heartbeat_age_s == null ? "text-bear" : undefined}
          />
          <Stat label="Next target" value={boise(stats.next_target_utc)} />
          <Stat label="Last target" value={boise(stats.last_target_utc)} />
          <Stat label="Checkpoint" value={`#${stats.last_checkpoint_seq ?? "—"}`} />
          <Stat
            label="Checkpoint age"
            value={stats.checkpoint_age_s == null ? "—" : `${Number(stats.checkpoint_age_s)}s`}
          />
        </div>
      </Section>

      <Section title="Bankroll · $500 principal, 4% flat, 1.87 odds, daily reset">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Stake" value={money(bankroll.stake_cents)} />
          <Stat label="Today close" value={money(bankroll.today_close_cents)} />
          <Stat
            label="Today P/L"
            value={money(bankroll.today_pnl_cents)}
            tone={Number(bankroll.today_pnl_cents ?? 0) >= 0 ? "text-bull" : "text-bear"}
          />
          <Stat label="Today WR" value={pct(today.win_rate)} />
        </div>
      </Section>

      {daily.length > 0 && (
        <Section title="Daily · last 14 days (America/Boise)">
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
        live {Number(stats.live_calls ?? 0)} calls / {Number(stats.live_opportunities ?? 0)} live ·
        backfill {Number(stats.backfill_rows ?? 0)} rows · build{" "}
        {String(stats.build_sha ?? "—").slice(0, 12)}
      </p>
    </Card>
  );
}
