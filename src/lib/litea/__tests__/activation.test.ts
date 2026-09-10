// Version 1 activation contract — proven against an in-process fake receiver.
// No network call is made anywhere in this file and no real endpoint is used.

import { describe, expect, it } from "vitest";
import {
  buildLiteAWebhookPayload,
  liteaDedupeKey,
  liteaExecutionEnabled,
  liteaExecutionGate,
} from "../webhook.server";
import { LITE_A_MODEL_VERSION, C85_PUBLICATION_DEADLINE_MS } from "@/lib/c85/config";
import { WEBHOOK_ALLOWED_MODELS } from "@/lib/webhooks.server";

const base = {
  ticker: "KXBTC15M-26SEP101300-00",
  targetOpenUtc: "2026-09-10T16:45:00.000Z",
  finalSide: 1 as const,
  probabilityYes: 0.621214338093465,
  admissionRank: 0.9765625,
  status: "ORDINARY_CALL",
  strike: 77250,
  strikeSource: "official",
  strikeEstimated: false,
  packetFreezeNs: "1789058704782770700",
  decisionDurableNs: "1789058705782770700",
  publicationOffsetMs: 3200,
};

/** Records what a bot WOULD receive. Purely local. */
function fakeReceiver() {
  const received: unknown[] = [];
  return {
    received,
    post: (payload: unknown) => {
      received.push(payload);
      return { status: 200 };
    },
  };
}

describe("Version 1 execution gates", () => {
  it("is disabled by default in this environment", () => {
    expect(liteaExecutionEnabled()).toBe(false);
  });

  it("excludes Version 1 from the outbound allow-list", () => {
    expect(WEBHOOK_ALLOWED_MODELS.has(LITE_A_MODEL_VERSION)).toBe(false);
  });

  it("refuses to send with today's live constants", () => {
    expect(
      liteaExecutionGate({
        executionEnabled: liteaExecutionEnabled(),
        allowedModels: WEBHOOK_ALLOWED_MODELS,
        runMode: "LIVE",
        finalSide: 1,
        publicationOffsetMs: 3200,
        publicationDeadlineMs: C85_PUBLICATION_DEADLINE_MS,
        alreadyDispatched: false,
      }),
    ).toBe("EXECUTION_DISABLED");
  });

  it("still refuses when only the environment switch is flipped", () => {
    expect(
      liteaExecutionGate({
        executionEnabled: true,
        allowedModels: WEBHOOK_ALLOWED_MODELS,
        runMode: "LIVE",
        finalSide: 1,
        publicationOffsetMs: 3200,
        publicationDeadlineMs: C85_PUBLICATION_DEADLINE_MS,
        alreadyDispatched: false,
      }),
    ).toBe("NOT_IN_ALLOWLIST");
  });

  it("blocks abstains, non-live rows, duplicates and late publication", () => {
    const allowed = new Set([LITE_A_MODEL_VERSION]);
    const g = (over: Partial<Parameters<typeof liteaExecutionGate>[0]>) =>
      liteaExecutionGate({
        executionEnabled: true,
        allowedModels: allowed,
        runMode: "LIVE",
        finalSide: 1,
        publicationOffsetMs: 3200,
        publicationDeadlineMs: C85_PUBLICATION_DEADLINE_MS,
        alreadyDispatched: false,
        ...over,
      });
    expect(g({ finalSide: 0 })).toBe("ABSTAIN");
    expect(g({ runMode: "RESEARCH_BACKFILL" })).toBe("NOT_LIVE");
    expect(g({ alreadyDispatched: true })).toBe("ALREADY_DISPATCHED");
    // Measured live Version 1 publication offsets are ~5.6-6.1s, i.e. past the
    // existing T+5s ceiling. This case is the real blocker, not a hypothetical.
    expect(g({ publicationOffsetMs: 5774 })).toBe("DEADLINE_MISSED");
    expect(g({ publicationOffsetMs: null })).toBe("DEADLINE_MISSED");
    expect(g({})).toBe("WOULD_SEND");
  });
});

describe("Version 1 payload contract (fake receiver only)", () => {
  it("delivers nothing while the gate refuses", () => {
    const bot = fakeReceiver();
    const verdict = liteaExecutionGate({
      executionEnabled: liteaExecutionEnabled(),
      allowedModels: WEBHOOK_ALLOWED_MODELS,
      runMode: "LIVE",
      finalSide: 1,
      publicationOffsetMs: 3200,
      publicationDeadlineMs: C85_PUBLICATION_DEADLINE_MS,
      alreadyDispatched: false,
    });
    if (verdict === "WOULD_SEND") bot.post(buildLiteAWebhookPayload(base));
    expect(bot.received).toHaveLength(0);
  });

  it("shapes the payload the bot already accepts", () => {
    const bot = fakeReceiver();
    bot.post(buildLiteAWebhookPayload(base));
    const p = bot.received[0] as Record<string, unknown>;
    expect(p.model).toBe(LITE_A_MODEL_VERSION);
    expect(p.prediction).toBe("YES");
    expect(p.direction).toBe("GREEN");
    expect(p.trade).toBe(true);
    expect(p.confidence).toBe(62);
    expect(p.candle_starts_at).toBe("2026-09-10T16:45:00.000Z");
    expect(p.candle_ends_at).toBe("2026-09-10T17:00:00.000Z");
    expect(p.dedupe_key).toBe(liteaDedupeKey(base.ticker, base.targetOpenUtc));
    expect(p.strike_estimated).toBe(false);
    // Fill price, fees and order ids are owned by the bot and never invented.
    expect(p).not.toHaveProperty("fill_price");
    expect(p).not.toHaveProperty("fees");
  });

  it("maps a short call to NO/RED with the complementary confidence", () => {
    const p = buildLiteAWebhookPayload({ ...base, finalSide: -1, probabilityYes: 0.3 });
    expect(p.prediction).toBe("NO");
    expect(p.direction).toBe("RED");
    expect(p.confidence).toBe(70);
  });

  it("keys dedupe one-per-interval-per-contract", () => {
    expect(liteaDedupeKey(base.ticker, base.targetOpenUtc)).not.toBe(
      liteaDedupeKey(base.ticker, "2026-09-10T17:00:00.000Z"),
    );
  });
});
