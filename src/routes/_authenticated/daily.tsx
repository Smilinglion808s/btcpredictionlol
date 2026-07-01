import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listDailyArchives } from "@/lib/predictions.functions";

export const Route = createFileRoute("/_authenticated/daily")({
  head: () => ({ meta: [{ title: "24 Hour Data Sets — BTC 15m" }] }),
  component: DailyPage,
});

function DailyPage() {
  const fn = useServerFn(listDailyArchives);
  const q = useQuery({
    queryKey: ["daily-archives"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });

  const rows = q.data ?? [];

  return (
    <div className="px-4 sm:px-6 py-5 space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-xl font-semibold">24 Hour Data Sets</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Snapshot of performance stats taken daily at 10:00 PM ET, then the running window resets.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Archived Windows</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">
              No archives yet. The first snapshot runs at 10:00 PM ET.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Model</th>
                    <th className="text-right px-3 py-2">Win Rate</th>
                    <th className="text-right px-3 py-2">Total Bets</th>
                    <th className="text-right px-3 py-2">Wins</th>
                    <th className="text-right px-3 py-2">Losses</th>
                    <th className="text-right px-3 py-2">Net W/L</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {rows.map((r) => {
                    const net = Number(r.wins ?? 0) - Number(r.losses ?? 0);
                    const netCls = net > 0 ? "text-bull" : net < 0 ? "text-bear" : "";
                    const dateLabel = new Date(r.archived_at).toLocaleDateString("en-US", {
                      timeZone: "America/New_York",
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    });
                    return (
                      <tr key={r.id} className="border-b border-border/50">
                        <td className="px-3 py-2 whitespace-nowrap">{dateLabel}</td>
                        <td className="px-3 py-2">{r.model_version}</td>
                        <td className="px-3 py-2 text-right">{Number(r.win_rate ?? 0).toFixed(2)}%</td>
                        <td className="px-3 py-2 text-right">{r.total}</td>
                        <td className="px-3 py-2 text-right text-bull">{r.wins}</td>
                        <td className="px-3 py-2 text-right text-bear">{r.losses}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${netCls}`}>
                          {net > 0 ? `+${net}` : net}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
