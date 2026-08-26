import { createHmac, timingSafeEqual } from "crypto";

export function usableSecret(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized) return null;

  if (
    normalized.includes("${{") ||
    normalized.startsWith("${") ||
    normalized.endsWith("}}")
  ) {
    return null;
  }

  return normalized;
}

export function resolveT10IngestSecret(
  env: Record<string, string | undefined> = process.env,
): { value: string; source: "T10_INGEST_SECRET" | "BINANCE_OB_INGEST_SECRET" } | null {
  const dedicated = usableSecret(env.T10_INGEST_SECRET);
  if (dedicated) return { value: dedicated, source: "T10_INGEST_SECRET" };

  const shared = usableSecret(env.BINANCE_OB_INGEST_SECRET);
  if (shared) return { value: shared, source: "BINANCE_OB_INGEST_SECRET" };

  return null;
}

export function verifyT10Signature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  maxSkewMs: number,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const resolved = resolveT10IngestSecret(env);
  if (!resolved || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > maxSkewMs) return false;
  const expected = createHmac("sha256", resolved.value)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}