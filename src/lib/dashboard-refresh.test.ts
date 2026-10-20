import { describe, expect, it } from "vitest";
import { dashboardStatusRefresh, dashboardTotalsRefresh } from "./dashboard-refresh";

describe("approved dashboard-only refresh budget", () => {
  it("checks historical totals every two minutes", () => {
    expect(dashboardTotalsRefresh.refetchInterval).toBe(120_000);
    expect(dashboardTotalsRefresh.staleTime).toBe(120_000);
  });
  it("checks live display status every five seconds", () => {
    expect(dashboardStatusRefresh.refetchInterval).toBe(5_000);
  });
  it("does not poll totals or status in the background", () => {
    expect(dashboardTotalsRefresh.refetchIntervalInBackground).toBe(false);
    expect(dashboardStatusRefresh.refetchIntervalInBackground).toBe(false);
  });
  it("does not reload historical totals just for window focus", () => {
    expect(dashboardTotalsRefresh.refetchOnWindowFocus).toBe(false);
  });
});
