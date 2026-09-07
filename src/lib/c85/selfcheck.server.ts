// C85 connectivity self-check.
//
// Runs entirely inside the backend, where C85_GATEWAY_SECRET already lives. It
// signs requests exactly like services/c85-worker (HMAC-SHA256 over
// "<timestamp>.<exact body bytes>") and reports status codes and parsed
// responses. The secret is never returned, logged or echoed.

import { createHmac, randomUUID } from "crypto";

export type ProbeResult = {
  name: string;
  url: string;
  status: number;
  ok: boolean;
  contentType: string | null;
  redirected: boolean;
  body: unknown;
  ms: number;
};

function sign(body: string, secret: string) {
  const ts = String(Date.now());
  return {
    "content-type": "application/json",
    "x-c85-timestamp": ts,
    "x-c85-signature": createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex"),
  };
}

async function probe(
  name: string,
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<ProbeResult> {
  const started = Date.now();
  const res = await fetch(url, { method: "POST", body, headers, redirect: "manual" });
  const text = await res.text();
  let parsed: unknown = text.slice(0, 400);
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep the truncated text so an HTML login page is visible as such */
  }
  return {
    name,
    url,
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get("content-type"),
    redirected: res.status >= 300 && res.status < 400,
    body: parsed,
    ms: Date.now() - started,
  };
}

export async function runC85SelfCheck(origin: string): Promise<{
  origin: string;
  secret_configured: boolean;
  ops_url: string;
  gateway_url: string;
  probes: ProbeResult[];
}> {
  const secret = process.env.C85_GATEWAY_SECRET ?? "";
  const opsUrl = `${origin}/api/public/hooks/c85-ops`;
  const gatewayUrl = `${origin}/api/public/hooks/c85-decision`;
  const probes: ProbeResult[] = [];

  if (!secret) {
    return {
      origin,
      secret_configured: false,
      ops_url: opsUrl,
      gateway_url: gatewayUrl,
      probes,
    };
  }

  // 1. Valid signature, checkpoint read.
  const cpBody = JSON.stringify({
    op: "checkpoint.latest",
    worker_id: "selfcheck",
    nonce: randomUUID().replace(/-/g, ""),
  });
  probes.push(await probe("ops.checkpoint.latest/valid", opsUrl, cpBody, sign(cpBody, secret)));

  // 2. Invalid signature must be rejected.
  const badBody = JSON.stringify({
    op: "checkpoint.latest",
    worker_id: "selfcheck",
    nonce: randomUUID().replace(/-/g, ""),
  });
  probes.push(
    await probe("ops.checkpoint.latest/bad-signature", opsUrl, badBody, {
      "content-type": "application/json",
      "x-c85-timestamp": String(Date.now()),
      "x-c85-signature": "0".repeat(64),
    }),
  );

  // 3. Missing signature headers entirely.
  probes.push(
    await probe("ops.checkpoint.latest/unsigned", opsUrl, badBody, {
      "content-type": "application/json",
    }),
  );

  // 4. Replay: reuse a nonce that was already burned.
  const replayHeaders = sign(cpBody, secret);
  probes.push(await probe("ops.checkpoint.latest/replayed-nonce", opsUrl, cpBody, replayHeaders));

  // 5. Bootstrap read (checkpoint + fits + settlements + recent base calls).
  const bootBody = JSON.stringify({
    op: "state.bootstrap",
    worker_id: "selfcheck",
    nonce: randomUUID().replace(/-/g, ""),
  });
  probes.push(await probe("ops.state.bootstrap/valid", opsUrl, bootBody, sign(bootBody, secret)));

  // 6. Non-executing decision-gateway integration check. dry_run writes nothing.
  const dryBody = JSON.stringify({
    worker_id: "selfcheck",
    ticker: "SELFCHECK-NOOP",
    target_open_utc: new Date(Math.floor(Date.now() / 900_000) * 900_000).toISOString(),
    run_mode: "LIVE",
    status: "INTEGRATION_CHECK",
    final_side: 1,
    decision: {},
    timing: {},
    dry_run: true,
  });
  probes.push(await probe("gateway.decision/dry-run", gatewayUrl, dryBody, sign(dryBody, secret)));

  // 7. Gateway rejects an unsigned decision.
  probes.push(
    await probe("gateway.decision/unsigned", gatewayUrl, dryBody, {
      "content-type": "application/json",
    }),
  );

  return { origin, secret_configured: true, ops_url: opsUrl, gateway_url: gatewayUrl, probes };
}
