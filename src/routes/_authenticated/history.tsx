import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired page: no polling, subscriptions, exports, or worker reads.
export const Route = createFileRoute("/_authenticated/history")({
  beforeLoad: () => { throw redirect({ to: "/stats", replace: true }); },
});
