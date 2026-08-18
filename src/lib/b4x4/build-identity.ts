// Build / deployment identity stamped onto every new B4x4 row so that a
// preview build can never be mistaken for the published production build.

/** Bumped by hand whenever the B4x4 runtime is intentionally re-published. */
export const B4X4_BUILD_STAMP = "b4x4-es1-dual-adaptive-r1-readiness-handoff-build2";

/**
 * Preview hosts served by Lovable. Anything else that is a real https host is
 * treated as production, so a published deployment can never stamp "preview".
 */
function environmentFromHost(host: string | null): string | null {
  if (!host) return null;
  const h = host.toLowerCase();
  if (h.startsWith("localhost") || h.startsWith("127.0.0.1")) return "development";
  if (h.startsWith("id-preview--") || h.includes("-dev.lovable.app") || h.includes(".lovableproject.com")) {
    return "preview";
  }
  return "production";
}

let _requestHost: string | null = null;

/**
 * Recorded by the scheduled hook routes at the start of each run. The edge
 * runtime does not expose NODE_ENV, so the serving host is the only reliable
 * production/preview discriminator.
 */
export function setB4x4RequestHost(host: string | null | undefined): void {
  _requestHost = host && host.length > 0 ? host : null;
}

export function b4x4RequestHost(): string | null {
  return _requestHost;
}

export interface B4x4BuildIdentity {
  build_identifier: string;
  build_commit_sha: string | null;
  deploy_environment: string;
}

/** Read at call time (env is injected per-request on the edge runtime). */
export function b4x4BuildIdentity(): B4x4BuildIdentity {
  const env: Record<string, string | undefined> =
    typeof process !== "undefined" && process.env ? (process.env as Record<string, string | undefined>) : {};
  const sha =
    env["LOVABLE_GIT_SHA"] ?? env["CF_PAGES_COMMIT_SHA"] ?? env["GIT_COMMIT_SHA"] ?? env["VERCEL_GIT_COMMIT_SHA"] ?? null;
  const id =
    env["LOVABLE_BUILD_ID"] ?? env["CF_VERSION_ID"] ?? env["CF_PAGES_DEPLOYMENT_ID"] ?? sha ?? B4X4_BUILD_STAMP;
  const environment =
    env["LOVABLE_DEPLOY_ENV"] ??
    env["DEPLOY_ENVIRONMENT"] ??
    environmentFromHost(_requestHost) ??
    (env["NODE_ENV"] === "production" ? "production" : "preview");
  return {
    build_identifier: `${B4X4_BUILD_STAMP}:${id}`,
    build_commit_sha: sha,
    deploy_environment: environment,
  };
}
