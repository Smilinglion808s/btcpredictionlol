// Version 1.1 tile — combined V1 + improved T45 R2 fallback.
//
// Live and research evidence are shown in separate blocks and never summed.
// The delivery status shown here is read from the real server controls and the
// real destination count; it describes this project's CONFIGURATION only, not
// whether the external betting bot acted on anything.


interface LegRecord {
  calls: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number | null;
  netWins: number;
}

interface V11Props {
  stats: any;
  loading?: boolean;
  error?: boolean;
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;

function Record({ title, r }: { title: string; r: LegRecord | undefined }) {
  const rec = r ?? {
    calls: 0,
    wins: 0,
    losses: 0,
    pending: 0,
    winRate: null,
    netWins: 0,
  };
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">
          {rec.netWins > 0 ? `+${rec.netWins}` : rec.netWins}
        </span>
        <span className="text-xs text-muted-foreground">net</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground tabular-nums">
        {pct(rec.winRate)} · {rec.wins}W/{rec.losses}L · {rec.pending} pending ·{" "}
        {rec.calls} calls
      </div>
    </div>
  );
}

export function V11Card({ stats, loading, error }: V11Props) {
  const live = stats?.live;
  const research = stats?.research;
  const latest = stats?.latest;
  const phase: string = stats?.phase ?? "PREPARING";
  const control = stats?.control;
  const delivery = DELIVERY_STATUS[control?.status as string] ?? {
    badge: "Delivery: unknown",
    detail: "Delivery configuration could not be read.",
  };

  return (
    <section className="litea-tile rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <header className="litea-tile__header flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Version 1.1</h2>
          <p className="text-xs opacity-80">V1 + improved T45 R2 fallback</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="litea-badge">{phase.replace(/_/g, " ")}</span>
          <span className="litea-badge">{delivery.badge}</span>
        </div>
      </header>


      <div className="p-4 space-y-4">
        {error ? (
          <p className="text-sm text-destructive">Stats are unavailable right now.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Coverage (live)</div>
                <div className="text-lg font-semibold tabular-nums">
                  {pct(live?.coverage)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Scored (live)</div>
                <div className="text-lg font-semibold tabular-nums">
                  {live?.scored ?? 0}/{live?.opportunities ?? 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Daily model</div>
                <div className="text-lg font-semibold tabular-nums">
                  {stats?.headDate ?? "—"}
                  {stats?.headQuarantined ? " (held)" : ""}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Latest</div>
                <div className="text-lg font-semibold tabular-nums">
                  {latest?.side === 1 ? "UP" : latest?.side === -1 ? "DOWN" : "No call"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {latest?.leg ? `${latest.leg} leg` : (latest?.reason ?? "—")}
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Live shadow (forward, official settlement only)
              </h3>
              <div className="grid gap-2 sm:grid-cols-3">
                <Record title="Combined" r={live?.combined} />
                <Record title="V1 leg" r={live?.v1Leg} />
                <Record title="T45 R2 fallback" r={live?.fallbackLeg} />
              </div>
              <div className="mt-2">
                <Record title="Today (live)" r={live?.today} />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Research / recovery — not live evidence
              </h3>
              <div className="grid gap-2 sm:grid-cols-3">
                <Record title="Combined" r={research?.combined} />
                <Record title="V1 leg" r={research?.v1Leg} />
                <Record title="T45 R2 fallback" r={research?.fallbackLeg} />
              </div>
            </div>

            {Array.isArray(stats?.history) && stats.history.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent intervals
                </h3>
                <div className="max-h-56 overflow-y-auto rounded-md border border-border/60">
                  <table className="w-full text-[11px] tabular-nums">
                    <tbody>
                      {stats.history.map((h: any) => (
                        <tr key={h.targetTs} className="border-b border-border/40 last:border-0">
                          <td className="px-2 py-1 text-muted-foreground">
                            {new Date(h.targetTs).toISOString().slice(5, 16).replace("T", " ")}
                          </td>
                          <td className="px-2 py-1">{h.leg ?? "—"}</td>
                          <td className="px-2 py-1">
                            {h.side === 1 ? "UP" : h.side === -1 ? "DOWN" : "—"}
                          </td>
                          <td className="px-2 py-1 text-right font-semibold">
                            {h.outcome === "WIN"
                              ? "Win"
                              : h.outcome === "LOSS"
                                ? "Loss"
                                : h.outcome === "PENDING"
                                  ? "Pending"
                                  : "No call"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Strategy metadata records a stake of{" "}
              {((stats?.stakeFractionOfBoiseOpen ?? 0.04) * 100).toFixed(0)}% of the
              Boise-day opening principal per leg. Sizing and order placement stay with
              the external betting bot; this model sends nothing.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
