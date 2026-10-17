/**
 * Root-only, discard-only invitation landing. This module must run before the
 * ordinary application, its router, telemetry, or shared auth client is imported.
 * It never accepts an invitation or consumes credentials. All URL data is lost.
 */
import { createHash } from 'node:crypto';

export const ROOT_BOOTSTRAP_SCRIPT = `(() => {
  'use strict';
  let scrubbed = false;
  let navigating = false;
  let hadUrlData = true;
  const scrub = () => {
    try {
      if (window.top !== window.self || window.location.pathname !== '/') return false;
      window.history.replaceState(null, '', '/');
      return window.location.pathname === '/' && window.location.search === '' && window.location.hash === '';
    } catch (_) { return false; }
  };
  try {
    hadUrlData = window.location.search !== '' || window.location.hash !== '';
    scrubbed = scrub();
    if (scrubbed && !hadUrlData) {
      navigating = true;
      window.location.replace('/stats');
    }
  } catch (_) { scrubbed = false; }
  document.addEventListener('DOMContentLoaded', () => {
    const status = document.getElementById('landing-status');
    const button = document.getElementById('owner-sign-in');
    if (!status || !button) return;
    if (!scrubbed) {
      status.textContent = 'The address could not be safely cleared. Close this tab without copying or sharing its address. Open the app again using its normal address.';
      return;
    }
    status.textContent = hadUrlData
      ? 'The link was received and sign-in information was removed from this address. Email verification has not been checked here. Continue with a fresh owner sign-in.'
      : 'Continue to the paper dashboard using its normal address.';
    if (!hadUrlData || navigating) return;
    button.disabled = false;
    button.addEventListener('click', () => {
      if (navigating) return;
      navigating = true;
      button.disabled = true;
      if (!scrub()) {
        status.textContent = 'The address could not be safely cleared. Close this tab without copying or sharing its address.';
        return;
      }
      try { window.location.replace('/owner/login'); }
      catch (_) { status.textContent = 'Navigation was unavailable. Close this tab and open the app using its normal address.'; }
    });
  }, { once: true });
})();`;

export const ROOT_DOCUMENT = '<!doctype html><html lang="en"><head>'
  + '<meta charset="utf-8"><meta name="referrer" content="no-referrer">'
  + '<script>' + ROOT_BOOTSTRAP_SCRIPT + '</script>'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<meta name="robots" content="noindex, nofollow"><title>Owner sign-in</title>'
  + '</head><body><main><h1>Owner sign-in</h1>'
  + '<p id="landing-status">Preparing a safe sign-in page.</p>'
  + '<button id="owner-sign-in" type="button" disabled>Continue to owner sign-in</button>'
  + '<p>Real-money execution remains disabled. Opening an email link does not authorize trading controls.</p>'
  + '<noscript><p>JavaScript is required to clear sign-in information from this address. Close this tab without copying or sharing its address, then open the app using its normal address.</p></noscript>'
  + '</main></body></html>';

const scriptHash = createHash('sha256').update(ROOT_BOOTSTRAP_SCRIPT).digest('base64');
export const ROOT_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'sha256-" + scriptHash + "'; base-uri 'none'; form-action 'none'; connect-src 'none'; object-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
});

/** Undefined means continue to the ordinary app. Never logs or reflects input. */
export function rootLandingResponse(request: Request): Response | undefined {
  let path: string;
  try { path = new URL(request.url).pathname; }
  catch { return new Response(null, { status: 400, headers: ROOT_RESPONSE_HEADERS }); }
  if (path !== '/') return undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...ROOT_RESPONSE_HEADERS, Allow: 'GET, HEAD' } });
  }
  return new Response(request.method === 'HEAD' ? null : ROOT_DOCUMENT, {
    status: 200,
    headers: ROOT_RESPONSE_HEADERS,
  });
}
