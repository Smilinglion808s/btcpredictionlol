import { describe, expect, it } from "vitest";
import {
  boiseTime,
  emptyHistoryCheckDisplay,
  entryMarketCap,
  historyCheckDisplay,
  newestTrades,
  realizedTradeDisplay,
  shortMint,
} from "./solana-paper-display";
import {
  walletTail,
  type HistoricalTrade,
  type PaperHistory,
  type PaperMonitorLoad,
  type ScannerHealth,
} from "./solana-paper";

const trade = (changes: Partial<HistoricalTrade> = {}): HistoricalTrade => ({
  position_id: "synthetic-position",
  source_wallet: "synthetic-wallet-ABCD",
  mint: "synthetic-mint-1234",
  entry_notional_lamports: "1000000000",
  acquired_tokens_raw: "10",
  decimals: 0,
  entry_at: "2026-01-20T12:00:00Z",
  exit_at: "2026-01-20T13:00:00Z",
  position_status_at_cutoff: "closed",
  realized_net_pnl_lamports: "0",
  open_net_pnl_lamports_at_cutoff: null,
  unresolved_reason: null,
  source_coverage_gap_latched: false,
  source_epoch_id: null,
  coverage_class: null,
  historical_only: true,
  current: false,
  executable: false,
  ...changes,
});

// Synthetic session metadata only; no production rows, wallets or credentials.
const historyFixture = (run = "synthetic-run-a", cutoff = "2026-01-20T12:00:00Z"): PaperHistory =>
  ({
    schema_version: "synthetic",
    run_id: run,
    exploratory_mode: null,
    returns_scope: null,
    source_observation_policy: null,
    evidence_fence: {
      evidence_cutoff_utc: cutoff,
      fixed_deadline_utc: "2026-01-21T12:00:00Z",
      journal_sequence: 1,
    },
  }) as PaperHistory;
const acceptedLoad = (
  history = historyFixture(),
  checked = 100,
): Extract<PaperMonitorLoad, { state: "ready" }> => ({
  state: "ready",
  fetchedAt: 10,
  historyCheckedAt: checked,
  health: { state: "unavailable" },
  history: { state: "available", data: history },
});
const sessionLoad = (run: string): PaperMonitorLoad => ({
  state: "ready",
  fetchedAt: 20,
  health: {
    state: "available",
    data: {
      run_id: run,
      fixed_deadline_utc: "2026-01-21T12:00:00Z",
      exploratory_mode: null,
      returns_scope: null,
      source_observation_policy: null,
    } as ScannerHealth,
  },
  history: { state: "unavailable" },
});
const success = () => historyCheckDisplay(emptyHistoryCheckDisplay, acceptedLoad(), acceptedLoad());

describe("session-bound historical check attribution", () => {
  it("does not turn a health-only outage into a failed historical read", () => {
    const initial = success();
    const outage = historyCheckDisplay(initial, {
      ...acceptedLoad(initial.history ?? historyFixture()),
      fetchedAt: 0,
    });
    expect(outage.outcome).toBe("accepted");
    expect(outage.lastSuccessfulRead).toBe(100);
    expect(outage.history).toBe(initial.history);
  });
  it("clears successful-check attribution on a verified run switch", () => {
    const switched = historyCheckDisplay(success(), sessionLoad("synthetic-run-b"));
    expect(switched.history).toBeNull();
    expect(switched.lastSuccessfulRead).toBeNull();
    expect(switched.outcome).toBe("unchecked");
  });
  it("cannot restore old attribution from a late session-mismatched report", () => {
    const switched = historyCheckDisplay(success(), sessionLoad("synthetic-run-b"));
    const late = historyCheckDisplay(switched, acceptedLoad(historyFixture(), 200), acceptedLoad());
    expect(late.history).toBeNull();
    expect(late.lastSuccessfulRead).toBeNull();
    expect(late.outcome).toBe("rejected");
  });
  it("accepts cached run B history when health verifies B after the report check", () => {
    const healthA = sessionLoad("synthetic-run-a");
    const healthB = sessionLoad("synthetic-run-b");
    if (healthA.state !== "ready" || healthB.state !== "ready") throw Error("fixture");
    const initial = historyCheckDisplay(success(), healthA);
    const reportB = acceptedLoad(historyFixture("synthetic-run-b"), 200);
    const rejected = historyCheckDisplay(
      initial,
      { ...reportB, health: healthA.health },
      reportB,
    );
    expect(rejected.outcome).toBe("rejected");
    expect(rejected.history?.run_id).toBe("synthetic-run-a");
    expect(rejected.lastSuccessfulRead).toBe(100);

    // Health-only event reuses B's original checked timestamp and evidence, without a new read.
    const accepted = historyCheckDisplay(rejected, { ...reportB, health: healthB.health });
    expect(accepted.outcome).toBe("accepted");
    expect(accepted.history?.run_id).toBe("synthetic-run-b");
    expect(accepted.lastSuccessfulRead).toBe(200);
    expect(accepted.history?.evidence_fence.evidence_cutoff_utc).toBe("2026-01-20T12:00:00Z");
  });
  it("retains the successful check and original cutoff on a same-session failed read", () => {
    const initial = success();
    const failed = historyCheckDisplay(
      initial,
      {
        state: "ready",
        fetchedAt: 20,
        health: { state: "unavailable" },
        history: { state: "unavailable" },
      },
      { state: "error", message: "synthetic failure" },
    );
    expect(failed.history).toBe(initial.history);
    expect(failed.lastSuccessfulRead).toBe(100);
    expect(failed.outcome).toBe("unavailable");
    expect(failed.history?.evidence_fence.evidence_cutoff_utc).toBe("2026-01-20T12:00:00Z");
  });
  it("keeps a newer same-session cutoff when an older report is successfully checked", () => {
    const initial = success();
    const older = acceptedLoad(historyFixture("synthetic-run-a", "2026-01-20T11:00:00Z"), 200);
    const retained = historyCheckDisplay(initial, older, older);
    expect(retained.history).toBe(initial.history);
    expect(retained.lastSuccessfulRead).toBe(200);
    expect(retained.outcome).toBe("accepted");
  });
  it.each(["deadline", "mode"])(
    "invalidates successful checks on a verified %s switch",
    (field) => {
      const load = sessionLoad("synthetic-run-a");
      if (load.state !== "ready" || load.health.state !== "available") throw Error("fixture");
      if (field === "deadline") load.health.data.fixed_deadline_utc = "2026-01-22T12:00:00Z";
      else load.health.data.exploratory_mode = true;
      const cleared = historyCheckDisplay(success(), load);
      expect(cleared.history).toBeNull();
      expect(cleared.lastSuccessfulRead).toBeNull();
    },
  );
});

describe("Solana historical display", () => {
  it("uses Boise winter MST with a clear date", () => {
    expect(boiseTime("2026-01-20T12:00:00Z")).toBe("Jan 20, 2026, 5:00:00 AM MST");
  });
  it("uses Boise summer MDT", () => {
    expect(boiseTime("2026-07-20T12:00:00Z")).toBe("Jul 20, 2026, 6:00:00 AM MDT");
  });
  it("keeps invalid and missing dates unknown", () => {
    expect(boiseTime("invalid")).toBe("Unknown");
    expect(boiseTime(null)).toBe("Unknown");
  });
  it("shows exactly the last four wallet characters without replacing identity", () => {
    expect(walletTail(trade().source_wallet)).toBe("…ABCD");
    expect(shortMint(trade().mint)).toBe("synt…1234");
  });
  it("never joins current market cap into historical entry data", () => {
    const fixture = { ...trade(), valuation: { market_cap: "999999" } };
    expect(entryMarketCap(fixture)).toBe("Unknown");
  });
  it("distinguishes null from realized zero", () => {
    expect(realizedTradeDisplay(trade({ realized_net_pnl_lamports: null })).value).toBe("Unknown");
    expect(realizedTradeDisplay(trade())).toEqual({
      value: "0 SOL",
      label: "Realized · break-even",
    });
  });
  it("labels signed realized gains and losses without relying on color", () => {
    expect(realizedTradeDisplay(trade({ realized_net_pnl_lamports: "1000000000" }))).toEqual({
      value: "+1 SOL",
      label: "Realized gain",
    });
    expect(realizedTradeDisplay(trade({ realized_net_pnl_lamports: "-1000000000" }))).toEqual({
      value: "−1 SOL",
      label: "Realized loss",
    });
  });
  it("open rows never display an estimate or unsupported realized portion", () => {
    expect(
      realizedTradeDisplay(
        trade({
          position_status_at_cutoff: "open",
          realized_net_pnl_lamports: null,
          open_net_pnl_lamports_at_cutoff: "9000000000",
        }),
      ),
    ).toEqual({ value: "Open", label: "Realized unavailable" });
    // Defensive only: the current parser rejects this fixture, so no partial claim.
    expect(
      realizedTradeDisplay(
        trade({ position_status_at_cutoff: "open", realized_net_pnl_lamports: "1" }),
      ),
    ).toEqual({ value: "Open", label: "Realized unavailable" });
  });
  it("unresolved remains unresolved", () => {
    expect(realizedTradeDisplay(trade({ position_status_at_cutoff: "unresolved" })).value).toBe(
      "Unresolved",
    );
  });
  it("sorts newest entry first without mutating evidence or promoting invalid dates", () => {
    const rows = [
      trade(),
      trade({ entry_at: "2026-07-20T12:00:00Z" }),
      trade({ entry_at: "invalid" }),
    ];
    expect(newestTrades(rows).map((t) => t.entry_at)).toEqual([
      "2026-07-20T12:00:00Z",
      "2026-01-20T12:00:00Z",
      "invalid",
    ]);
    expect(rows[0].entry_at).toBe("2026-01-20T12:00:00Z");
  });
});
