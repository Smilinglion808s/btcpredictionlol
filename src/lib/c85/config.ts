// C85 MULTI_META — shared identity and display constants.
//
// The app never scores C85. All model math lives in the Python worker
// (services/c85-worker), which posts signed decisions to the gateway hook.
// These constants only identify rows and drive the dashboard.

export const C85_MODEL_VERSION = "c85-multi-meta-r1";
export const C85_DISPLAY_NAME = "C85";
export const C85_VARIANT = "MULTI_META";
export const C85_SERIES_TICKER = "KXBTC15M";

/**
 * Reconstruction identity. The rebuilt worker was never shown to reproduce the
 * archived `c85-multi-meta-r1` ledger numerically, so every row it writes —
 * decisions, checkpoints, fits, settlements, health — carries this separate
 * version. Archived performance does not transfer to it, and the two identities
 * never share a row: all C85 tables are keyed on `model_version`.
 */
export const C85_RECONSTRUCTION_VERSION = "c85-reconstruction-r1";

/**
 * Version 1 — a SEPARATE model, not a C85 variant. It shares this worker's feed
 * adapters and this signed endpoint, and none of the C85 ancestry. It never
 * dispatches: no outbox row is ever written under this identity, so it cannot
 * reach the betting webhook. T45 remains the only executing model.
 */
export const LITE_A_MODEL_VERSION = "lite-a-floor4-top10-r1";

/** The only identities a signed worker request may write under. */
export const C85_WRITABLE_MODEL_VERSIONS = [
  C85_MODEL_VERSION,
  C85_RECONSTRUCTION_VERSION,
  LITE_A_MODEL_VERSION,
] as const;

/** Identities that may never enqueue an outbox entry, regardless of payload. */
export const C85_DISPATCH_FORBIDDEN_MODEL_VERSIONS = [
  LITE_A_MODEL_VERSION,
] as const;

export const C85_TARGETS_TABLE = "c85_targets";
export const C85_SETTLEMENTS_TABLE = "c85_settlements";
export const C85_HEALTH_TABLE = "c85_worker_health";
export const C85_OUTBOX_TABLE = "c85_outbox";
export const C85_CHECKPOINTS_TABLE = "c85_state_checkpoints";

/** Hard publication ceiling: target open + 5 seconds. */
export const C85_PUBLICATION_DEADLINE_MS = 5_000;

/** Bankroll display parameters (presentation only — no execution effect). */
export const C85_BANKROLL_PRINCIPAL_CENTS = 50_000;
export const C85_BANKROLL_BASIS_POINTS = 400;
export const C85_BANKROLL_WIN_PROFIT_PCT = 87;
export const C85_BANKROLL_DECIMAL_ODDS = 1.87;
export const C85_BANKROLL_RESET = "daily" as const;

/** Display timezone with DST handling. */
export const C85_DISPLAY_TIMEZONE = "America/Boise";

/** One bet's stake in integer cents, half-up. */
export function stakeCents(bankrollCents: number): number {
  return Math.floor((bankrollCents * C85_BANKROLL_BASIS_POINTS) / 10_000 + 0.5);
}

/** Profit in integer cents for a winning bet, half-up. */
export function winProfitCents(stake: number): number {
  return Math.floor((stake * C85_BANKROLL_WIN_PROFIT_PCT) / 100 + 0.5);
}

export function boiseDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: C85_DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function boiseTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: C85_DISPLAY_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
