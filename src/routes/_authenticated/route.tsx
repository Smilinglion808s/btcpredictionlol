import { createFileRoute, Outlet } from "@tanstack/react-router";

// Public layout (no auth). Folder name kept to avoid route churn.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: () => <Outlet />,
});
