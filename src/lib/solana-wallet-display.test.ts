import { describe, expect, it } from "vitest";
import {
  emptyHistoryCheckDisplay,
  historyCheckDisplay,
  realizedWalletAmount,
  walletRealizedRows,
} from "./solana-paper-display";
import type {
  HistoricalTrader,
  PaperHistory,
  PaperMonitorLoad,
  ScannerHealth,
} from "./solana-paper";

const wallet = "synthetic-wallet-ABCD";
const trader = (amount = "1000000000"): HistoricalTrader => ({
  source_wallet: wallet,
  realized_net_pnl_lamports: amount,
  open_net_pnl_lamports_at_cutoff: "9000000000",
  total_net_pnl_lamports_at_cutoff: "10000000000",
  closed_count: 1,
  open_count: 1,
  unresolved_count: 0,
  failed_entry_count: 0,
  skipped_opportunity_count: 0,
  skipped_reasons: {},
  source_coverage_gap_latched: false,
  pnl_scope: "our_modeled_copies_not_source_wallet_returns",
});
const report = (rows = [trader()], run = "synthetic-a"): PaperHistory =>
  ({
    run_id: run,
    historical_only: true,
    executable: false,
    financial_data_is_current: false,
    evidence_kind: "observed_estimated_paper",
    exploratory_mode: null,
    evidence_fence: {
      evidence_cutoff_utc: "2026-01-20T12:00:00Z",
      fixed_deadline_utc: "2026-01-21T12:00:00Z",
      journal_sequence: 1,
    },
    trader_pnl_as_of: rows,
    copied_trades_as_of: null,
  }) as PaperHistory;
const load = (history: PaperHistory): PaperMonitorLoad => ({
  state: "ready",
  fetchedAt: 100,
  historyCheckedAt: 100,
  health: { state: "unavailable" },
  history: { state: "available", data: history },
});

describe("authoritative paper wallet realized display", () => {
  it("uses wallet aggregates even when copied trades are missing or partial", () => {
    const history = report();
    expect(walletRealizedRows(history)[0]?.thisRun.value).toBe("+1 SOL");
    expect(walletRealizedRows({ ...history, copied_trades_as_of: [] })[0]?.thisRun.value).toBe(
      "+1 SOL",
    );
  });
  it("never includes open estimates or conditional totals in realized PnL", () => {
    expect(walletRealizedRows(report())[0]?.thisRun.value).toBe("+1 SOL");
  });
  it("distinguishes known zero, negative realized and absent money", () => {
    expect(realizedWalletAmount("0")).toEqual({ value: "0 SOL", label: "Realized · break-even" });
    expect(realizedWalletAmount("-1000000000")).toEqual({
      value: "−1 SOL",
      label: "Realized loss",
    });
    expect(realizedWalletAmount(null).value).toBe("Unavailable");
    expect(realizedWalletAmount(undefined).value).toBe("Unavailable");
  });
  it("never invents wallets or treats absent or partial aggregates as zero or all-run history", () => {
    expect(walletRealizedRows(null)).toEqual([]);
    const rows = walletRealizedRows(report([]), [wallet]);
    expect(rows[0]?.thisRun.value).toBe("Unavailable");
    expect(rows[0]?.allRecordedRuns).toBe("Unavailable");
    expect(walletRealizedRows(report())[0]?.allRecordedRuns).toBe("Unavailable");
  });
  it("defends duplicate wallets without summing them", () => {
    const rows = walletRealizedRows(report([trader(), trader()]), [wallet, wallet]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.thisRun.value).toBe("Unavailable");
  });
  it("rejects live or wrong-scope aggregates rather than mixing paper and live", () => {
    expect(
      walletRealizedRows({ ...report(), executable: true } as unknown as PaperHistory),
    ).toEqual([]);
    const wrongScope = {
      ...trader(),
      pnl_scope: "source_wallet_returns",
    } as unknown as HistoricalTrader;
    expect(walletRealizedRows(report([wrongScope]))[0]?.thisRun.value).toBe("Unavailable");
  });
  it("replaces repeated and newer snapshots, never double-counting", () => {
    const first = historyCheckDisplay(emptyHistoryCheckDisplay, load(report()), load(report()));
    const repeated = historyCheckDisplay(first, load(report()), load(report()));
    expect(walletRealizedRows(repeated.history)[0]?.thisRun.value).toBe("+1 SOL");
    const newer = {
      ...report([trader("2000000000")]),
      evidence_fence: { ...report().evidence_fence, evidence_cutoff_utc: "2026-01-20T13:00:00Z" },
    };
    const next = historyCheckDisplay(repeated, load(newer), load(newer));
    expect(walletRealizedRows(next.history)[0]?.thisRun.value).toBe("+2 SOL");
    expect(walletRealizedRows(next.history)[0]?.cutoff).toBe("2026-01-20T13:00:00Z");
  });
  it("clears run A money on a verified run switch before displaying run B", () => {
    const initial = historyCheckDisplay(emptyHistoryCheckDisplay, load(report()), load(report()));
    const health = {
      run_id: "synthetic-b",
      fixed_deadline_utc: "2026-01-21T12:00:00Z",
      exploratory_mode: null,
    } as ScannerHealth;
    const switched = historyCheckDisplay(initial, {
      state: "ready",
      fetchedAt: 200,
      health: { state: "available", data: health },
      history: { state: "unavailable" },
    });
    expect(walletRealizedRows(switched.history, [wallet])[0]?.thisRun.value).toBe("Unavailable");
    const next = historyCheckDisplay(switched, load(report([trader("3000000000")], "synthetic-b")));
    expect(walletRealizedRows(next.history)[0]?.thisRun.value).toBe("+3 SOL");
    expect(walletRealizedRows(next.history)[0]?.runId).toBe("synthetic-b");
  });
});
