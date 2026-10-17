import { createOwnerControlRouter } from './lib/owner-control-server/router.server';
import { controlUnavailableResponse } from './control-unavailable.server';

type Installation = NonNullable<Parameters<typeof createOwnerControlRouter>[0]>;
/** UNSET: filling this requires separately reviewed owner UUID, registry policy,
 * exact service origin, and existing server-only admin accessor. No automatic
 * environment fallback, credentials, or permissive synthetic owner is supplied.
 */
export const deployedOwnerControlInstallation: Installation | undefined = undefined;

/** Before installation, preserve an early sanitized503 without inspecting auth
 * headers or bodies. Installed routing still independently verifies original JWTs.
 */
export function installedOwnerControlResponse(installation?: Installation) {
  const configured = installation ? createOwnerControlRouter(installation) : undefined;
  return (request: Request): Promise<Response> | Response | null => {
    if (!configured) return controlUnavailableResponse(request);
    return configured(request);
  };
}
