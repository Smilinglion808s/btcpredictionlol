import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { V2Card } from "../v2-card";

const now = Date.parse("2026-09-29T06:00:20.000Z");
const open = "2026-09-29T06:00:00.000Z";
const rt = (status: any) => [{ worker_id: "w", updated_at: new Date(now - 5000).toISOString(), status }];
const t8 = { candle_open: open, checkpoint: "T8", sleeve: "v2-direction8-r1", side: 0, eligible: false, features_ready: true, reason: null, sleeve_name: "ABSTAIN", receipt_latency_ms: 80 };

describe("V2Card (read-only mock records)", () => {
  it("shows real readiness fields, never 'unknown', and betting off", () => {
    const html = renderToStaticMarkup(<V2Card error={false} data={{ serverNow: now, checkpoints: [t8], intents: [],
      runtime: rt({ prediction_ready: true, feed_ready: true, feed_age_ms: 400, history_ready: true, history_bars: 80160,
        preopen_target: open, model_valid_until: "2026-10-12T00:00:00+00:00", refit_required: false, execution: "OFF" }) }} />);
    expect(html).toContain("Ready to predict");
    expect(html).toContain("fresh · 0.4s");
    expect(html).toContain("2026-10-12");
    expect(html).toContain("waiting for 45s");
    expect(html).toContain("Execution off");
    expect(html).toContain("capped at $200");
    expect(html).not.toContain("unknown");
  });
  it("heartbeat-only worker is not shown as ready; failed T8 blocks 45s", () => {
    const html = renderToStaticMarkup(<V2Card error={false} data={{ serverNow: now, intents: [],
      checkpoints: [{ ...t8, features_ready: false, reason: "CHECKPOINT_LATE" }],
      runtime: rt({ prediction_ready: false, feed_ready: false, refit_required: true, model_valid_until: "2026-10-12T00:00:00+00:00", preopen_target: "2026-09-29T05:45:00.000Z" }) }} />);
    expect(html).toContain("Connected · not ready");
    expect(html).toContain("refit required");
    expect(html).toContain("stale target");
    expect(html).toContain("blocked · 8s not scored");
  });
});
