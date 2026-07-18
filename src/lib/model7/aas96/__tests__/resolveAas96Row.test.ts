import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAas96Row } from "../orchestrator";

/** Minimal SupabaseClient mock capturing the shadow update payload. */
function makeSb(row: Record<string, unknown>) {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const stored: Record<string, unknown> = { ...row };
  const from = (table: string) => ({
    select: (_cols: string) => ({
      eq: (_c: string, _v: unknown) => ({
        maybeSingle: async () =>
          table === "model7_aas96_shadow"
            ? { data: stored, error: null }
            : { data: null, error: null },
      }),
      in: (_c: string, _v: unknown[]) => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: async (_c: string, _v: unknown) => {
        updates.push({ table, patch });
        // Simulate row-store mutation for the shadow table so we can later
        // assert the veto/horizon columns were never included in the patch.
        if (table === "model7_aas96_shadow") Object.assign(stored, patch);
        return { data: null, error: null };
      },
    }),
    insert: async () => ({ data: null, error: null }),
    upsert: async () => ({ data: null, error: null }),
  });
  return { sb: { from } as unknown as SupabaseClient, updates, stored };
}

const BASE_ROW = {
  id: "shadow-1",
  final_prediction: "GREEN",
  baseline_prediction: "GREEN",
  published_prediction: "GREEN",
  cleanup_veto_v1_fired: false,
  layer_a_final_direction: "GREEN",
  layer_b_final_direction: "GREEN",
  status: "pending",
  eligibility_passed: true,
  skip_reason: null,
  usable_training_row: null,
  // Immutable fields resolver must NOT overwrite:
  cleanup_veto_v1_evaluable: true,
  cleanup_veto_v1_reason: null,
  cleanup_veto_v1_conflict_subtype: null,
  layer_b_h32_score: 0.42,
  layer_b_h64_score: -0.11,
  layer_b_h96_score: 0.55,
  layer_b_h192_score: 0.33,
  layer_b_horizon_pattern: "GRGG",
};

describe("resolveAas96Row — counterfactual grading + immutability", () => {
  it("baseline directional LOSS + veto fired → avoided_loss=true, net_effect=+1", async () => {
    const { sb, updates } = makeSb({
      ...BASE_ROW,
      baseline_prediction: "GREEN",
      published_prediction: "ABSTAIN",
      cleanup_veto_v1_fired: true,
    });
    await resolveAas96Row(sb, "pred-1", "RED"); // baseline wrong → would lose
    const patch = updates.find((u) => u.table === "model7_aas96_shadow")!.patch;
    expect(patch.baseline_would_win).toBe(false);
    expect(patch.baseline_would_lose).toBe(true);
    expect(patch.veto_avoided_loss).toBe(true);
    expect(patch.veto_sacrificed_win).toBe(false);
    expect(patch.veto_net_effect).toBe(1);
    expect(patch.result).toBe("skip"); // ABSTAIN publishes no W/L
  });

  it("baseline directional WIN + veto fired → sacrificed_win=true, net_effect=-1", async () => {
    const { sb, updates } = makeSb({
      ...BASE_ROW,
      baseline_prediction: "GREEN",
      published_prediction: "ABSTAIN",
      cleanup_veto_v1_fired: true,
    });
    await resolveAas96Row(sb, "pred-2", "GREEN"); // baseline correct
    const patch = updates.find((u) => u.table === "model7_aas96_shadow")!.patch;
    expect(patch.baseline_would_win).toBe(true);
    expect(patch.baseline_would_lose).toBe(false);
    expect(patch.veto_avoided_loss).toBe(false);
    expect(patch.veto_sacrificed_win).toBe(true);
    expect(patch.veto_net_effect).toBe(-1);
  });

  it("veto did NOT fire → avoided=false, sacrificed=false, net_effect=0", async () => {
    const { sb, updates } = makeSb({
      ...BASE_ROW,
      baseline_prediction: "GREEN",
      published_prediction: "GREEN",
      cleanup_veto_v1_fired: false,
    });
    await resolveAas96Row(sb, "pred-3", "RED");
    const patch = updates.find((u) => u.table === "model7_aas96_shadow")!.patch;
    expect(patch.veto_avoided_loss).toBe(false);
    expect(patch.veto_sacrificed_win).toBe(false);
    expect(patch.veto_net_effect).toBe(0);
    expect(patch.result).toBe("loss"); // published GREEN vs actual RED
  });

  it("published ABSTAIN contributes zero to published W/L (result=skip)", async () => {
    const { sb, updates } = makeSb({
      ...BASE_ROW,
      baseline_prediction: "RED",
      published_prediction: "ABSTAIN",
      cleanup_veto_v1_fired: true,
    });
    await resolveAas96Row(sb, "pred-4", "GREEN");
    const patch = updates.find((u) => u.table === "model7_aas96_shadow")!.patch;
    expect(patch.result).toBe("skip");
    // Baseline (RED) would also lose vs GREEN → veto avoided a loss.
    expect(patch.veto_net_effect).toBe(1);
  });

  it("resolver never rewrites veto decision, horizon scores, or baseline/published prediction", async () => {
    const { sb, updates, stored } = makeSb({
      ...BASE_ROW,
      baseline_prediction: "GREEN",
      published_prediction: "ABSTAIN",
      cleanup_veto_v1_fired: true,
    });
    await resolveAas96Row(sb, "pred-5", "RED");
    const patch = updates.find((u) => u.table === "model7_aas96_shadow")!.patch;
    const forbidden = [
      "baseline_prediction",
      "published_prediction",
      "cleanup_veto_v1_fired",
      "cleanup_veto_v1_evaluable",
      "cleanup_veto_v1_reason",
      "cleanup_veto_v1_conflict_subtype",
      "layer_b_h32_score",
      "layer_b_h64_score",
      "layer_b_h96_score",
      "layer_b_h192_score",
      "layer_b_horizon_pattern",
      "layer_a_final_direction",
      "layer_b_final_direction",
      "layer_a_prob_l003",
      "layer_a_prob_l010",
      "layer_a_prob_mean",
      "selected_layer",
      "armor_override_fired",
    ];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(patch, key)).toBe(false);
    }
    // Stored row retains original veto decision + horizon scores unchanged.
    expect(stored.cleanup_veto_v1_fired).toBe(true);
    expect(stored.cleanup_veto_v1_conflict_subtype).toBe(null);
    expect(stored.layer_b_h32_score).toBe(0.42);
    expect(stored.layer_b_h64_score).toBe(-0.11);
    expect(stored.layer_b_h96_score).toBe(0.55);
    expect(stored.layer_b_h192_score).toBe(0.33);
    expect(stored.layer_b_horizon_pattern).toBe("GRGG");
    expect(stored.baseline_prediction).toBe("GREEN");
    expect(stored.published_prediction).toBe("ABSTAIN");
    // Patch only touches outcome fields.
    const allowed = new Set([
      "actual_direction", "result", "status", "usable_training_row",
      "baseline_would_win", "baseline_would_lose",
      "veto_avoided_loss", "veto_sacrificed_win", "veto_net_effect",
      "selector_b_confirmation_v1_would_win",
      "selector_b_confirmation_v1_would_lose",
      "selector_b_confirmation_v1_net_effect",
      "resolved_at", "updated_at",
    ]);
    for (const k of Object.keys(patch)) expect(allowed.has(k)).toBe(true);
  });
});
