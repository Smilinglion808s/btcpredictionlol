/** Backend installation remains unset in this release. Never fall through to app telemetry.
 * This conveys unavailability, not a control state or worker acknowledgement.
 * No Authorization, Cookie, CSRF header or request body is inspected or logged.
 */
export function controlUnavailableResponse(request: Request): Response | null {
  const path = new URL(request.url).pathname;
  const evidenceRoute = path === '/api/owner-control/session-evidence';
  const revokeRoute = path === '/api/owner-control/revoke';
  const enrollRoute = path === '/api/owner-control/enroll';
  const ownerNamespace = path === '/api/owner-control' || path.startsWith('/api/owner-control/');
  if (!ownerNamespace && path !== '/api/control' && !path.startsWith('/api/control/')) return null;
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({
    code: evidenceRoute ? 'OWNER_SESSION_EVIDENCE_UNAVAILABLE'
      : revokeRoute ? 'OWNER_SESSION_REVOCATION_UNAVAILABLE'
      : enrollRoute ? 'OWNER_SESSION_ENROLLMENT_UNAVAILABLE' : 'CONTROL_SERVICE_UNAVAILABLE',
    message: 'Owner control backend is not connected. No control action is confirmed.',
  }), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });
}
