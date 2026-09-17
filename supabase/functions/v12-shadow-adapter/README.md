# Authenticated V1.2 recording backend

Deploy only this function to the **predictor** backend `alevdzyisibxcvwoyrqb`.
It is separate from the three receiver functions in betting project
`ruxndqfjfdbtdbkheuge`. The entrypoint refuses the wrong backend URL.

Endpoint:
`https://alevdzyisibxcvwoyrqb.supabase.co/functions/v1/v12-shadow-adapter`

This is an independent backend integration. It reads the predictor database
directly and never requests or proxies the published website endpoint. The
website's access controls remain unchanged. Railway holds the existing HMAC
secret only; it receives no database service-role key.

`verify_jwt=false` is intentional for this signed machine webhook. The handler
requires the existing `C85_GATEWAY_SECRET`, HMAC-SHA256 of timestamp + period +
raw body, a timestamp within 10 seconds, the current 15-minute interval, and a
single-use nonce for publishing or probing. Unsigned requests reach no database.
The Edge runtime injects database credentials and reads the signing secret from
the project's existing secrets. No secret is embedded in source or the bundle.

The `context` and `publish` operations retain the original adapter contract.
The signed `probe` operation sends deliberately invalid, signed payloads to the
three fixed recording receivers. It expects `400 ROUTE_POLICY_MISMATCH`, proving
authentication without entering the receiver's storage path. Probe results are
connection checks, not model signals or fills.

Generate `core.js` with `node scripts/build-v12-edge.mjs`. The bundle includes
the canonical V1.1 snapshot reader, V1.2 context, contract and shadow transport;
there is no copied rewrite of the model or eligibility math. Verify with:

```
node --experimental-strip-types --test supabase/functions/v12-shadow-adapter/adapter.test.ts
npx --no-install vitest run src/lib/v12/__tests__/edge-context.test.ts
OPENBLAS_NUM_THREADS=2 python3 services/v12-worker/tests/runtime.py
```

Set `V12_SHADOW_ADAPTER_URL` on the **V1.2 shadow worker only** to the endpoint
above after deployment. Keep `V12_MODE=shadow`. The existing V1.1 worker,
collector, financial executor, sizing and settlement settings are unaffected.
