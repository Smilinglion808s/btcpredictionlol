// C85 MULTI_META — shared identity and display constants.
//
// The app never scores C85. All model math lives in the Python worker
// (services/c85-worker), which posts signed decisions to the gateway hook.
// These constants only identify rows and drive the dashboard.

export const C85_MODEL_VERSION = "c85-multi-meta-r1";
export const C85_DISPLAY_NAME = "C85";
export const C85_VARIANT = "MULTI_META";
export const C85_SERIES_TICKER = "KXBTC15M";

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
