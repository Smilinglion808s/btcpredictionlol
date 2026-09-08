// C85 deployment/status read model.
//
// Backing data for the simple prediction/status view: which deployment bundle
// the serving worker is running, how fresh it is, what the worker last said,
// and the most recent decisions. No betting or bankroll logic lives here.

import { serviceClient, BUNDLE_BUCKET } from "./ops.server";
import { C85_MODEL_VERSION } from "./config";

export type C85Deployment = Record<string, any>;

export async function loadC85Deployment(): Promise<C85Deployment> {
  const supabase = serviceClient();
  const mv = C85_MODEL_VERSION;

  const [bundles, health, targets] = await Promise.all([
    supabase
      .from("c85_deployment_bundles")
      .select(
        "bundle_version,status,bundle_sha256,file_count,byte_size,checkpoint_utc," +
          "last_processed_target_utc,direction_fit_cutoff_utc,meta_fit_cutoff_utc," +
          "aux_fit_month,source_watermarks,created_at,activated_at,build_sha",
      )
      .eq("model_version", mv)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("c85_worker_health")
      .select("*")
      .eq("model_version", mv)
      .order("last_heartbeat_at", { ascending: false })
      .limit(4),
    supabase
      .from("c85_targets")
      .select(
        "ticker,target_open_utc,status,status_reason,run_mode,final_side," +
          "probability_yes,probability_correct,publication_offset_ms,deadline_met,published_at",
      )
      .eq("model_version", mv)
      .order("target_open_utc", { ascending: false })
      .limit(20),
  ]);

  const rows = bundles.data ?? [];
  const active = rows.find((b: any) => b.status === "ACTIVE") ?? null;
  const beats = health.data ?? [];
  const newest = beats[0] ?? null;

  const now = Date.now();
  const ageHours = active?.checkpoint_utc
    ? (now - new Date(active.checkpoint_utc).getTime()) / 3_600_000
    : null;
  const heartbeatAgeSeconds = newest?.last_heartbeat_at
    ? (now - new Date(newest.last_heartbeat_at).getTime()) / 1000
    : null;

  return {
    model_version: mv,
    bucket: BUNDLE_BUCKET,
    active_bundle: active,
    recent_bundles: rows,
    bundle_age_hours: ageHours == null ? null : Number(ageHours.toFixed(2)),
    worker: newest,
    workers: beats,
    heartbeat_age_seconds:
      heartbeatAgeSeconds == null ? null : Number(heartbeatAgeSeconds.toFixed(0)),
    readiness: newest?.readiness ?? "UNKNOWN",
    blocking_reason: newest?.blocking_reason ?? (active ? null : "no active deployment bundle"),
    betting_route: "suppressed (C85 is not in the webhook allow-list; T45 execution unchanged)",
    recent_targets: targets.data ?? [],
    at: new Date().toISOString(),
  };
}
