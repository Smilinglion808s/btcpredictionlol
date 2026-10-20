import { describe, expect, it } from "vitest";
import { boiseTime, entryMarketCap, newestTrades, realizedTradeDisplay, shortMint } from "./solana-paper-display";
import { walletTail, type HistoricalTrade } from "./solana-paper";

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
    expect(realizedTradeDisplay(trade())).toEqual({ value: "0 SOL", label: "Realized · break-even" });
  });
  it("labels signed realized gains and losses without relying on color", () => {
    expect(realizedTradeDisplay(trade({ realized_net_pnl_lamports: "1000000000" }))).toEqual({ value: "+1 SOL", label: "Realized gain" });
    expect(realizedTradeDisplay(trade({ realized_net_pnl_lamports: "-1000000000" }))).toEqual({ value: "−1 SOL", label: "Realized loss" });
  });
  it("open rows never display an estimate or unsupported realized portion", () => {
    expect(realizedTradeDisplay(trade({ position_status_at_cutoff: "open", realized_net_pnl_lamports: null, open_net_pnl_lamports_at_cutoff: "9000000000" }))).toEqual({ value: "Open", label: "Realized unavailable" });
    // Defensive only: the current parser rejects this fixture, so no partial claim.
    expect(realizedTradeDisplay(trade({ position_status_at_cutoff: "open", realized_net_pnl_lamports: "1" }))).toEqual({ value: "Open", label: "Realized unavailable" });
  });
  it("unresolved remains unresolved", () => {
    expect(realizedTradeDisplay(trade({ position_status_at_cutoff: "unresolved" })).value).toBe("Unresolved");
  });
  it("sorts newest entry first without mutating evidence or promoting invalid dates", () => {
    const rows = [trade(), trade({ entry_at: "2026-07-20T12:00:00Z" }), trade({ entry_at: "invalid" })];
    expect(newestTrades(rows).map((t) => t.entry_at)).toEqual(["2026-07-20T12:00:00Z", "2026-01-20T12:00:00Z", "invalid"]);
    expect(rows[0].entry_at).toBe("2026-01-20T12:00:00Z");
  });
});