// Typed seam for a future read-only Solana paper-trade feed. No source is connected yet.
export type SolanaPaperTrade = {
  id: string;
  wallet: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  amountSol: number | null;
  tokenQty: number | null;
  pnlSol: number | null;
  pnlPct: number | null;
};

export type SolanaPaperFeed =
  | { status: "not_running" }
  | { status: "error"; message: string }
  | { status: "ready"; trades: SolanaPaperTrade[] };

export async function loadSolanaPaperFeed(): Promise<SolanaPaperFeed> {
  return { status: "not_running" };
}

export const walletTail = (w: string) => (w && w.length >= 4 ? `…${w.slice(-4)}` : "—");
export const num = (v: number | null, d = 4) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d });
export const signed = (v: number | null, suffix: string, d = 4) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: d })}${suffix}`;
export const toneOf = (v: number | null) => (v == null ? "text-muted-foreground" : v > 0 ? "text-bull" : v < 0 ? "text-bear" : "");
