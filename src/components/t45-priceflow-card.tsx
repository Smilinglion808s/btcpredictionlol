import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Any = Record<string, any>;

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${Number(v).toFixed(d)}%`);
const signed = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n) > 0 ? "+" : ""}${Number(n)}`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="t45-chip px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`text-sm font-mono font-semibold mt-0.5 tabular-nums ${tone ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * T45 PriceFlow Q37.5 — live tile.
 *
 * Separate identity, storage and statistics from T45 Balanced. No R2 prior is
 * an input. This is the only model permitted to emit outbound webhooks.
 */

export function T45PriceFlowCard({
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
  const live: Any = stats.live ?? {};
  const backfill: Any = stats.backfill ?? {};
  const combined: Any = stats.combined ?? {};
  const packet: Any = stats.packet ?? {};
  const readiness: Any = stats.readiness ?? {};
  const legacy: Any = stats.legacyCounterfactual ?? {};
  const daily: Any[] = stats.daily ?? [];

  return (
    <Card className="t45-shell p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold bg-gradient-to-r from-lightning to-foreground bg-clip-text text-transparent">
            T45 PriceFlow Q37.5
          </h3>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
            {stats.modelVersion ?? "t45-price-flow-q375-r1"} · no R2 input ·{" "}
            {stats.webhooksEnabled ? "webhooks LIVE" : "webhooks off"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-[0.16em] px-2 py-1 rounded-full border border-lightning/40 text-lightning">
            {stats.activationMode ?? "SHADOW_ONLY"}
          </span>

          <Button size="sm" variant="outline" onClick={onExport} disabled={exporting}>
            {exporting ? "Exporting…" : "CSV"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
        <Stat label="Live rows" value={String(live.scheduled ?? 0)} />
        <Stat label="Backfill rows" value={String(backfill.scheduled ?? 0)} />
        <Stat label="Packet 45/45" value={String(packet.full45 ?? 0)} />
        <Stat label="Capture coverage" value={pct(packet.coverage)} />
        <Stat label="Timing failures" value={String(packet.timingFailures ?? 0)} />
        <Stat label="Packet failures" value={String(packet.packetFailures ?? 0)} />
        <Stat label="Fit ready" value={readiness.fitReady ? "YES" : "NO"} />
        <Stat label="Rank ready" value={readiness.rankReady ? "YES" : "NO"} />
      </div>

      <div className="mt-4 rounded-lg border border-lightning/30 p-3">
        <div className="text-[9px] uppercase tracking-[0.2em] text-lightning mb-2">
          Live tracking (run_mode = LIVE)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="Live trades" value={String(live.trades ?? 0)} />
          <Stat
            label="W / L / P / A"
            value={`${live.wins ?? 0}/${live.losses ?? 0}/${live.pushes ?? 0}/${live.abstains ?? 0}`}
          />
          <Stat label="Live win rate" value={pct(live.winRate, 2)} />
          <Stat
            label="Live net"
            value={signed(live.net)}
            tone={Number(live.net ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}
          />
          <Stat label="Live coverage" value={pct(live.evaluableCoverage)} />
          <Stat label="Unresolved" value={String(live.unresolved ?? 0)} />
          <Stat label="Webhooks sent" value={String(stats.webhookProof?.sentRows ?? 0)} />
          <Stat label="Last live target" value={live.lastTs ? String(live.lastTs).slice(5, 16) : "—"} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        <Stat label="Opportunities" value={String(combined.scheduled ?? 0)} />

        <Stat label="Trades" value={String(combined.trades ?? 0)} />
        <Stat
          label="W / L / P / A"
          value={`${combined.wins ?? 0}/${combined.losses ?? 0}/${combined.pushes ?? 0}/${combined.abstains ?? 0}`}
        />
        <Stat
          label="Raw net"
          value={signed(combined.net)}
          tone={Number(combined.net ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <Stat label="Win rate" value={pct(combined.winRate, 2)} />
        <Stat label="Scheduled coverage" value={pct(combined.scheduledCoverage)} />
        <Stat label="Evaluable coverage" value={pct(combined.evaluableCoverage)} />
        <Stat label="Evaluable rows" value={String(combined.evaluable ?? 0)} />
        <Stat label="Max drawdown" value={String(combined.maxDrawdown ?? 0)} />
        <Stat label="Max loss streak" value={String(combined.maxLossStreak ?? 0)} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        <Stat label="Neg. Boise days" value={String(stats.negativeDays ?? 0)} />
        <Stat
          label="Worst Boise day"
          value={stats.worstDay ? `${stats.worstDay.date} ${signed(stats.worstDay.net)}` : "—"}
        />
        <Stat label="Rolling 7d min" value={signed(stats.rolling7?.min)} />
        <Stat label="Rolling 7d latest" value={signed(stats.rolling7?.latest)} />
      </div>

      <div className="mt-4 rounded-lg border border-lightning/20 p-3">
        <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
          Pending target
        </div>
        {pending ? (
          <div className="font-mono text-xs">
            {String(pending.target_ts)} · {String(pending.decision_reason ?? "—")} ·{" "}
            {pending.probability_green == null
              ? "p —"
              : `p ${Number(pending.probability_green).toFixed(4)}`}{" "}
            · rank{" "}
            {pending.confidence_rank == null
              ? "—"
              : Number(pending.confidence_rank).toFixed(3)}{" "}
            · {pending.active_would_trade ? "WOULD TRADE" : "NO TRADE"} · webhook{" "}
            {pending.webhook_sent ? "SENT" : "NONE"}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No live row yet.</div>
        )}
      </div>

      <div className="mt-3 text-[10px] font-mono text-muted-foreground">
        Legacy R2-dependent T45 — non-certified stored baseline (stored decision stream; its hash
        does not match the original oracle hash, so it is a reference only, not a certified
        comparison): {legacy.trades ?? 0} trades · {pct(legacy.winRate, 2)} · net{" "}
        {signed(legacy.net)} — webhook eligible rows: {stats.webhookProof?.eligibleRows ?? 0}, sent:{" "}
        {stats.webhookProof?.sentRows ?? 0}
      </div>


      {daily.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {daily.map((d) => (
            <span
              key={d.date}
              className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                d.net >= 0 ? "border-emerald-500/30 text-emerald-400" : "border-rose-500/30 text-rose-400"
              }`}
            >
              {d.date.slice(5)} {signed(d.net)}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
