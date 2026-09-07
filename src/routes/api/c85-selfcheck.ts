// Diagnostic route: signed, non-executing C85 endpoint check.
// Not under /api/public, so the published site's auth protects it. It returns
// status codes and parsed responses only — never the shared secret.

import { createFileRoute } from "@tanstack/react-router";
import { runC85SelfCheck } from "@/lib/c85/selfcheck.server";

export const Route = createFileRoute("/api/c85-selfcheck")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin =
          url.searchParams.get("origin") ??
          "https://project--23a724c5-6c5b-4434-85e6-dc54b111c7e2.lovable.app";
        return Response.json(await runC85SelfCheck(origin));
      },
    },
  },
});
