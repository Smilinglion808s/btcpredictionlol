import { afterEach, describe, expect, it, vi } from "vitest";
import { startIndependentMonitorRefresh, startMonitorRefresh, type PaperMonitorLoad } from "./solana-paper";

const ready = (fetchedAt: number): PaperMonitorLoad => ({ state: "ready", fetchedAt, health: { state: "unavailable" }, history: { state: "unavailable" } });
const drain = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe("independent Solana read-only refresh", () => {
  it("keeps the five-second health loop independent of 180000ms history checks", async () => {
    vi.useFakeTimers();
    const health = vi.fn(async () => ready(100));
    const history = vi.fn(async () => ready(999));
    const emit = vi.fn();
    const stop = startIndependentMonitorRefresh(health, history, emit, { historyIntervalMs: 180000 });
    await drain();
    await vi.advanceTimersByTimeAsync(179999);
    expect(history).toHaveBeenCalledTimes(1);
    expect(health).toHaveBeenCalledTimes(36);
    expect(emit.mock.lastCall?.[0].fetchedAt).toBe(100);
    await vi.advanceTimersByTimeAsync(1);
    expect(history).toHaveBeenCalledTimes(2);
    stop();
  });
  it("preserves the 600000ms default for other callers", async () => {
    vi.useFakeTimers();
    const history = vi.fn(async () => ready(0));
    const stop = startIndependentMonitorRefresh(async () => ready(0), history, () => {});
    await drain();
    await vi.advanceTimersByTimeAsync(599999);
    expect(history).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(history).toHaveBeenCalledTimes(2);
    stop();
  });
  it("deduplicates manual reads and schedules history only after completion", async () => {
    vi.useFakeTimers();
    let resolve: ((value: PaperMonitorLoad) => void) | undefined;
    const history = vi.fn(() => new Promise<PaperMonitorLoad>((done) => { resolve = done; }));
    const stop = startIndependentMonitorRefresh(async () => ready(0), history, () => {}, { historyIntervalMs: 180000, timeoutMs: 300000 });
    stop.refreshHistory(); stop.refreshHistory();
    expect(history).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(180000);
    expect(history).toHaveBeenCalledTimes(1);
    resolve?.(ready(0)); await drain();
    await vi.advanceTimersByTimeAsync(179999);
    expect(history).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(history).toHaveBeenCalledTimes(2);
    stop();
  });
  it("manual refresh cancels a scheduled history read without affecting health", async () => {
    vi.useFakeTimers();
    const history = vi.fn(async () => ready(0));
    const stop = startIndependentMonitorRefresh(async () => ready(0), history, () => {}, { historyIntervalMs: 180000 });
    await drain();
    await vi.advanceTimersByTimeAsync(100000);
    stop.refreshHistory(); await drain();
    expect(history).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(80000);
    expect(history).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100000);
    expect(history).toHaveBeenCalledTimes(3);
    stop();
  });
  it("unmount aborts and fences late results and pending callbacks", async () => {
    vi.useFakeTimers();
    let resolve: ((value: PaperMonitorLoad) => void) | undefined;
    let signal: AbortSignal | undefined;
    const emit = vi.fn(); const pending = vi.fn();
    const stop = startIndependentMonitorRefresh(async () => ready(0), (s) => { signal = s; return new Promise((done) => { resolve = done; }); }, emit, { onHistoryPending: pending });
    await drain(); stop(); emit.mockClear(); pending.mockClear();
    expect(signal?.aborted).toBe(true);
    resolve?.(ready(0)); await drain();
    await vi.advanceTimersByTimeAsync(600000);
    expect(emit).not.toHaveBeenCalled();
    expect(pending).not.toHaveBeenCalled();
  });
  it("timeout suppresses late responses without overlapping noncooperative reads", async () => {
    vi.useFakeTimers();
    let resolve: ((value: PaperMonitorLoad) => void) | undefined;
    const loader = vi.fn(() => new Promise<PaperMonitorLoad>((done) => { resolve = done; }));
    const emit = vi.fn(); const stop = startMonitorRefresh(loader, emit);
    await vi.advanceTimersByTimeAsync(10000);
    expect(emit.mock.lastCall?.[0].state).toBe("error");
    stop.refresh(); expect(loader).toHaveBeenCalledTimes(1);
    resolve?.(ready(1)); await drain();
    expect(emit).toHaveBeenCalledTimes(1);
    stop();
  });
});