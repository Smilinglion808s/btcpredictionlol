import type { SupabaseClient } from "@supabase/supabase-js";
import type { createOwnerControlRouter } from "./lib/owner-control-server/router.server";
import { controlUnavailableResponse } from "./control-unavailable.server";
import { existingPublicEnvironment, ownerPublicConfig, type PublicEnvironment } from "./owner-public-config.server";
import { reviewedCallbackProtocol, reviewedOwnerApiPolicy } from "./lib/owner-review-capabilities";

type Installation = NonNullable<Parameters<typeof createOwnerControlRouter>[0]>;
type RouterFactory = typeof createOwnerControlRouter;
type InstallationLoader = () => Promise<Installation | undefined>;

/** This loader is invoked only inside the reserved API namespace. It reads only
 * existing PUBLIC configuration, then imports the existing server-only accessor.
 * Owner identity, policy, minimum assurance and destination are review-pinned.
 * Construction does not read the admin Proxy, enroll a session, or fetch anything.
 */
export function createDeployedOwnerControlInstallation(
  readPublic: () => PublicEnvironment = existingPublicEnvironment,
  loadAdmin: () => Promise<{ supabaseAdmin: SupabaseClient }> = () => import("./integrations/supabase/client.server"),
): InstallationLoader {
  return async () => {
    const publicConfig = ownerPublicConfig(readPublic(), reviewedCallbackProtocol, reviewedOwnerApiPolicy);
    if (!publicConfig || publicConfig.ownerApiPolicyRevision !== "app-session-jwt-age300-v1") return undefined;
    // Keep the Proxy inside its module object: awaiting the Proxy itself probes
    // .then and would accidentally initialize the generated admin client.
    const { supabaseAdmin } = await loadAdmin();
    return {
      config: {
        ownerSubject: "2c96b715-edc6-48bf-aead-583f671ec04c",
        policyRevision: "app-session-jwt-age300-v1",
        minimumAal: "aal1",
      },
      publicKey: publicConfig.publishableKey,
      serviceOrigin: "https://owner-control-api-controls-pilot.up.railway.app",
      getExistingAdmin: () => supabaseAdmin,
    };
  };
}
export const deployedOwnerControlInstallation = createDeployedOwnerControlInstallation();

/** One initialization attempt per worker instance, shared by concurrent requests.
 * Any missing configuration/import failure stays unavailable until worker restart;
 * it never falls back to ordinary app telemetry or retries a submitted command.
 * SDK clients have persistence and auto-refresh disabled; there is no timer or
 * session listener to dispose. close() fences queued/new work, not already-sent
 * commands. A late initialization cannot reopen a closed instance.
 */
export function installedOwnerControlResponse(
  installation?: Installation | InstallationLoader,
  loadRouter: () => Promise<RouterFactory> = async () =>
    (await import("./lib/owner-control-server/router.server")).createOwnerControlRouter,
) {
  let initialized: Promise<ReturnType<RouterFactory> | undefined> | undefined;
  let closed = false;
  async function reserved(request: Request): Promise<Response> {
    try {
      if (closed || request.signal?.aborted) return controlUnavailableResponse(request)!;
      initialized ??= Promise.resolve()
        .then(async () => {
          const options = typeof installation === "function" ? await installation() : installation;
          if (!options || closed) return undefined;
          const makeRouter = await loadRouter();
          return closed ? undefined : makeRouter(options);
        })
        .catch(() => undefined); // Never log configuration, provider or import exceptions.
      const configured = await initialized;
      if (closed || request.signal?.aborted) return controlUnavailableResponse(request)!;
      const response = (configured ? await configured(request) : null) ?? controlUnavailableResponse(request)!;
      return request.method === "HEAD"
        ? new Response(null, { status: response.status, headers: response.headers })
        : response;
    } catch {
      return controlUnavailableResponse(request)!;
    }
  }
  const respond = (request: Request): Promise<Response> | Response | null => {
    const path = new URL(request.url).pathname;
    if (
      path !== "/api/control" &&
      !path.startsWith("/api/control/") &&
      path !== "/api/owner-control" &&
      !path.startsWith("/api/owner-control/")
    )
      return null;
    return reserved(request);
  };
  return Object.assign(respond, {
    close() {
      closed = true;
    },
  });
}
