# V1.2 shadow endpoint blocked at the edge (HTTP 403 / code 1010)

Read-only investigation. No code, deployment, protection settings, or trading paths were changed, and no bypass was attempted.

## What was checked

- Official platform documentation on 403 / error 1010 on published apps.
- Project configuration surfaces available here (domains, publish settings): the app is served on the managed address `btcpredictionlol.lovable.app`, with no custom domain attached.
- How the working integration talks to the site versus the new one (transport client only, no secrets read or printed).

## Finding

Error 1010 is issued by the edge network in front of the published site, before the request ever reaches your application. It is a client-signature decision made by the platform's own protection layer, not by your app and not by any rule you own.

Two consequences:

1. There is **no owner-configurable setting** in this project for endpoint-specific WAF rules, bot policy, service tokens, or an egress IP allowlist. Those controls exist only for a domain you own in your own Cloudflare account. `*.lovable.app` is platform-managed, so the rules are not yours to edit. The Cloudflare connector can edit rules for zones you own — it cannot touch the zone serving this address.
2. The endpoint itself is fine. An unsigned request from outside reaches the application and is answered by your own code with 401, exactly like the existing hooks. So the route, the publish state, and the application-side authentication are all correct; only requests carrying the new machine's client signature are being refused upstream.

Relevant observation, stated as diagnosis only: the integration that works and the one that is blocked run from the same machine but use different HTTP clients. The block therefore tracks the client signature rather than the source address — which is why an address allowlist would not be the lever even if one were available to you.

## Recommended path

**Platform support action is required.** There is no supported self-service configuration for this. Ask Lovable support to allow your machine integration to reach the published app's hook path, giving them:

- the published address and the exact path `/api/public/hooks/v12-shadow`
- that the response is HTTP 403 with edge error 1010, before the application runs
- that the same path answers 401 from ordinary clients, proving the app is reachable and the block is upstream
- the source of the traffic (your Railway service) and roughly when it started

Two supported alternatives, if you would rather not wait on support:

- **Point the integration at a domain you control.** Attach a custom domain to this project through the platform's domain flow. Once traffic passes through a zone in your own Cloudflare account, endpoint-specific skip rules and allowlists become genuinely owner-configurable.
- **Move the ingestion off the public site.** Send the signed payloads to a backend function instead of a published web route; that path is not behind the site's edge protection.

## Not in scope here

No client fingerprint or user-agent changes, no browser impersonation, no proxy or alternate host, no weakening of protection, no retry work (your 30s backoff ships separately).

## Next step

Tell me which direction you want — support request, custom domain, or backend ingestion path — and I will prepare it. Nothing will be changed until you say so.
