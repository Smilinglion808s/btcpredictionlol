// C85 gateway — HMAC verification for worker-posted decisions.
//
// The worker holds C85_GATEWAY_SECRET and signs "<timestamp>.<rawBody>" with
// HMAC-SHA256. Verification is constant-time and rejects stale timestamps, so a
// captured decision cannot be replayed into a later candle.

import { createHmac, timingSafeEqual } from "crypto";

const MAX_SKEW_MS = 60_000;

export function verifyC85Signature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  maxSkewMs = MAX_SKEW_MS,
): boolean {
  const secret = process.env.C85_GATEWAY_SECRET;
  if (!secret || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > maxSkewMs) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
