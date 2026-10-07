import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PaperTerminal } from "../../components/dot-paper/PaperTerminal";
import {
  getDotPaperSnapshot,
  getDotPaperPage,
} from "../../lib/dot-paper.functions";
import type {
  PaperSnapshot,
  PaperTrade,
  PaperCall,
} from "../../lib/dot-paper/types";

import { mergeForwardPages } from "../../lib/dot-paper/presentation";

export const Route = createFileRoute("/_authenticated/paper")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "DOT · Forward Paper Trading | BTC Predictor Pro" },
      {
        name: "description",
        content:
          "Read-only, BTC-only forward paper trading. Experimental rules, simulated fills, no real orders.",
      },
    ],
  }),
  component: DotPaperPage,
});
function DotPaperPage() {
  const [view, setView] = useState<"loading" | "locked" | "error" | "ready">(
    "loading",
  );
  const [snapshot, setSnapshot] = useState<PaperSnapshot>();
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [received, setReceived] = useState(0);
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(true),
    inflight = useRef(false),
    pageInFlight = useRef(false),
    latest = useRef<PaperSnapshot | undefined>(undefined);
  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setRefreshing(true);
    try {
      const response = await getDotPaperSnapshot();
      if (!mounted.current) return;
      if (!response.ok) {
        if (latest.current) {
          setMessage(
            "The latest refresh failed. Previously received data is retained and will be marked stale.",
          );
          return;
        }
        setView(
          response.code === "SERVICE_NOT_CONFIGURED" ? "locked" : "error",
        );
        setMessage(
          response.code === "SERVICE_NOT_CONFIGURED"
            ? "The paper worker is not connected yet. This desk is read-only; no historical trades or placeholder performance will be shown."
            : "A valid paper-service response could not be verified. Refresh to retry.",
        );
        return;
      }
      // The public schema strips internal worker metadata before this boundary.
      const data = response.data as unknown as PaperSnapshot;
      const merged = {
        ...data,
        trades: mergeForwardPages(
          latest.current?.run_id === data.run_id
            ? latest.current.trades
            : undefined,
          data.trades,
        ),
        calls: mergeForwardPages(
          latest.current?.run_id === data.run_id
            ? latest.current.calls
            : undefined,
          data.calls,
        ),
      };
      latest.current = merged;
      setSnapshot(merged);
      setReceived(Date.now());
      setMessage("");
      setView("ready");
    } catch {
      if (!mounted.current) return;
      if (latest.current)
        setMessage(
          "The latest refresh failed. Previously received data is retained and will be marked stale.",
        );
      else {
        setView("error");
        setMessage(
          "The read-only paper service could not be reached. Refresh to retry.",
        );
      }
    } finally {
      inflight.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    let lastAutomatic = Date.now();
    const interval = setInterval(() => {
      const live = latest.current?.feed.health === "FRESH";
      const cadence = live
        ? Math.max(
            1000,
            Math.min(
              5000,
              (latest.current?.assumptions.max_quote_age_ms ?? 10000) / 2,
            ),
          )
        : 5000;
      if (
        document.visibilityState === "visible" &&
        !pageInFlight.current &&
        Date.now() - lastAutomatic >= cadence
      ) {
        lastAutomatic = Date.now();
        void refresh();
      }
    }, 1000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  const loadOlder = async (kind: "trades" | "calls" | "audit") => {
    const previous = latest.current,
      cursor = previous?.[kind].next_cursor;
    if (kind === "audit" || cursor == null || pageInFlight.current || !previous)
      return;
    pageInFlight.current = true;
    setPageBusy(true);
    try {
      const response = await getDotPaperPage({
        data: { kind, before: cursor },
      });
      if (!mounted.current) return;
      if (!response.ok) {
        setMessage(
          "Older records could not be loaded. Your existing rows are unchanged.",
        );
        return;
      }
      setSnapshot((current) => {
        if (
          !current ||
          current.run_id !== previous.run_id ||
          response.data.run_id !== previous.run_id
        )
          return current;
        const existing = current[kind].items as (PaperTrade | PaperCall)[];
        const incoming = response.data.items as (PaperTrade | PaperCall)[];
        const unique = new Map(
          [...existing, ...incoming].map((row) => [row.id, row]),
        );
        const next = {
          ...current,
          [kind]: {
            items: [...unique.values()].sort((a, b) => b.id - a.id),
            next_cursor: response.data.next_cursor,
          },
        };
        latest.current = next;
        return next;
      });
    } catch {
      if (mounted.current)
        setMessage("Older records could not be loaded. Try again.");
    } finally {
      pageInFlight.current = false;
      if (mounted.current) setPageBusy(false);
    }
  };
  return (
    <PaperTerminal
      view={view}
      snapshot={snapshot}
      elapsedMs={received ? now - received : 0}
      now={now}
      message={message}
      refreshing={refreshing}
      pageBusy={pageBusy}
      onRefresh={() => void refresh()}
      onLoadOlder={(kind) => void loadOlder(kind)}
    />
  );
}
