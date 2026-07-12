import { describe, it, expect } from "vitest";
import {
  decideModelC,
  blend,
  MODEL_C_CUTOFF,
} from "../decision";
import {
  verifyBootstrapFit,
  computeComponentArtifactSha256,
  getBootstrapFit,
  MODEL_C_EXPECTED_COMBINED_FIT_SHA256,
} from "../fit";

describe("Model C — bootstrap fit hash verification", () => {
  it("global_core_lr artifact_sha256 matches canonical JSON hash", async () => {
    const fit = getBootstrapFit();
    const actual = await computeComponentArtifactSha256(fit.global_core_lr);
    expect(actual).toBe(fit.global_core_lr.artifact_sha256);
  });

  it("recent_full_lr artifact_sha256 matches canonical JSON hash", async () => {
    const fit = getBootstrapFit();
    const actual = await computeComponentArtifactSha256(fit.recent_full_lr);
    expect(actual).toBe(fit.recent_full_lr.artifact_sha256);
  });

  it("stored combined_fit_sha256 matches spec-pinned constant", async () => {
    const result = await verifyBootstrapFit();
    expect(result.combined_ok).toBe(true);
    expect(result.combined_actual).toBe(MODEL_C_EXPECTED_COMBINED_FIT_SHA256);
    expect(result.ok).toBe(true);
  });
});

describe("Model C — decision layer", () => {
  it("override registry: NO CLEAR EDGE upstream + p=0.70 -> YES, override fires=false", () => {
    const r = decideModelC({
      p_global: 0.7,
      p_recent: 0.7,
      upstream_prediction: "NO CLEAR EDGE",
    });
    expect(r.final_decision).toBe("YES");
    const nce = r.override_reasons_json.find((o) => o.id === "upstream_no_clear_edge")!;
    expect(nce.fired).toBe(false);
    expect(nce.applied).toBe(false);
  });

  it("trending_expansion forces NO regardless of ensemble", () => {
    const r = decideModelC({
      p_global: 0.99,
      p_recent: 0.99,
      market_condition: "trending_expansion",
    });
    expect(r.final_decision).toBe("NO");
    const o = r.override_reasons_json.find((o) => o.id === "trending_expansion")!;
    expect(o.fired && o.applied).toBe(true);
  });

  it("failed_breakout_down forces NO regardless of ensemble", () => {
    const r = decideModelC({
      p_global: 0.9,
      p_recent: 0.9,
      failed_breakout_down: "true",
    });
    expect(r.final_decision).toBe("NO");
    const o = r.override_reasons_json.find((o) => o.id === "failed_breakout_down")!;
    expect(o.fired && o.applied).toBe(true);
  });

  it("blend math: 0.60 & 0.40 -> 0.50 -> base=NO (below 0.52 cutoff)", () => {
    expect(blend(0.6, 0.4)).toBeCloseTo(0.5, 10);
    const r = decideModelC({ p_global: 0.6, p_recent: 0.4 });
    expect(r.p_ensemble).toBeCloseTo(0.5, 10);
    expect(r.base_decision).toBe("NO");
    expect(r.final_decision).toBe("NO");
  });

  it("cutoff boundary: p=0.52 -> YES, p=0.5199 -> NO", () => {
    const yes = decideModelC({ p_global: 0.52, p_recent: 0.52 });
    expect(yes.p_ensemble).toBeCloseTo(0.52, 10);
    expect(yes.final_decision).toBe("YES");
    const no = decideModelC({ p_global: 0.5199, p_recent: 0.5199 });
    expect(no.final_decision).toBe("NO");
    expect(MODEL_C_CUTOFF).toBe(0.52);
  });

  it("no SKIP: every combination produces YES or NO", () => {
    const cases = [
      { p_global: 0, p_recent: 0 },
      { p_global: 1, p_recent: 1 },
      { p_global: 0.5, p_recent: 0.5 },
      { p_global: 0.51999999, p_recent: 0.52 },
    ];
    for (const c of cases) {
      const r = decideModelC(c);
      expect(["YES", "NO"]).toContain(r.final_decision);
    }
  });

  it("overrides only mark applied=true when they would flip a YES to NO", () => {
    // base=NO, trending fires but doesn't apply (no flip needed)
    const r = decideModelC({
      p_global: 0.3,
      p_recent: 0.3,
      market_condition: "trending_expansion",
    });
    expect(r.final_decision).toBe("NO");
    const o = r.override_reasons_json.find((o) => o.id === "trending_expansion")!;
    expect(o.fired).toBe(true);
    expect(o.applied).toBe(false);
  });
});
