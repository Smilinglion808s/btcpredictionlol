// Client-side freshness for the V1.2 current-interval read.
//
// Pure so it can be tested: given the server timestamp inside the payload, the
// interval that payload describes, when the fetch landed, and the current
// client clock, decide whether the payload still describes the interval that
// is open right now.

export const INTERVAL_MS = 900_000;

export type FreshnessInput = {
  /** `now` from the payload (server clock), ms. Null before the first reply. */
  serverNow: number | null;
  /** `intervalOpen` from the payload, ms. */
  intervalOpen: number | null;
  /** When the fetch completed on this client, ms. */
  clientAt: number | null;
  /** Ticking client clock, ms. */
  tick: number;
  error: boolean;
};

export type Freshness = {
  ageSec: number | null;
  rolledOver: boolean;
  stale: boolean;
  /** True when the payload may be shown as the current interval. */
  usable: boolean;
  connecting: boolean;
  label: string;
  /** Interval to display: the payload's when usable, else the clock's. */
  shownOpen: number;
};

export function freshness(i: FreshnessInput): Freshness {
  const offset = i.serverNow != null && i.clientAt != null ? i.serverNow - i.clientAt : 0;
  const serverTick = i.tick + offset;
  const ageSec = i.serverNow == null ? null : Math.round(Math.max(0, serverTick - i.serverNow) / 1000);
  const clockOpen = Math.floor(serverTick / INTERVAL_MS) * INTERVAL_MS;
  const rolledOver = i.intervalOpen != null && i.intervalOpen !== clockOpen;
  const connecting = i.serverNow == null && !i.error;
  const stale = i.error || rolledOver || (ageSec != null && ageSec > 10);
  const usable = i.serverNow != null && !stale;
  const label = i.error
    ? 'connection issue'
    : connecting || ageSec == null
      ? 'connecting'
      : rolledOver
        ? 'new interval — updating'
        : ageSec <= 2
          ? 'live'
          : ageSec > 10
            ? `stale · ${ageSec}s old`
            : `${ageSec}s ago`;
  return { ageSec, rolledOver, stale, usable, connecting, label, shownOpen: usable ? i.intervalOpen! : clockOpen };
}
