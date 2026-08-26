import { createFileRoute } from "@tanstack/react-router";
import { streamT10Csv } from "@/lib/t10/exportStream.server";

export const Route = createFileRoute("/api/export/t10-csv")({
  server: {
    handlers: {
      GET: async () => streamT10Csv(),
    },
  },
});
