// One-shot preload endpoint for AAS96: seeds resolved_directional_count from
// existing predictions/archive and forces an initial training fit so the
// model exits WARMUP without waiting for 192 live resolutions.
//
// GET /api/public/hooks/aas96-preload
//
// Idempotent: safe to call repeatedly. Uses SUPABASE_SERVICE_ROLE_KEY for
// admin state seeding, then runs the standard maybeTrainAas96 pipeline.

import { createFileRoute } from "@tanstack/react-router";

async function handler() {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Count resolved directional rows in live + archive.
    async function countResolved(table: string): Promise<number> {
      const { count } = await sb
        .from(table as never)
        .select("id", { count: "exact", head: true })
        .in("status", ["win", "loss"]);
      return count ?? 0;
    }
    const [live, arch] = await Promise.all([
      countResolved("predictions"),
      countResolved("predictions_archive"),
    ]);
    const total = live + arch;

    // Upsert state row with seeded counter. Reset next_retrain_at_count
    // so maybeTrainAas96 fires immediately.
    await sb.from("model7_aas96_state").upsert(
      {
        id: 1,
        resolved_directional_count: total,
        next_retrain_at_count: 192,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "id" },
    );

    // Run training.
    const { maybeTrainAas96 } = await import("@/lib/model7/aas96/train");
    const fitId = await maybeTrainAas96(sb);

    // Refresh state to report back.
    const { data: state } = await sb
      .from("model7_aas96_state")
      .select("resolved_directional_count, next_retrain_at_count, last_training_at")
      .eq("id", 1)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        ok: true,
        seeded_from: { live, archive: arch, total },
        fit_id: fitId,
        state,
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : null,
      }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/public/hooks/aas96-preload")({
  server: { handlers: { GET: handler, POST: handler } },
});
