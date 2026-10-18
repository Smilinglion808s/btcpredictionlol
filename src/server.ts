// Local, uninstalled composition. No credential values or owner identity are stored here.
// Root and owner auth responses run before ordinary app/error/telemetry imports.
import {
  createWalletControlProxy,
  WALLET_SERVICE_ORIGIN,
} from "./lib/wallet-auth-server/proxy.server";
import { rootLandingResponse } from "./lib/owner-root-landing";
import { standaloneOwnerResponse } from "./lib/owner-auth/standalone-owner-response.server";
import {
  existingPublicEnvironment,
  ownerPublicConfig,
  REVIEWED_CALLBACK_CONTRACT,
} from "./owner-public-config.server";
import { reviewedOwnerApiPolicy } from "./lib/owner-review-capabilities";
import { deployedCallbackReview } from "./owner-callback-review.server";
// Exact approved Solana-only replacement. The backend independently authenticates
// wallet cookies; old email/bearer owner endpoints are denied by this namespace.
const walletControlResponse = createWalletControlProxy(WALLET_SERVICE_ORIGIN);

type AppEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};
let appEntry: Promise<AppEntry> | undefined;

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    const root = rootLandingResponse(request);
    if (root) return root;
    const path = new URL(request.url).pathname;
    if (path === "/owner/login" || path === "/owner/auth/callback") {
      // Installing this reviewed code would reuse only the app's existing PUBLIC
      // provider config. Missing, mismatched, or secret-shaped keys fail closed.
      const config =
        deployedCallbackReview === REVIEWED_CALLBACK_CONTRACT
          ? ownerPublicConfig(
              existingPublicEnvironment(),
              deployedCallbackReview,
              reviewedOwnerApiPolicy,
            )
          : undefined;
      const owner = standaloneOwnerResponse(request, config);
      if (owner) return owner;
    }
    const control = await walletControlResponse(request);
    if (control) return control;
    appEntry ??= import("./server-app").then((module) => module.default);
    return (await appEntry).fetch(request, env, ctx);
  },
};
