// V1.2 prediction delivery and original V1.1 baseline history.
//
// Same stats presentation as the Version 1 tile, on V1's palette reversed
// (orange body, steel accent) and more vibrant.

type Stats = Record<string, any>;

interface V11Props {
  stats: Stats;
  /**
   * Current 15-minute interval state from the V1.2 event journal. It is the
   * authority for what is happening right now on all three legs; the `stats`
   * payload stays the authority for settled history.
   */
  live?: Stats | null;
  loading?: boolean;
  error?: boolean;
}

const LEG_LABEL: Record<string, string> = { V1: "V1", T45R2: "T45 R2", U: "U" };

/** Delivery state only. A receiver acknowledgement is not a filled bet. */
const DELIVERY_LABEL: Record<string, string> = {
  WAITING: "no call yet",
  DISPATCHED: "sent · awaiting receipt",
  ACKNOWLEDGED: "received by betting account",
  UNCONFIRMED: "receipt unconfirmed",
};

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;


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

function LegRecord({ title, r, hint, dot }: { title: string; r: any; hint?: string; dot?: boolean | null }) {
  const rec = r ?? { calls: 0, wins: 0, losses: 0, pending: 0, winRate: null, netWins: 0 };
  return (
    <div className="v11-chip px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {dot != null ? (
          <span
            className={`size-1.5 shrink-0 rounded-full ${dot ? "bg-bull" : "bg-muted-foreground/50"}`}
            title={dot ? "Authentication verified" : "Awaiting authentication check"}
          />
        ) : null}
        <span className="truncate">{title}</span>
        {hint ? <span className="normal-case tracking-normal text-muted-foreground/60">{hint}</span> : null}
      </div>
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

export function V11Card({ stats, live: now12, loading, error }: V11Props) {
  // History can fail on its own without hiding the live call state, and vice
  // versa: the title and the current interval must stay on screen.
  if (error && !now12) {
    return (
      <section className="v11-shell self-start rounded-2xl p-6">
        <span className="v11-orbit-ring" aria-hidden />
        <h3 className="v11-title relative text-4xl font-heading font-bold tracking-tight">
          Version 1.2
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Couldn't load this model's status just now. It will retry on its own.
        </p>
      </section>
    );
  }

  if (loading && !stats?.phase && !now12) {
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

  const predictor=stats?.v12;
  const predictorLabel=predictor?.state==='CONNECTED'?'Prediction feed connected':predictor?.state==='WAITING'?'Waiting for inputs':'No recent worker status';
  const uReasons:Record<string,string>={ELIGIBLE:'Eligible for checkpoint scoring',DAILY_FLOOR_CLOSED:'Daily floor closed',
    V1_SELECTED:'V1 already selected',T45_SELECTED:'T45 R2 already selected',AWAITING_T45_DECISION:'Waiting for T45 decision',
    PRIOR_CLAIM:'Interval already claimed',INVALID_V1_INPUTS:'V1 inputs unavailable',V1_NOT_CONFIDENCE_ABSTENTION:'V1 abstention not eligible'};
  const live = stats?.live ?? {};
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
  const legs: any[] = predictor?.legs ?? [];
  const uLeg = legs.find((l) => l.leg === "U") ?? null;
  const uRecord = uLeg
    ? { calls: uLeg.calls ?? 0, wins: uLeg.wins ?? 0, losses: uLeg.losses ?? 0,
        pending: uLeg.pending ?? 0, winRate: uLeg.winRate ?? null,
        netWins: (uLeg.wins ?? 0) - (uLeg.losses ?? 0) }
    : null;
  // Current-interval authority: the V1.2 event journal, not the V1.1 baseline.
  // When it is unavailable we fall back to the slow baseline snapshot rather
  // than showing nothing.
  const nowLegs: any[] = now12?.legs ?? [];
  const nowCalled = nowLegs.filter((l) => l.status !== "WAITING");
  const nowSide =
    now12?.decision?.side ??
    (nowCalled[0]?.prediction === "YES" ? "UP" : nowCalled[0]?.prediction === "NO" ? "DOWN" : null);
  const intervalTs = now12?.intervalOpen ?? latest?.targetTs ?? null;
  const intervalStale = !!now12 && now12.isCurrentInterval === false;
  const fmtTs = (iso: string | null | undefined) =>
    iso ? new Date(iso).toISOString().slice(5, 16).replace("T", " ") : "—";
  const authFor = (leg: string) => legs.find((l) => l.leg === leg)?.authenticated === true;

  return (
    <section className="v11-shell self-start rounded-2xl p-5 sm:p-6 space-y-5">
      <span className="v11-orbit-ring" aria-hidden />

      <header className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.28em] text-steel-vivid/85">
            Predictions · three webhooks · external betting
          </div>
          <h3 className="v11-title text-4xl font-heading font-bold tracking-tight leading-none">
            Version 1.2
          </h3>
          <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-signal-orange-vivid/40 bg-signal-orange-vivid/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-signal-orange-vivid">
            <span className="size-1.5 rounded-full bg-signal-orange-vivid" />
            {predictorLabel}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
            coverage != null && coverage > 0
              ? "border-steel-vivid/35 bg-steel-vivid/10 text-steel-vivid/90"
              : "border-signal-orange-vivid/25 bg-signal-orange-vivid/5 text-signal-orange-vivid/80"
          }`}
        >
          V1.1 coverage {coverage == null ? "—" : `${(coverage * 100).toFixed(0)}%`}
        </span>
      </header>

      <section className="relative flex flex-wrap items-center gap-4 sm:gap-5">
        <div className="flex items-center gap-3 sm:gap-4">
          <Gauge value={winRate} label="win rate" sublabel="total" />
          <Gauge value={dailyWinRate} label="win rate" sublabel="today" />
        </div>

        <div className="min-w-0 flex-1">
        <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Net wins · V1.1 live shadow history
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
            wins minus losses · zero net wins at {(BREAK_EVEN * 100).toFixed(0)}%
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
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {intervalStale ? "Last completed 15-minute interval" : "Current 15-minute interval"}
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {fmtTs(intervalTs)} UTC
          </span>
        </div>

        {now12 ? (
          <>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className={`text-lg font-semibold ${nowSide ? "text-emerald-300" : "text-muted-foreground"}`}>
                {nowSide ? "Called" : nowCalled.length > 0 ? "Sent" : "No call yet"}
              </span>
              {nowSide ? (
                <span className="rounded-md border border-border/70 px-1.5 py-0.5 text-xs font-semibold tracking-wide">
                  {nowSide}
                </span>
              ) : null}
              {now12?.decision?.leg ? (
                <span className="rounded-md border border-steel-vivid/40 bg-steel-vivid/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-steel-vivid">
                  {LEG_LABEL[now12.decision.leg] ?? now12.decision.leg} leg
                </span>
              ) : null}
              {now12?.decision?.reason ? (
                <span className="text-[11px] text-muted-foreground">{now12.decision.reason}</span>
              ) : null}
            </div>

            <div className="mt-2.5 space-y-1">
              {nowLegs.map((l) => (
                <div
                  key={l.leg}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground tabular-nums"
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${authFor(l.leg) ? "bg-bull" : "bg-muted-foreground/50"}`}
                    title={authFor(l.leg) ? "Authentication verified" : "Awaiting authentication check"}
                  />
                  <span className="w-12 shrink-0 font-semibold uppercase tracking-wide text-foreground/80">
                    {LEG_LABEL[l.leg] ?? l.leg}
                  </span>
                  <span className="font-mono">/{l.endpoint}</span>
                  <span className="opacity-40">·</span>
                  <span className={l.status === "ACKNOWLEDGED" ? "text-bull" : undefined}>
                    {DELIVERY_LABEL[l.status] ?? l.status.toLowerCase()}
                  </span>
                  {l.prediction ? (
                    <>
                      <span className="opacity-40">·</span>
                      <span>{l.prediction === "YES" ? "UP" : "DOWN"}</span>
                    </>
                  ) : null}
                  {l.receiverStatus ? (
                    <>
                      <span className="opacity-40">·</span>
                      <span>receiver {l.receiverStatus}</span>
                    </>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="mt-2 text-[9px] text-muted-foreground/80">
              Delivery only — the bet is placed on the external betting account, so a
              received webhook is not a confirmed fill.
            </div>
          </>
        ) : latest ? (
          <div className="mt-1.5 text-sm text-muted-foreground">
            {sideLabel ? `Called ${sideLabel}` : "No prediction"} · {latest.reason ?? "—"}
          </div>
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
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <LegRecord title="Combined" r={live?.combined} />
          <LegRecord title="V1 leg" r={live?.v1Leg} />
          <LegRecord title="T45 R2 fallback" r={live?.fallbackLeg} />
          <LegRecord title="U leg" hint="V1.2" r={uRecord} dot={uLeg ? uLeg.authenticated === true : null} />
        </div>
        <div className="mt-2 text-[9px] text-muted-foreground/80">
          V1 and T45 R2 are the V1.1 baseline; the U leg counts V1.2 signals only.
          {" "}U status: {predictor?.fitValid===false?'fit expired — U paused':uReasons[predictor?.uBlockReason]?.toLowerCase()??'waiting for current status'}
          {" · "}refresh: {predictor?.refreshStatus?.replaceAll('_',' ').toLowerCase()??'not reported'}
          {predictor?.truncated?' · showing the latest 1,000 signals':''}
        </div>
      </section>

    </section>
  );
}
