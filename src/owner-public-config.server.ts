import { PROVIDER_URL } from './lib/owner-auth/owner-login';
import { APPLICATION_ORIGIN } from './lib/owner-auth/standalone-owner-response.server';
import { isPublicProjectKey } from './lib/owner-auth/public-project-key';
import { OWNER_API_POLICY_REVISION } from './lib/owner-auth/owner-request-contract';
import type { ReviewedBrowserConfig } from './lib/owner-auth/pinned-supabase-adapter';

export interface PublicEnvironment {
  SUPABASE_URL?: unknown;
  VITE_SUPABASE_URL?: unknown;
  SUPABASE_PUBLISHABLE_KEY?: unknown;
  VITE_SUPABASE_PUBLISHABLE_KEY?: unknown;
}

/** Only existing public app configuration is consumed. No secret/admin key names. */
export const REVIEWED_CALLBACK_CONTRACT = "reviewed-pkce-code-flow-v2" as const;
export type CallbackReview = typeof REVIEWED_CALLBACK_CONTRACT;

/** A public URL/key does not prove deployed callback or provider flow preservation. */
export function ownerPublicConfig(values: PublicEnvironment, callbackReview?: CallbackReview, ownerPolicy?: unknown): ReviewedBrowserConfig | undefined {
  if (callbackReview !== REVIEWED_CALLBACK_CONTRACT || (ownerPolicy !== undefined && ownerPolicy !== OWNER_API_POLICY_REVISION)) return undefined;
  const urls = [values.SUPABASE_URL, values.VITE_SUPABASE_URL].filter(value => value !== undefined);
  if (urls.length === 0 || urls.some(value => value !== PROVIDER_URL)) return undefined;
  // Match the generated browser client's public-key precedence. An invalid
  // present client value never silently falls back to a different key.
  const key = values.VITE_SUPABASE_PUBLISHABLE_KEY !== undefined
    ? values.VITE_SUPABASE_PUBLISHABLE_KEY
    : values.SUPABASE_PUBLISHABLE_KEY;
  if (!isPublicProjectKey(key)) return undefined;
  return { applicationOrigin: APPLICATION_ORIGIN, publishableKey: key, callbackMode: REVIEWED_CALLBACK_CONTRACT,
    ...(ownerPolicy === OWNER_API_POLICY_REVISION ? { ownerApiPolicyRevision: OWNER_API_POLICY_REVISION } : {}) };
}

/** Runtime values stay inside server configuration/HTML's public SDK setup, never logs. */
export function existingPublicEnvironment(): PublicEnvironment {
  const server = typeof process === 'undefined' ? undefined : process.env;
  const vite = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  return {
    SUPABASE_URL: server?.SUPABASE_URL,
    VITE_SUPABASE_URL: vite?.VITE_SUPABASE_URL ?? server?.VITE_SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: server?.SUPABASE_PUBLISHABLE_KEY,
    VITE_SUPABASE_PUBLISHABLE_KEY: vite?.VITE_SUPABASE_PUBLISHABLE_KEY ?? server?.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}
