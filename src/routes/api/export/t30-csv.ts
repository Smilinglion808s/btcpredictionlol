import { createFileRoute } from "@tanstack/react-router";
import { streamT30Csv } from "@/lib/t30/exportStream.server";

export const Route = createFileRoute("/api/export/t30-csv")({
  server: {
    handlers: {
      GET: async () => streamT30Csv(),
    },
  },
});
