import { createReviewedOwnerAuth, browserRuntime } from './owner-auth/pinned-supabase-adapter';
import { OWNER_API_POLICY_REVISION } from './owner-auth/owner-request-contract';
import { PROVIDER_URL, type OwnerAuthAdapter } from './owner-auth/owner-login';
import { isPublicProjectKey } from './owner-auth/public-project-key';
import { reviewedCallbackProtocol, reviewedOwnerApiPolicy } from './owner-review-capabilities';

/** Existing PUBLIC browser configuration only. Never use the preview auth broker
 * or the ordinary app's shared Supabase client; no provider secret is accepted.
 */
export function createBrowserOwnerControlAdapter(): OwnerAuthAdapter {
  if (reviewedCallbackProtocol !== 'reviewed-pkce-code-flow-v2' || reviewedOwnerApiPolicy !== OWNER_API_POLICY_REVISION)
    return createReviewedOwnerAuth();
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  if (env?.VITE_SUPABASE_URL !== PROVIDER_URL || !isPublicProjectKey(env.VITE_SUPABASE_PUBLISHABLE_KEY))
    return createReviewedOwnerAuth();
  return createReviewedOwnerAuth({
    applicationOrigin: 'https://btcpredictionlol.lovable.app',
    publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
    callbackMode: reviewedCallbackProtocol,
    ownerApiPolicyRevision: reviewedOwnerApiPolicy,
  }, browserRuntime());
}
