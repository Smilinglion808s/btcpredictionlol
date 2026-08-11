// Build / deployment identity stamped onto every new B4x4 row so that a
// preview build can never be mistaken for the published production build.

/** Bumped by hand whenever the B4x4 runtime is intentionally re-published. */
export const B4X4_BUILD_STAMP = "b4x4-v1-runtime-integrity-r1-build1";

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
    (env["NODE_ENV"] === "production" ? "production" : "preview");
  return {
    build_identifier: `${B4X4_BUILD_STAMP}:${id}`,
    build_commit_sha: sha,
    deploy_environment: environment,
  };
}
