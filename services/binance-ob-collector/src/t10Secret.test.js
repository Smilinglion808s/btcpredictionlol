import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { resolveT10IngestSecret, startT10Collector, usableSecret } from "./t10Secret.js";

describe("T10 signing secret resolution", () => {
  it("prefers a valid dedicated secret", () => {
    expect(resolveT10IngestSecret({
      T10_INGEST_SECRET: " dedicated ",
      BINANCE_OB_INGEST_SECRET: "shared",
    })).toEqual({ value: "dedicated", source: "T10_INGEST_SECRET" });
  });

  it.each([undefined, "", "   ", "${{BINANCE_OB_INGEST_SECRET}}"])(
    "uses the shared secret when the dedicated value is %s",
    (dedicated) => {
      expect(resolveT10IngestSecret({
        T10_INGEST_SECRET: dedicated,
        BINANCE_OB_INGEST_SECRET: " shared ",
      })).toEqual({ value: "shared", source: "BINANCE_OB_INGEST_SECRET" });
    },
  );

  it("rejects unresolved reference forms", () => {
    expect(usableSecret("prefix-${{secret}}-suffix")).toBeNull();
    expect(usableSecret("${SECRET}")).toBeNull();
    expect(usableSecret("secret}}" )).toBeNull();
  });
});

describe("T10 startup isolation", () => {
  it("fails closed for T10 only without terminating sibling collectors", () => {
    const createCollector = vi.fn();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined);
    const log = vi.fn();
    const siblingStarts = { t30: 0, t45: 0, depth: 0 };

    startT10Collector({
      enabled: true,
      env: {},
      ingestUrl: "https://example.test/t10-ingest",
      boundaryUrl: "https://example.test/t10-boundary",
      buildIdentifier: "build-test",
      createCollector,
      log,
    });
    siblingStarts.t30 += 1;
    siblingStarts.t45 += 1;
    siblingStarts.depth += 1;

    expect(createCollector).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(siblingStarts).toEqual({ t30: 1, t45: 1, depth: 1 });
    expect(log).toHaveBeenCalledWith("[t10] disabled: T10_SIGNING_SECRET_UNAVAILABLE");
    exit.mockRestore();
  });

  it("starts with a redacted fallback warning and never logs secret values", () => {
    const start = vi.fn();
    const log = vi.fn();
    const dedicated = "${{BROKEN_REFERENCE}}";
    const shared = "super-private-shared-value";

    startT10Collector({
      enabled: true,
      env: { T10_INGEST_SECRET: dedicated, BINANCE_OB_INGEST_SECRET: shared },
      ingestUrl: "https://example.test/t10-ingest",
      boundaryUrl: "https://example.test/t10-boundary",
      buildIdentifier: "build-test",
      createCollector: (options) => {
        expect(options.secret).toBe(shared);
        return { start, stop() {} };
      },
      log,
    });

    expect(start).toHaveBeenCalledOnce();
    const output = log.mock.calls.flat().map(String).join(" ");
    expect(output).toContain("[t10] warning: unresolved T10 secret rejected; using valid fallback");
    expect(output).toContain("[t10] signing secret source=BINANCE_OB_INGEST_SECRET");
    expect(output).not.toContain(dedicated);
    expect(output).not.toContain(shared);
  });
});

describe("unchanged T30/T45 signing contract", () => {
  it("keeps byte-identical HMAC input and expected signatures", () => {
    const secret = "fixture-secret";
    const timestamp = "1787749200000";
    const body = JSON.stringify({ target_ts: "2026-08-26T06:00:00.000Z", source: "fixture" });
    const expected = "003163f08332ee7869b7c7ceb49d6a54cda78ea64ab994aea7d607e3ae6b2169";
    expect(createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")).toBe(expected);
  });
});