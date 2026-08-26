import { createFileRoute } from "@tanstack/react-router";
import { streamPriceFlowCsv } from "@/lib/t45pf/exportStream.server";

export const Route = createFileRoute("/api/export/t45pf-csv")({
  server: {
    handlers: {
      GET: async () => streamPriceFlowCsv(),
    },
  },
});
