import { describe, expect, it } from "vitest";
import { lamportsToSol, pnlView, rawToDecimal, tradeKey, walletTail, type SolanaPaperTrade } from "./solana-paper";

const base = (o: Partial<SolanaPaperTrade> = {}, v: Partial<SolanaPaperTrade["valuation"]> = {}): SolanaPaperTrade => ({
  position_id: "p1", source_wallet: "AAAAwxyz", mint: "MintA", symbol: null, name: null,
  entry_input_lamports: "1000000000", acquired_tokens_raw: "123456789", decimals: 6,
  entry_at: "2026-10-16T00:00:00Z", exit_at: null, position_status: "open",
  fees_lamports: null, locked_rent_lamports: null, realized_net_pnl_lamports: null,
  valuation: { pricing_mode: "estimated_market_snapshot", mark_status: "fresh", observed_at: null, received_at: null, source: null, provider: null, price_basis: null, liquidity_value: null, liquidity_currency: null, market_cap: null, fee_assumption_bps: 30, slippage_assumption_bps: 100, execution_model_version: "m1", estimated_liquidation_net_lamports: "1250000000", full_size_liquidation_net_lamports: null, unresolved_reason: null, ...v },
  ...o,
});

describe("solana paper adapter", () => {
  it("keeps distinct keys for wallets sharing a suffix", () => {
    const a = base({ source_wallet: "1111wxyz" }), b = base({ source_wallet: "2222wxyz" });
    expect(walletTail(a.source_wallet)).toBe(walletTail(b.source_wallet));
    expect(tradeKey(a)).not.toBe(tradeKey(b));
  });
  it("never turns unknown into zero", () => {
    expect(lamportsToSol(null)).toBe("—");
    expect(rawToDecimal("5", null, 4)).toBe("—");
    expect(walletTail(null)).toBe("—");
  });
  it("stale or missing marks yield no PnL", () => {
    expect(pnlView(base({}, { mark_status: "stale" })).lamports).toBeNull();
    expect(pnlView(base({}, { mark_status: "missing" })).pctText).toBe("—");
    expect(pnlView(base({}, { pricing_mode: "unavailable" })).lamports).toBeNull();
  });
  it("labels estimated PnL and keeps precision with sign", () => {
    const p = pnlView(base());
    expect(p.label).toBe("Estimated paper PnL");
    expect(p.lamports).toBe("250000000");
    expect(lamportsToSol(p.lamports, true)).toBe("+0.25");
    expect(p.pctText).toBe("+25.00%");
    expect(lamportsToSol("-1", true)).toBe("−<0.0001");
    expect(rawToDecimal("123456789", 6, 2)).toBe("123.46");
  });
});
