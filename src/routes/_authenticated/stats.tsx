import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getV3Live } from "@/lib/v3Live.functions";
import { V3Card } from "@/components/v3-card";
import { dashboardTotalsRefresh } from "@/lib/dashboard-refresh";
import { Button } from "@/components/ui/button";
import { forceRefreshStats } from "@/lib/statsRefresh.functions";

export const Route = createFileRoute("/_authenticated/stats")({
  head: () => ({
    meta: [
      { title: "Stats — BTC 15m V3" },
      { name: "description", content: "V3 model performance for BTC 15-minute predictions." },
      { property: "og:title", content: "Stats — BTC 15m V3" },
      { name: "twitter:title", content: "Stats — BTC 15m V3" },
      { property: "og:description", content: "V3 model performance for BTC 15-minute predictions." },
      { name: "twitter:description", content: "V3 model performance for BTC 15-minute predictions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StatsPage,
});

function StatsPage() {
  const qc = useQueryClient();
  const fetchV3 = useServerFn(getV3Live);
  const q = useQuery({
    queryKey: ["v3-live"],
    queryFn: () => fetchV3(),
    ...dashboardTotalsRefresh,
  });

  const [refreshing, setRefreshing] = useState(false);
  const forceRefreshFn = useServerFn(forceRefreshStats);
  const handleForceRefresh = async () => {
    setRefreshing(true);
    try {
      await forceRefreshFn();
      await qc.invalidateQueries({ queryKey: ["v3-live"] });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="px-4 sm:px-6 py-5 space-y-6 max-w-[1000px] mx-auto">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 italic">
          Actual candle outcomes are determined by the Kalshi KXBTC15M 15-minute prediction market (CF Benchmarks BRTI settlement).
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs shrink-0"
          onClick={handleForceRefresh}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Force fresh data"}
        </Button>
      </div>
      <V3Card data={q.data ?? null} error={q.isError} />
    </div>
  );
}
