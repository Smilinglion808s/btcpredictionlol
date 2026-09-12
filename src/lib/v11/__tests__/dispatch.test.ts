// Version 1.1 delivery adapter — local fake transport only. No network.
import { afterEach, describe, expect, it } from "vitest";
import {
  buildV11WebhookPayload,
  dispatchV11Fallback,
  evaluateV11Dispatch,
  v11DeliveryArmed,
  v11EventDedupeKey,
  type V11DecisionRecord,
  type V11DispatchDeps,
} from "../dispatch.server";
import { liteaDedupeKey } from "@/lib/litea/webhook.server";
import { isModelAllowedToSend } from "@/lib/webhooks.server";
import { V11_MODEL_VERSION } from "../config";
import { LITE_A_MODEL_VERSION } from "@/lib/c85/config";

const OPEN = "2026-09-12T04:00:00.000Z";
const NOW = new Date(OPEN).getTime() + 46_000;

const fallbackRow: V11DecisionRecord = {
  ticker: "KXBTCD-26SEP12H04-T1",
  target_ts: OPEN,
  run_mode: "LIVE",
  leg: "T45R2",
  side: 1,
  rank: 0.91,
  probability: 0.62,
  admission_gate: 0.55,
  reason: "V11_T45R2_FALLBACK_CALL",
  v1_final_side: 0,
  v1_reason: "CONFIDENCE_ABSTAIN",
  v1_floor_open: true,
  v1_send_claim: "none",
  decision_offset_ms: 45_600,
};

function fakeDeps(over: Partial<V11DispatchDeps> = {}) {
  const sent: Record<string, unknown>[] = [];
  const claims: string[] = [];
  const settles: { status: string }[] = [];
  const deps: V11DispatchDeps = {
    now: () => NOW,
    isEnabledNow: () => true,
    v1OffNow: () => true,
    async claim(e) {
      claims.push(e.dedupeKey);
      return { outcome: claims.length === 1 ? "CLAIMED" : "HELD_BY_OTHER" };
    },
    async ownsClaim() {
      return true;
    },
    async deliver(payload, guard) {
      if (!(await guard())) return { delivered: 0, sendStartedAtMs: null };
      sent.push(payload);
      return { delivered: 1, sendStartedAtMs: NOW };
    },
    async settle(e) {
      settles.push({ status: e.status });
      return { applied: true };
    },
    ...over,
  };
  return { deps, sent, claims, settles };
}

afterEach(() => {
  delete process.env['V11_SERVER_EXECUTION_ENABLED'];
  delete process.env['LITEA_SERVER_EXECUTION_ENABLED'];
});

describe("Version 1.1 delivery is off by default", () => {
  it("is not armed and not sender-allowed with no environment set", () => {
    expect(v11DeliveryArmed()).toBe(false);
    expect(isModelAllowedToSend(V11_MODEL_VERSION)).toBe(false);
    expect(isModelAllowedToSend(LITE_A_MODEL_VERSION)).toBe(false);
  });

  it("stays blocked while the original V1 sender is enabled", () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    expect(v11DeliveryArmed()).toBe(false);
    expect(isModelAllowedToSend(V11_MODEL_VERSION)).toBe(false);
  });

  it("is allowed only with V11 on AND V1 delivery off", () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    expect(v11DeliveryArmed()).toBe(true);
    expect(isModelAllowedToSend(V11_MODEL_VERSION)).toBe(true);
  });

  it("sends nothing at all with the control off", async () => {
    const { deps, sent, claims } = fakeDeps({ isEnabledNow: () => false });
    const res = await dispatchV11Fallback(deps, fallbackRow);
    expect(res.verdict).toBe("EXECUTION_DISABLED");
    expect(sent).toHaveLength(0);
    expect(claims).toHaveLength(0);
  });

  it("sends nothing while V1 delivery is still enabled", async () => {
    const { deps, sent } = fakeDeps({ v1OffNow: () => false });
    const res = await dispatchV11Fallback(deps, fallbackRow);
    expect(res.verdict).toBe("V1_DELIVERY_STILL_ENABLED");
    expect(sent).toHaveLength(0);
  });
});

describe("eligibility, once armed", () => {
  const armed = { nowMs: NOW, executionEnabled: true, v1DeliveryOff: true };

  it("admits only a LIVE T45R2 call at rank >= .80 inside 60s", () => {
    expect(evaluateV11Dispatch(fallbackRow, armed)).toBe("WOULD_SEND");
  });

  it("never sends a V1 leg, an abstention, research or recovery rows", () => {
    expect(evaluateV11Dispatch({ ...fallbackRow, leg: "V1" }, armed)).toBe("NOT_FALLBACK_LEG");
    expect(evaluateV11Dispatch({ ...fallbackRow, side: 0 }, armed)).toBe("ABSTAIN");
    expect(evaluateV11Dispatch({ ...fallbackRow, run_mode: "RESEARCH" }, armed)).toBe("NOT_LIVE");
    expect(evaluateV11Dispatch({ ...fallbackRow, run_mode: "RECOVERY" }, armed)).toBe("NOT_LIVE");
  });

  it("respects the ORIGINAL recorded V1 floor and exclusivity", () => {
    expect(evaluateV11Dispatch({ ...fallbackRow, v1_floor_open: false }, armed)).toBe(
      "V1_LEG_NOT_EXCLUSIVE",
    );
    expect(evaluateV11Dispatch({ ...fallbackRow, v1_final_side: 1 }, armed)).toBe(
      "V1_LEG_NOT_EXCLUSIVE",
    );
    expect(evaluateV11Dispatch({ ...fallbackRow, v1_send_claim: "sent" }, armed)).toBe(
      "V1_LEG_NOT_EXCLUSIVE",
    );
    expect(evaluateV11Dispatch({ ...fallbackRow, v1_reason: "FIT_UNAVAILABLE" }, armed)).toBe(
      "V1_LEG_NOT_EXCLUSIVE",
    );
  });

  it("rejects rank below .80 and anything past the 60s ceiling", () => {
    expect(evaluateV11Dispatch({ ...fallbackRow, rank: 0.79 }, armed)).toBe("BELOW_FALLBACK_RANK");
    expect(
      evaluateV11Dispatch(fallbackRow, { ...armed, nowMs: new Date(OPEN).getTime() + 60_000 }),
    ).toBe("EXPIRED");
  });
});

describe("one bet per interval across both legs", () => {
  it("uses the same canonical event key as the V1 leg", () => {
    expect(v11EventDedupeKey(String(fallbackRow.ticker), OPEN)).toBe(
      liteaDedupeKey(String(fallbackRow.ticker), OPEN),
    );
  });

  it("claims once and attempts once, then settles SENT", async () => {
    const { deps, sent, claims, settles } = fakeDeps();
    const res = await dispatchV11Fallback(deps, fallbackRow);
    expect(res.verdict).toBe("SENT");
    expect(claims).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(settles).toEqual([{ status: "SENT" }]);
  });

  it("a second concurrent request gets no attempt", async () => {
    const { deps, sent } = fakeDeps({
      async claim() {
        return { outcome: "HELD_BY_OTHER" };
      },
    });
    const res = await dispatchV11Fallback(deps, fallbackRow);
    expect(res.verdict).toBe("NOT_CLAIM_OWNER");
    expect(sent).toHaveLength(0);
  });

  it("a lost claim cancels the attempt and is never recorded as ours", async () => {
    const { deps, sent } = fakeDeps({
      async ownsClaim() {
        return false;
      },
      async settle() {
        return { applied: false };
      },
    });
    const res = await dispatchV11Fallback(deps, fallbackRow);
    expect(sent).toHaveLength(0);
    expect(res.verdict).toBe("OWNER_LOST");
  });
});

describe("payload", () => {
  it("carries the 4% metadata and leaves sizing to the external bot", () => {
    const p = buildV11WebhookPayload(fallbackRow);
    expect(p.model).toBe(V11_MODEL_VERSION);
    expect(p.leg).toBe("T45R2");
    expect(p.prediction).toBe("YES");
    expect(p.stake_fraction_of_boise_day_opening_principal).toBe(0.04);
    expect(p.sizing_owner).toBe("external-betting-bot");
    expect(p.dedupe_key).toBe(liteaDedupeKey(String(fallbackRow.ticker), OPEN));
  });
});
