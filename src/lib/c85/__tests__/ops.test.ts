// C85 signed-endpoint integration tests.
//
// These run against the real backend database through the same operation layer
// the HTTP route uses, plus signature/replay checks on the auth scheme.

import { describe, expect, it, beforeAll } from "vitest";
import { createHmac } from "crypto";
import { claimNonce, runC85Op, serviceClient } from "../ops.server";
import { verifyC85Signature } from "../gateway.server";

const supabase = serviceClient();
const WORKER = "c85-test-worker";
const TICKER = `TEST-${Date.now()}`;
const OPEN = new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString();

function sign(secret: string, ts: string, body: string) {
  return createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

describe("C85 signature scheme", () => {
  beforeAll(() => {
    process.env.C85_GATEWAY_SECRET = "test-secret-value";
  });

  it("accepts a signature over the exact bytes", () => {
    const body = '{"op":"checkpoint.latest"}';
    const ts = String(Date.now());
    expect(verifyC85Signature(body, ts, sign("test-secret-value", ts, body))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = '{"op":"checkpoint.latest"}';
    const ts = String(Date.now());
    const sig = sign("test-secret-value", ts, body);
    expect(verifyC85Signature(body + " ", ts, sig)).toBe(false);
  });

  it("rejects a wrong secret and a stale timestamp", () => {
    const body = "{}";
    const ts = String(Date.now());
    expect(verifyC85Signature(body, ts, sign("other", ts, body))).toBe(false);
    const old = String(Date.now() - 120_000);
    expect(verifyC85Signature(body, old, sign("test-secret-value", old, body))).toBe(false);
  });
});

describe("C85 nonce replay protection", () => {
  it("burns a nonce exactly once", async () => {
    const nonce = `n-${Date.now()}-${Math.random()}`;
    expect(await claimNonce(supabase, nonce, "checkpoint.latest", WORKER)).toBe(true);
    expect(await claimNonce(supabase, nonce, "checkpoint.latest", WORKER)).toBe(false);
  });
});

describe("C85 operations", () => {
  it("acquires and renews scheduler ownership, and refuses a second owner", async () => {
    const key = `c85:test:${Date.now()}`;
    const a = await runC85Op(supabase, "worker-a", {
      op: "lease.acquire",
      lease_key: key,
      ttl_seconds: 30,
    });
    expect(a.status).toBe(200);
    const renew = await runC85Op(supabase, "worker-a", {
      op: "lease.acquire",
      lease_key: key,
      ttl_seconds: 30,
    });
    expect((renew.result.lease as Record<string, unknown>).renewed).toBe(true);
    const b = await runC85Op(supabase, "worker-b", {
      op: "lease.acquire",
      lease_key: key,
      ttl_seconds: 30,
    });
    expect(b.status).toBe(409);
    expect(b.result.ok).toBe(false);
  });

  it("commits a decision, checkpoint and outbox atomically and idempotently", async () => {
    const before = await runC85Op(supabase, WORKER, { op: "checkpoint.latest" });
    const parent = Number(
      ((before.result.checkpoint as Record<string, unknown>)?.checkpoint_seq as number) ?? 0,
    );

    const commit = await runC85Op(supabase, WORKER, {
      op: "decision.commit",
      target: {
        ticker: TICKER,
        target_open_utc: OPEN,
        deadline_utc: new Date(Date.parse(OPEN) + 5000).toISOString(),
        run_mode: "RESEARCH_BACKFILL",
        status: "ABSTAIN",
        final_side: 0,
        probability_yes: 0.5123,
        gate_reasons: { test: true },
      },
      checkpoint: {
        stage: "BRIDGE",
        state_sha256: "deadbeef",
        expected_parent_seq: parent,
      },
      outbox: {
        dedupe_key: `C85:test:${TICKER}`,
        payload: { test: true },
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(commit.status).toBe(200);
    expect(commit.result.ok).toBe(true);
    const seq = Number(
      ((commit.result.checkpoint as Record<string, unknown>).checkpoint_seq as number) ?? 0,
    );
    expect(seq).toBe(parent + 1);

    // Stale parent sequence (an interrupted / duplicated commit) is refused,
    // and the whole transaction rolls back — no duplicate decision row.
    const stale = await runC85Op(supabase, WORKER, {
      op: "decision.commit",
      target: {
        ticker: TICKER,
        target_open_utc: OPEN,
        deadline_utc: new Date(Date.parse(OPEN) + 5000).toISOString(),
        status: "ABSTAIN",
        final_side: 0,
        gate_reasons: { test: true },
      },
      checkpoint: { stage: "BRIDGE", expected_parent_seq: parent },
    });
    expect(stale.status).toBe(409);

    const after = await runC85Op(supabase, WORKER, { op: "checkpoint.latest" });
    expect(
      Number((after.result.checkpoint as Record<string, unknown>).checkpoint_seq),
    ).toBe(seq);

    const { data: rows } = await supabase
      .from("c85_targets")
      .select("id")
      .eq("ticker", TICKER);
    expect(rows?.length).toBe(1);

    const { data: outbox } = await supabase
      .from("c85_outbox")
      .select("dedupe_key")
      .eq("dedupe_key", `C85:test:${TICKER}`);
    expect(outbox?.length).toBe(1);
  });

  it("records and consumes settlements exactly once", async () => {
    await runC85Op(supabase, WORKER, {
      op: "settlements.record",
      settlements: [
        {
          ticker: TICKER,
          target_open_utc: OPEN,
          settlement_source: "TEST",
          official_result: "YES",
          label: 1,
          settlement_ts: OPEN,
        },
      ],
    });
    const pending = await runC85Op(supabase, WORKER, { op: "settlements.pending", limit: 500 });
    const mine = (pending.result.settlements as Array<Record<string, unknown>>).filter(
      (s) => s.ticker === TICKER,
    );
    expect(mine.length).toBe(1);
    const id = String(mine[0]!.id);

    const first = await runC85Op(supabase, WORKER, {
      op: "settlements.consume",
      settlement_ids: [id],
    });
    expect(first.result.consumed_count).toBe(1);
    const second = await runC85Op(supabase, WORKER, {
      op: "settlements.consume",
      settlement_ids: [id],
    });
    expect(second.result.consumed_count).toBe(0);
  });

  it("resumes from the newest checkpoint on bootstrap", async () => {
    const boot = await runC85Op(supabase, WORKER, { op: "state.bootstrap" });
    expect(boot.result.ok).toBe(true);
    expect(boot.result.checkpoint).toBeTruthy();
    expect(Array.isArray(boot.result.pending_settlements)).toBe(true);
  });

  it("cleans up its test rows", async () => {
    await supabase.from("c85_outbox").delete().eq("dedupe_key", `C85:test:${TICKER}`);
    await supabase.from("c85_settlements").delete().eq("ticker", TICKER);
    await supabase.from("c85_targets").delete().eq("ticker", TICKER);
    await supabase.from("c85_state_checkpoints").delete().eq("state_sha256", "deadbeef");
    expect(true).toBe(true);
  });
});
