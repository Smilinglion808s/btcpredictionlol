import { createHmac } from "crypto";
import { describe, expect, it, vi } from "vitest";
import {
  resolveT10IngestSecret,
  usableSecret,
  verifyT10Signature,
} from "../signingSecret.server";

describe("application-side T10 secret handling", () => {
  it("matches collector precedence and unresolved-reference rejection", () => {
    expect(resolveT10IngestSecret({
      T10_INGEST_SECRET: "${{BROKEN}}",
      BINANCE_OB_INGEST_SECRET: "shared",
    })).toEqual({ value: "shared", source: "BINANCE_OB_INGEST_SECRET" });
    expect(usableSecret(" dedicated ")).toBe("dedicated");
  });

  it("accepts the exact signed body and rejects an invalid signature", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_787_749_200_000);
    const timestamp = "1787749200000";
    const body = '{"collector_version":"fixture","samples":[]}';
    const secret = "shared";
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const env = {
      T10_INGEST_SECRET: "${{BROKEN}}",
      BINANCE_OB_INGEST_SECRET: secret,
    };

    expect(verifyT10Signature(body, timestamp, signature, 300_000, env)).toBe(true);
    expect(verifyT10Signature(body, timestamp, "invalid", 300_000, env)).toBe(false);
    vi.restoreAllMocks();
  });
});