/** Display-only polling; never used by prediction workers or execution. */
export const DASHBOARD_TOTALS_REFRESH_MS = 120_000;
export const DASHBOARD_STATUS_REFRESH_MS = 5_000;

export const dashboardTotalsRefresh = {
  refetchInterval: DASHBOARD_TOTALS_REFRESH_MS,
  refetchIntervalInBackground: false,
  staleTime: DASHBOARD_TOTALS_REFRESH_MS,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
} as const;

export const dashboardStatusRefresh = {
  refetchInterval: DASHBOARD_STATUS_REFRESH_MS,
  refetchIntervalInBackground: false,
} as const;