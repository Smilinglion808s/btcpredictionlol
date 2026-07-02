import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Public cron endpoint hit hourly by pg_cron.
// Snapshots the current 24h stats into model_stats_archive and wipes predictions
// only when the local hour in America/New_York is 22 (10:00 PM ET).
// This avoids DST drift when scheduling in UTC.
export const Route = createFileRoute("/api/public/hooks/daily-archive")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        let force = false;
        try {
          const body = (await request.json()) as { force?: boolean } | null;
          force = body?.force === true;
        } catch {
          // empty body ok
        }

        // Gate on America/New_York hour == 22 unless force=true.
        const etHour = Number(
          new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            hour: "numeric",
            hour12: false,
          }).format(new Date()),
        );
        if (!force && etHour !== 22) {
          return Response.json({ skipped: true, et_hour: etHour });
        }

        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        // Read stats + active model version.
        const [{ data: statsData, error: statsErr }, { data: settings }] = await Promise.all([
          supabase.rpc("prediction_stats"),
          supabase
            .from("model_settings")
            .select("model_version")
            .eq("is_active", true)
            .maybeSingle(),
        ]);
        if (statsErr) {
          return Response.json({ error: statsErr.message }, { status: 500 });
        }
        const s = (statsData ?? {}) as Record<string, unknown>;
        const total = Number(s.total ?? 0);

        // Nothing to archive — still return ok.
        if (total === 0) {
          return Response.json({ archived: false, reason: "no predictions to archive" });
        }

        const modelVersion = settings?.model_version ?? "unknown";
        const wins = Number(s.wins ?? 0);
        const losses = Number(s.losses ?? 0);
        const pushes = Number(s.pushes ?? 0);
        const pending = Number(s.pending ?? 0);
        const winRate = Number(s.overall_win_rate ?? 0);
        const avgConf = Number(s.avg_confidence ?? 0);

        const { error: insertErr } = await supabase.from("model_stats_archive").insert({
          model_version: modelVersion,
          total,
          wins,
          losses,
          pushes,
          pending,
          win_rate: winRate,
          avg_confidence: avgConf,
          stats: s as never,
        });
        if (insertErr) {
          return Response.json({ error: insertErr.message }, { status: 500 });
        }

        // Copy predictions into the archive (preserves History CSV) before wiping.
        const { data: toArchive, error: fetchErr } = await supabase
          .from("predictions")
          .select("*");
        if (fetchErr) {
          return Response.json({ error: fetchErr.message, archived: true }, { status: 500 });
        }
        if (toArchive && toArchive.length > 0) {
          const { error: copyErr } = await supabase
            .from("predictions_archive")
            .upsert(toArchive, { onConflict: "id" });
          if (copyErr) {
            return Response.json({ error: copyErr.message, archived: true }, { status: 500 });
          }
        }

        // Wipe predictions to start a fresh 24h window.
        const { error: delErr } = await supabase
          .from("predictions")
          .delete()
          .not("id", "is", null);
        if (delErr) {
          return Response.json({ error: delErr.message, archived: true }, { status: 500 });
        }

        return Response.json({ archived: true, model_version: modelVersion, total, wins, losses });
      },
    },
  },
});
