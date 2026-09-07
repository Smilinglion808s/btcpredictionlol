import { createServerFn } from "@tanstack/react-start";
import { runC85SelfCheck } from "@/lib/c85/selfcheck.server";

/** Signed, non-executing connectivity check against the deployed C85 endpoints. */
export const c85SelfCheck = createServerFn({ method: "POST" })
  .inputValidator((data: { origin?: string } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const origin =
      data.origin ?? "https://project--23a724c5-6c5b-4434-85e6-dc54b111c7e2.lovable.app";
    return runC85SelfCheck(origin);
  });
