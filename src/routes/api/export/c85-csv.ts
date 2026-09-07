import { createFileRoute } from "@tanstack/react-router";
import { streamC85Csv } from "@/lib/c85/exportStream.server";

export const Route = createFileRoute("/api/export/c85-csv")({
  server: {
    handlers: {
      GET: async () => streamC85Csv(),
    },
  },
});
