import { Card } from "@/components/ui/card";
import { V2_SLEEVES } from "@/lib/v2/contract";

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
  const errors: string[] = Array.isArray(st.errors) ? st.errors.slice(0, 3) : [];

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Version 2 Final</h3>
          <p className="text-xs text-muted-foreground">Recording only · betting off</p>
        </div>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          <span className={`mr-1 inline-block h-2 w-2 rounded-full ${connected ? "bg-primary" : "bg-destructive"}`} />
          {error ? "Status unavailable" : connected ? "Worker connected" : rt ? `Worker silent ${ago(rt.updated_at, now)}` : "Worker not started"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat k="Price feed" v={st.feed_age_ms != null ? `${Math.round(st.feed_age_ms / 1000)}s old` : "unknown"} />
        <Stat k="Inputs ready" v={st.features_ready == null ? "unknown" : st.features_ready ? "yes" : "no"} />
        <Stat k="Model files" v={st.model_valid == null ? "unknown" : st.model_valid ? "valid" : "missing / invalid"} />
        <Stat k="Betting" v="off" />
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Current 15-minute interval</p>
        {V2_SLEEVES.map((s) => {
          const r = current.find((c) => c.sleeve === s);
          return (
            <div key={s} className="flex justify-between text-sm">
              <span>{SLEEVE_LABEL[s]}</span>
              <span className="text-muted-foreground">
                {!r ? "waiting" : r.eligible ? `call ${sideLabel(r.side)}` : `no call${r.reason ? ` · ${r.reason}` : ""}`}
                {r?.receipt_latency_ms != null ? ` · ${r.receipt_latency_ms} ms` : ""}
              </span>
            </div>
          );
        })}
        <p className="pt-1 text-sm">
          {intent ? `Chosen: ${SLEEVE_LABEL[intent.sleeve]} ${sideLabel(intent.side)} (not bet)` : "No chosen call yet"}
        </p>
      </div>

      {errors.length > 0 && (
        <div className="text-xs text-destructive space-y-0.5">
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Recent log</summary>
        <div className="mt-1 max-h-48 overflow-auto space-y-0.5">
          {cps.slice(0, 20).map((c, i) => (
            <p key={i} className="text-muted-foreground">
              {new Date(c.candle_open).toISOString().slice(11, 16)} {SLEEVE_LABEL[c.sleeve]} ·{" "}
              {c.eligible ? sideLabel(c.side) : "no call"} · {c.receipt_latency_ms ?? "?"} ms
            </p>
          ))}
          {cps.length === 0 && <p className="text-muted-foreground">Nothing recorded yet.</p>}
        </div>
      </details>
      <p className="text-[11px] text-muted-foreground">
        Inputs: Binance spot. Lab grading used Binance index direction, not spot candles or Kalshi results.
      </p>
    </Card>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-muted-foreground">{k}</p>
      <p className="font-medium">{v}</p>
    </div>
  );
}
