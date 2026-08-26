import { Card } from "@/components/ui/card";

type Any = Record<string, any>;

const pct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${(Number(v) * 100).toFixed(d)}%`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`text-sm font-mono font-semibold tabular-nums mt-0.5 ${tone ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * T10 Bridge R1 — shadow tile.
 *
 * Fully separate identity, storage, fit and statistics from T30/T45. Shadow
 * only: no outbound webhooks until activation is switched on.
 */
export function T10Card({ stats, pending }: { stats: Any; pending: Any | null }) {
  const wins = Number(stats.wins ?? 0);
  const losses = Number(stats.losses ?? 0);
  const graded = wins + losses;
  const today: Any = stats.today ?? {};

  const wouldTrade = pending?.policy_would_trade === true;
  const dir = String(pending?.policy_direction ?? "");
  const dirLabel = wouldTrade ? dir || "TRADE" : "NO TRADE";
  const dirTone = !wouldTrade
    ? "border-border text-muted-foreground bg-muted/30"
    : dir === "GREEN"
      ? "border-bull/50 text-bull bg-bull/10"
      : "border-bear/50 text-bear bg-bear/10";

  const secs = (ms: unknown) =>
    ms == null || !Number.isFinite(Number(ms)) ? "—" : `T+${(Number(ms) / 1000).toFixed(1)}s`;

  const targetMs = pending?.target_ts ? new Date(String(pending.target_ts)).getTime() : NaN;
  const candleLabel = Number.isFinite(targetMs)
    ? `${new Date(targetMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${new Date(
        targetMs + 15 * 60_000,
      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : null;

  return (
    <Card className="rounded-2xl p-6 space-y-5 border-border/70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.28em] text-muted-foreground mb-1">
            {stats.webhooks_enabled ? "Active model · webhook source" : "Shadow model · no webhooks"}
          </div>
          <h3 className="text-3xl font-bold font-heading tracking-tight leading-none">
            T10 Bridge
          </h3>
          <div className="text-[10px] text-muted-foreground mt-1 font-mono">
            T+10s cutoff · {stats.feature_count ?? 94} features · dual rank 0.75 / 0.60
          </div>
          <div className="text-[9px] text-muted-foreground/80 mt-0.5 font-mono truncate">
            {stats.model_version ?? "t10-bridge-r1"}
          </div>
        </div>
        <div className="px-2.5 py-1 rounded-full border border-border text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground shrink-0">
          {stats.mode ?? "SHADOW_ONLY"}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Pending candle {candleLabel ? `· ${candleLabel}` : ""}
          </div>
          <div
            className={`px-2.5 py-1 rounded-full border text-[11px] font-bold tracking-wide ${dirTone}`}
          >
            {dirLabel}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Correctness" value={pct(pending?.correctness_probability)} />
          <Stat label="Long rank" value={pct(pending?.long_rank)} />
          <Stat label="Fast rank" value={pct(pending?.fast_rank)} />
          <Stat label="Decision at" value={secs(pending?.decision_offset_ms)} />
        </div>
        <div className="text-[10px] font-mono text-muted-foreground truncate">
          {pending?.policy_decision_reason ?? "—"}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Win rate" value={pct(stats.win_rate)} />
        <Stat label="Graded" value={String(graded)} />
        <Stat label="Wins" value={String(wins)} tone="text-bull" />
        <Stat label="Losses" value={String(losses)} tone="text-bear" />
        <Stat label="Traded" value={String(stats.traded ?? 0)} />
        <Stat label="Abstains" value={String(stats.abstains ?? 0)} />
        <Stat label="Packet ready" value={pct(stats.packet_ready_rate)} />
        <Stat
          label="Today"
          value={
            today.win_rate == null
              ? `${today.traded ?? 0} trades`
              : `${pct(today.win_rate)} · ${today.traded ?? 0}`
          }
        />
      </div>

      <div className="text-[9px] font-mono text-muted-foreground/70 truncate">
        cfg {String(stats.config_hash ?? "").slice(0, 12)} · feat{" "}
        {String(stats.feature_order_hash ?? "").slice(0, 12)} · last{" "}
        {stats.last_target_ts
          ? new Date(String(stats.last_target_ts)).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—"}
      </div>
    </Card>
  );
}
