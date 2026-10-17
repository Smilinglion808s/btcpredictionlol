export const CONTROL_POLL_MS = 10_000;
export const CONTROL_MAX_BACKOFF_MS = 60_000;
export interface ControlPoller {
  start(): void;
  refreshNow(): void;
  visibilityChanged(): void;
  close(): void;
}
/** Read-only monitor cadence, not authorization or execution cadence. Hidden tabs
 * do not poll; returning visible refreshes immediately. Never overlaps reads or
 * queues a replay after a double click. Failures back off to at most 60 seconds.
 * Existing status/worker freshness rules continue expiring locally unchanged.
 */
export function createControlPoller(options: {
  refresh(): Promise<void>;
  healthy(): boolean;
  visible(): boolean;
  setTimer?: (callback: () => void, delay: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}): ControlPoller {
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let timer: unknown = null, stopped = false, started = false, running = false, failures = 0;
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const run = async () => {
    if (stopped || !started || running || !options.visible()) return;
    clear(); running = true;
    try { await options.refresh(); failures = options.healthy() ? 0 : Math.min(3, failures + 1); }
    catch { failures = Math.min(3, failures + 1); }
    finally {
      running = false;
      if (!stopped && options.visible()) {
        const delay = Math.min(CONTROL_MAX_BACKOFF_MS, CONTROL_POLL_MS * 2 ** failures);
        timer = setTimer(() => { timer = null; void run(); }, delay);
      }
    }
  };
  return {
    start() { if (started || stopped) return; started = true; void run(); },
    refreshNow() { if (!started || stopped || running) return; clear(); void run(); },
    visibilityChanged() { clear(); if (options.visible()) void run(); },
    close() { stopped = true; clear(); },
  };
}
