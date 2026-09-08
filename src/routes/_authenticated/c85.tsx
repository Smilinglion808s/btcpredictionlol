import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getC85Deployment } from "@/lib/c85.functions";

export const Route = createFileRoute("/_authenticated/c85")({
  component: C85Page,
  head: () => ({
    meta: [
      { title: "C85 Prediction Service Status | BTC 15m" },
      {
        name: "description",
        content:
          "Live status for the C85 BTC 15-minute prediction service: active deployment bundle, worker readiness, model cutoffs and recent decisions.",
      },
      { property: "og:title", content: "C85 Prediction Service Status" },
      {
        property: "og:description",
        content:
          "Active deployment bundle, worker readiness, model cutoffs and recent C85 decisions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const tone = (readiness: string) =>
  readiness === "READY"
    ? "text-bull border-bull/50 bg-bull/10"
    : readiness === "WARMING"
      ? "text-amber-400 border-amber-400/40 bg-amber-400/10"
      : "text-bear border-bear/50 bg-bear/10";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="text-sm font-mono tabular-nums mt-0.5 break-all">{value ?? "—"}</div>
    </div>
  );
}

function C85Page() {
  const fetchDeployment = useServerFn(getC85Deployment);
  const { data, isLoading } = useQuery({
    queryKey: ["c85-deployment"],
    queryFn: () => fetchDeployment(),
    refetchInterval: 20_000,
  });

  const d: any = data ?? {};
  const bundle: any = d.active_bundle ?? null;
  const targets: any[] = d.recent_targets ?? [];
  const side = (n: number) => (n === 1 ? "YES" : n === -1 ? "NO" : "ABSTAIN");

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">C85 prediction service</h1>
        <p className="text-sm text-muted-foreground">
          Serving worker status and the deployment bundle it is running. Betting stays on T45;
          C85 predictions are logged only.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="text-base">Worker</CardTitle>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-widest ${tone(
              String(d.readiness ?? "UNKNOWN"),
            )}`}
          >
            {isLoading ? "LOADING" : String(d.readiness ?? "UNKNOWN")}
          </span>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          <Field label="Stage" value={d.worker?.stage} />
          <Field
            label="Heartbeat age"
            value={d.heartbeat_age_seconds == null ? "—" : `${d.heartbeat_age_seconds}s`}
          />
          <Field label="Next target" value={d.worker?.next_target_utc} />
          <div className="sm:col-span-3">
            <Field label="Blocking reason" value={d.blocking_reason ?? "none"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Active deployment bundle</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          <Field label="Version" value={bundle?.bundle_version ?? "none published"} />
          <Field
            label="Checkpoint age"
            value={d.bundle_age_hours == null ? "—" : `${d.bundle_age_hours}h`}
          />
          <Field label="Last processed target" value={bundle?.last_processed_target_utc} />
          <Field label="Direction fit cutoff" value={bundle?.direction_fit_cutoff_utc} />
          <Field label="Correctness fit cutoff" value={bundle?.meta_fit_cutoff_utc} />
          <Field label="Auxiliary month" value={bundle?.aux_fit_month} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent decisions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {targets.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No C85 decisions logged yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="px-4 py-2 text-left">Target (UTC)</th>
                    <th className="px-4 py-2 text-left">Call</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-right">P(yes)</th>
                    <th className="px-4 py-2 text-right">Publish</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={`${t.ticker}-${t.target_open_utc}`} className="border-b border-border/30">
                      <td className="px-4 py-2">{t.target_open_utc}</td>
                      <td className="px-4 py-2">{side(Number(t.final_side ?? 0))}</td>
                      <td className="px-4 py-2">{t.status}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {t.probability_yes == null ? "—" : Number(t.probability_yes).toFixed(3)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {t.publication_offset_ms == null
                          ? "—"
                          : `${Math.round(Number(t.publication_offset_ms))}ms`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
