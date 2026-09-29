import { Card } from "@/components/ui/card";
import { V2_SLEEVES, deriveSleeveStatus } from "@/lib/v2/contract";

const SLEEVE_LABEL: Record<string, string> = {
  "v2-direction8-r1": "Direction 8s",
  "v2-fade8-r1": "Fade 8s",
  "v2-direction45-r1": "Direction 45s",
};
const sideLabel = (s: number | null) => (s === 1 ? "UP" : s === -1 ? "DOWN" : "—");
const ago = (iso: string | undefined, now: number) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 90 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

type Props = { data: any; error: boolean };

export function V2Card({ data, error }: Props) {
  const now = data?.serverNow ?? Date.now();
  const open = new Date(Math.floor(now / 900_000) * 900_000).toISOString();
  const rt = data?.runtime?.[0];
  const st = rt?.status ?? {};
  const hbAge = rt ? (now - Date.parse(rt.updated_at)) / 1000 : Infinity;
  const connected = hbAge < 90;
  const cps: any[] = data?.checkpoints ?? [];
  const current = cps.filter((c) => new Date(c.candle_open).toISOString() === open);
  const intent = (data?.intents ?? []).find((i: any) => new Date(i.candle_open).toISOString() === open);
  const status = deriveSleeveStatus(current, now - Date.parse(open));
  const ready = st.prediction_ready === true;
  const targetMatch = st.preopen_target ? new Date(st.preopen_target).toISOString() === open : null;
  const yn = (v: unknown, y: string, n: string) => (v == null ? "not reported" : v ? y : n);
  const errors: string[] = Array.isArray(st.errors) ? st.errors.slice(0, 3) : [];

  const badge = error ? "Status unavailable" : connected ? (ready ? "Ready to predict" : "Connected · not ready") : rt ? `Worker silent ${ago(rt.updated_at, now)}` : "Worker not started";

  return (
    <section className="v2-shell self-start rounded-2xl p-5 sm:p-6 space-y-5">
      <span className="v2-orbit-ring" aria-hidden />

      <header className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.28em] text-crimson-foreground/80">
            Recording only · betting off
          </div>
          <h3 className="v2-title text-4xl font-heading font-bold tracking-tight leading-none">Version 2 Final</h3>
          <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-crimson/50 bg-crimson/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-crimson-foreground">
            <span className={`size-1.5 rounded-full ${connected && !error ? (ready ? "bg-crimson-foreground" : "bg-crimson") : "bg-muted-foreground"}`} />
            {badge}
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-crimson-foreground/30 bg-crimson-foreground/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-crimson-foreground/90">
          Execution off
        </span>
      </header>

      <section className="relative flex flex-wrap items-center gap-4 sm:gap-5">
        <div className="flex items-center gap-3 sm:gap-4">
          <Ring value={rec?.total?.winRate ?? null} sub="total" />
          <Ring value={rec?.today?.winRate ?? null} sub="today" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Net wins · today</div>
          <div className={`mt-1 font-mono text-5xl font-bold tracking-tighter tabular-nums leading-none ${dayNet > 0 ? "text-crimson-foreground" : dayNet < 0 ? "text-crimson" : "text-foreground"}`}>
            {dayNet > 0 ? "+" : ""}{dayNet}
          </div>
          <div className="mt-1.5 text-[10px] text-muted-foreground tabular-nums">
            total net {totNet > 0 ? "+" : ""}{totNet} · predictions, not bets
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2.5">
        <Stat k="Coverage" v={rec?.coverage == null ? "—" : `${(rec.coverage * 100).toFixed(0)}%`} />
        <Stat k="Wins / losses" v={`${rec?.total?.wins ?? 0} / ${rec?.total?.losses ?? 0}`} />
        <Stat k="Today calls" v={`${rec?.today?.calls ?? 0}/${rec?.dayIntervals ?? 0}`} />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Stat k="Prediction ready" v={!connected ? "no heartbeat" : yn(st.prediction_ready, "yes", "no")} />
        <Stat k="Price feed" v={st.feed_age_ms != null ? `${yn(st.feed_ready, "fresh", "stale")} · ${(st.feed_age_ms / 1000).toFixed(1)}s` : yn(st.feed_ready, "fresh", "stale")} />
        <Stat k="History" v={yn(st.history_ready, `ready${st.history_bars ? ` · ${st.history_bars} bars` : ""}`, "not ready")} />
        <Stat k="Current interval inputs" v={targetMatch == null ? yn(st.preopen_current, "current", "not current") : targetMatch ? "current" : "stale target"} />
        <Stat k="Model valid until" v={st.model_valid_until ? `${String(st.model_valid_until).slice(0, 10)}${st.refit_required ? " · refit required" : ""}` : "not reported"} />
        <Stat k="Betting" v="off (recording only)" />
      </div>

      <section className="v2-chip relative p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Current 15-minute interval</div>
          <span className="text-[10px] text-muted-foreground tabular-nums">{open.slice(5, 16).replace("T", " ")} UTC</span>
        </div>
        <div className="mt-1.5 text-lg font-semibold">
          {intent ? (
            <span className="text-crimson-foreground">
              Chosen: {SLEEVE_LABEL[intent.sleeve]}{" "}
              <span className="rounded-md border border-crimson/60 bg-crimson/20 px-1.5 py-0.5 text-xs">{sideLabel(intent.side)}</span>{" "}
              <span className="text-xs font-normal text-muted-foreground">(not bet)</span>
            </span>
          ) : (
            <span className="text-muted-foreground">No chosen call yet</span>
          )}
        </div>
        <div className="mt-2.5 space-y-1">
          {V2_SLEEVES.map((s) => {
            const r = current.find((c) => c.sleeve === s);
            const v = status[s];
            return (
              <div key={s} className="flex items-center gap-2 text-[11px] tabular-nums">
                <span className={`size-1.5 shrink-0 rounded-full ${v.tone === "call" ? "bg-crimson-foreground" : v.tone === "bad" ? "bg-crimson" : "bg-muted-foreground/50"}`} />
                <span className="w-24 shrink-0 font-semibold uppercase tracking-wide text-foreground/80">{SLEEVE_LABEL[s]}</span>
                <span className={v.tone === "bad" ? "text-crimson" : v.tone === "call" ? "font-medium text-crimson-foreground" : "text-muted-foreground"}>
                  {v.text}
                  {r?.receipt_latency_ms != null ? ` · ${r.receipt_latency_ms} ms` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {errors.length > 0 && (
        <div className="text-xs text-crimson space-y-0.5">
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Recent log</summary>
        <div className="mt-1 max-h-48 overflow-auto space-y-0.5">
          {cps.slice(0, 20).map((c, i) => (
            <p key={i} className="text-muted-foreground tabular-nums">
              {new Date(c.candle_open).toISOString().slice(11, 16)} {SLEEVE_LABEL[c.sleeve]} ·{" "}
              {c.eligible ? sideLabel(c.side) : "no call"} · {c.receipt_latency_ms ?? "?"} ms
            </p>
          ))}
          {cps.length === 0 && <p className="text-muted-foreground">Nothing recorded yet.</p>}
        </div>
      </details>
      <div className="space-y-1 text-[9px] text-muted-foreground/80">
        <p>Sizing policy (not a live stake): 4% of the day's starting balance, reset daily at Boise midnight, capped at $200. No account balances are read.</p>
        <p>Inputs: Binance spot. Lab grading used Binance index direction, not spot candles or Kalshi results.</p>
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="v2-chip px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k}</div>
      <div className="mt-1 text-sm font-medium tabular-nums truncate">{v}</div>
    </div>
  );
}
