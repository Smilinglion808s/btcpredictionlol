// B4x4 Order-Book Shadow audit panel (b4x4-ob-shadow-v1).
// Reporting only — this data never influences B4x4 decisions.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Bucket = {
  observations: number;
  wins: number;
  losses: number;
  net: number;
  win_rate: number;
};

export interface ObShadowAudit {
  expected_live_rows: number;
  shadow_rows: number;
  missing_rows: number;
  captured_valid: number;
  captured_stale: number;
  captured_incomplete: number;
  captured_sequence_gap: number;
  no_preboundary_snapshot: number;
  collector_errors: number;
  historical_placeholders: number;
  median_age_ms: number | null;
  max_age_ms: number | null;
  agree: Bucket;
  conflict: Bucket;
  neutral_count: number;
  unavailable_count: number;
  strong_coherent: Bucket;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function BucketRow({ label, b }: { label: string; b?: Bucket }) {
  const net = b?.net ?? 0;
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">
        n={b?.observations ?? 0} · {b?.wins ?? 0}W-{b?.losses ?? 0}L ·{" "}
        {(b?.win_rate ?? 0).toFixed(1)}% ·{" "}
        <span className={net > 0 ? "text-emerald-500" : net < 0 ? "text-rose-500" : ""}>
          {net > 0 ? "+" : ""}{net}
        </span>
      </span>
    </div>
  );
}

export function B4x4ObShadowPanel({
  audit,
  onExport,
  exporting,
  onBackfill,
  backfilling,
}: {
  audit?: ObShadowAudit | null;
  onExport: () => void;
  exporting: boolean;
  onBackfill: () => void;
  backfilling: boolean;
}) {
  const a = audit;
  const coverage = a && a.expected_live_rows
    ? (a.shadow_rows / a.expected_live_rows) * 100
    : 0;

  return (
    <Card className="border-amber-500/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex flex-wrap items-center gap-2 font-heading">
          Shadow Order-Book Audit
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-500">
            b4x4-ob-shadow-v1 · shadow only
          </span>
          <span className="text-[10px] font-normal text-muted-foreground">
            Never used in B4x4 decisions
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Shadow rows" value={`${a?.shadow_rows ?? 0} / ${a?.expected_live_rows ?? 0}`} />
          <Stat label="Row coverage" value={`${coverage.toFixed(1)}%`} />
          <Stat label="Captured valid" value={String(a?.captured_valid ?? 0)} tone="text-emerald-500" />
          <Stat label="Missing rows" value={String(a?.missing_rows ?? 0)} tone={(a?.missing_rows ?? 0) > 0 ? "text-rose-500" : ""} />
          <Stat label="Stale" value={String(a?.captured_stale ?? 0)} />
          <Stat label="Sequence gap" value={String(a?.captured_sequence_gap ?? 0)} />
          <Stat label="No pre-boundary" value={String(a?.no_preboundary_snapshot ?? 0)} />
          <Stat label="Collector errors" value={String(a?.collector_errors ?? 0)} />
          <Stat label="Historical placeholders" value={String(a?.historical_placeholders ?? 0)} />
          <Stat label="Median age" value={a?.median_age_ms != null ? `${a.median_age_ms} ms` : "—"} />
          <Stat label="Max age" value={a?.max_age_ms != null ? `${a.max_age_ms} ms` : "—"} />
          <Stat label="Incomplete book" value={String(a?.captured_incomplete ?? 0)} />
        </div>

        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Published B4x4 outcomes by flow relationship (observational)
          </div>
          <BucketRow label="Flow agrees with raw direction" b={a?.agree} />
          <BucketRow label="Flow conflicts with raw direction" b={a?.conflict} />
          <BucketRow label="Strong coherent flow" b={a?.strong_coherent} />
          <div className="text-[11px] text-muted-foreground">
            Neutral {a?.neutral_count ?? 0} · Unavailable {a?.unavailable_count ?? 0}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Download shadow CSV"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onBackfill} disabled={backfilling}>
            {backfilling ? "Backfilling…" : "Backfill historical placeholders"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
