/** Read-only, server-side adapter. Never forwards auth, cookies, worker errors, or arbitrary URLs. */
import {
  snapshotSchema,
  pageSchema,
  tradeSchema,
  callSchema,
} from "./dot-paper/schema";
import { z } from "zod";
export type PaperReadResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code:
        | "SERVICE_NOT_CONFIGURED"
        | "SERVICE_UNAVAILABLE"
        | "INVALID_PAPER_RESPONSE";
    };
async function read<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<PaperReadResult<T>> {
  const configured = process.env.DOT_PAPER_SERVICE_URL;
  if (!configured) return { ok: false, code: "SERVICE_NOT_CONFIGURED" };
  try {
    const base = new URL(configured);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      return { ok: false, code: "SERVICE_NOT_CONFIGURED" };
    const url = new URL(path, base.origin);
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, code: "SERVICE_UNAVAILABLE" };
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) return { ok: false, code: "INVALID_PAPER_RESPONSE" };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, code: "SERVICE_UNAVAILABLE" };
  }
}
export const readPaperSnapshot = () => read("/api/v1/snapshot", snapshotSchema);
export const readPaperPage = (kind: "trades" | "calls", before: number) => {
  const path = `/api/v1/${kind}?limit=50&before=${before}`;
  return kind === "trades"
    ? read(
        path,
        pageSchema(tradeSchema).extend({
          run_id: z.string().uuid(),
          provenance: z.literal("FORWARD"),
        }),
      )
    : read(
        path,
        pageSchema(callSchema).extend({
          run_id: z.string().uuid(),
          provenance: z.literal("FORWARD"),
        }),
      );
};
