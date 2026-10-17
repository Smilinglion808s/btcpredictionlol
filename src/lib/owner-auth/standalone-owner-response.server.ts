import { OWNER_API_POLICY_REVISION } from "./owner-request-contract";
import { isPublicProjectKey } from "./public-project-key";
import { CALLBACK_PATH, PROVIDER_URL } from "./owner-login";
import type { ReviewedBrowserConfig } from "./pinned-supabase-adapter";

export const APPLICATION_ORIGIN = "https://btcpredictionlol.lovable.app";
export const LOGIN_PATH = "/owner/login";
const privacyHeaders = { "cache-control": "no-store, max-age=0", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" };
export const ENTRY_ASSET_PATH = "/owner-auth-entry-v4.js";
/** A separate response overlay. Caller must intercept these routes BEFORE normal app handling.
 * It is never installed by importing this file. It embeds no credentials by default.
 */
export function standaloneOwnerResponse(
  request: Request,
  reviewed?: ReviewedBrowserConfig,
): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== LOGIN_PATH && url.pathname !== CALLBACK_PATH)
    return null;
  if (url.origin !== APPLICATION_ORIGIN)
    return new Response("Not found", { status: 404, headers: privacyHeaders });
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...privacyHeaders, Allow: "GET, HEAD" },
    });
  const config =
    reviewed &&
    reviewed.applicationOrigin === APPLICATION_ORIGIN &&
    reviewed.callbackMode === "reviewed-pkce-code-flow-v2" &&
    isPublicProjectKey(reviewed.publishableKey)
      ? {
          applicationOrigin: APPLICATION_ORIGIN,
          publishableKey: reviewed.publishableKey,
          callbackMode: reviewed.callbackMode,
          ...(reviewed.ownerApiPolicyRevision === OWNER_API_POLICY_REVISION ? { ownerApiPolicyRevision: OWNER_API_POLICY_REVISION } : {}),
        }
      : null;
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const encodedConfig = JSON.stringify(config)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const script = `(() => {
    "use strict";
    const origin = ${JSON.stringify(APPLICATION_ORIGIN)};
    const path = ${JSON.stringify(url.pathname)};
    const mode = ${JSON.stringify(url.pathname === CALLBACK_PATH ? "callback" : "login")};
    let captured = null;
    let closed = false;
    const fail = () => { const node = document.getElementById("owner-auth-root"); if (node) node.textContent = "Owner sign-in unavailable. No owner access was granted. Reload this clean page to try again."; };
    const leave = () => { closed = true; captured = null; fail(); document.addEventListener("DOMContentLoaded", fail, { once: true }); };
    const events = ["pagehide", "popstate", "hashchange"];
    for (const event of events) window.addEventListener(event, leave);
    try {
      if (window.top !== window.self || location.origin !== origin) throw new Error("Unavailable");
      captured = mode === "callback" ? location.href : null;
      history.replaceState(null, "", path);
      if (location.origin !== origin || location.pathname !== path || location.search !== "" || location.hash !== "") throw new Error("Unavailable");
    } catch { captured = null; fail(); document.addEventListener("DOMContentLoaded", fail, { once: true }); return; }
    const launch = async () => {
      try {
        if (closed) return;
        const entry = await import(${JSON.stringify(ENTRY_ASSET_PATH)});
        if (closed) return;
        const callbackUrl = captured;
        captured = null;
        entry.startStandaloneOwnerPage({ mode, callbackUrl, config: ${encodedConfig} });
        for (const event of events) window.removeEventListener(event, leave);
      } catch { captured = null; fail(); }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", launch, { once: true });
    else void launch();
  })();`;
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Owner sign-in</title><script nonce="' +
    nonce +
    '">' +
    script +
    '</script></head><body><main id="owner-auth-root" aria-live="polite"><p>Owner sign-in is loading. Controls remain unavailable.</p></main><noscript>JavaScript is required for owner sign-in. Do not share this link.</noscript></body></html>';
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}' 'strict-dynamic'; connect-src ${PROVIDER_URL}${config?.ownerApiPolicyRevision === OWNER_API_POLICY_REVISION ? " 'self'" : ""}; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    },
  });
}
