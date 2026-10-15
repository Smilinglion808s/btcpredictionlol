import { describe, expect, it } from "vitest";
import { altPaper } from "./alt-worker.server";
import { deriveAltWorkerView } from "./alt-worker-view";

// Shape of worker Ledger.status() with one open position (positions table row + unrealized_pnl).
const real = {
  mode: "VIRTUAL_PAPER", real_orders_supported: false, starting_balance: "1000", cash: "874.9", equity: "999.1", used_margin: "125",
  positions: [{ symbol: "SOLUSDT", trade_id: "t1", side: "LONG", qty: "10", entry_price: "100.02", margin: "125", entry_fee: "0.5",
    leverage: "8", entry_ms: 1000, exit_due_ms: 301000, mark: "100", unrealized_pnl: "-0.2" }],
  trade_count: 0, recent_trades: [],
  config: { strategy_enabled: true, rule: "x", leverage: "8", hold_min: 5, margin_fraction: "0.125", fee_bps: "5", slippage_bps: "2", signal_bps: "10" },
  disclaimer: "Exploratory simulation",
};

describe("real worker paper payload", () => {
  it("parses and exposes entry_price", () => {
    const p = altPaper.safeParse(real);
    expect(p.success).toBe(true);
    const v = deriveAltWorkerView({ health: { ok: false, code: "UNAVAILABLE" }, events: { ok: false, code: "UNAVAILABLE" }, paper: { ok: true, data: p.data! } }, 0);
    expect(v.paper && "positions" in v.paper && v.paper.positions[0].entry_price).toBe("100.02");
  });
});
