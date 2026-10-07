/** Read-only, server-side adapter. Never forwards auth, cookies, worker errors, or arbitrary URLs. */
import { snapshotSchema, pageSchema, tradeSchema } from "./dot-paper/schema";
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
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<PaperReadResult<T>> {
  // Public, non-secret observer origin. An explicit empty override disables reads.
  const configured =
    process.env.DOT_PAPER_SERVICE_URL ??
    "https://dot-paper-worker-production.up.railway.app";
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
      // workerd supports only "manual"/"follow"; redirects must never be followed.
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    )
      return { ok: false, code: "SERVICE_UNAVAILABLE" };
    if (!response.ok) return { ok: false, code: "SERVICE_UNAVAILABLE" };
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) return { ok: false, code: "INVALID_PAPER_RESPONSE" };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, code: "SERVICE_UNAVAILABLE" };
  }
}
export const readPaperSnapshot = () => read("/api/v1/snapshot", snapshotSchema);
export const readPaperPage = (kind: "trades", before: number) => {
  // Defence in depth: this fixed read endpoint accepts no arbitrary URLs or collections.
  if (kind !== "trades" || !Number.isSafeInteger(before) || before < 0)
    return Promise.resolve({
      ok: false as const,
      code: "INVALID_PAPER_RESPONSE" as const,
    });
  return read(
    `/api/v1/trades?limit=50&before=${before}`,
    pageSchema(tradeSchema).extend({
      run_id: z.string().uuid(),
      provenance: z.literal("FORWARD"),
    }),
  );
};
