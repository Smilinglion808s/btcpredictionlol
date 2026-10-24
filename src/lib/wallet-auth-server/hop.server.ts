/** SERVER ONLY. Runtime secret input, not a browser wallet/trading signer. */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  createWalletControlProxy, WALLET_SERVICE_ORIGIN,
} from "./proxy.server";

const FIELDS = ["STANDARD_CONTROL_HOP_KEY_ID", "STANDARD_CONTROL_HOP_SECRET_B64", "STANDARD_CONTROL_HOP_AUDIENCE"] as const;
const METHODS: Readonly<Record<string, string>> = Object.freeze({
  "/api/wallet-auth/challenge": "POST", "/api/wallet-auth/verify": "POST",
  "/api/wallet-auth/cancel": "POST", "/api/wallet-auth/logout": "POST",
  "/api/wallet-auth/session": "GET", "/api/standard-control/status": "GET",
  "/api/standard-control/commands": "POST", "/api/standard-control/run": "GET",
});
export type HopMapping = Readonly<Partial<Record<typeof FIELDS[number], unknown>>>;
export type HopSigner = { headers: (url: string, init: RequestInit) => Headers };
const hash = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");
const token = (x: unknown, n: number): x is string => typeof x === "string" && new RegExp(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,${n - 1}}$`).test(x);
const ascii = (x: string | null, n: number): boolean => x === null || (x.length <= n && /^[\x20-\x7e]*$/.test(x));
const bad = (): never => { throw new Error("HOP_REQUEST_REFUSED"); };

export function loadHop(mapping: HopMapping, now: () => number = Date.now,
  nonce: () => Uint8Array = () => randomBytes(16)): HopSigner | undefined {
  // A deliberately injected custom fetch-env mapping is supported, not discovered.
  if (typeof window !== "undefined") return undefined;
  try {
    const keyId = mapping.STANDARD_CONTROL_HOP_KEY_ID;
    const text = mapping.STANDARD_CONTROL_HOP_SECRET_B64;
    const audience = mapping.STANDARD_CONTROL_HOP_AUDIENCE;
    if (!token(keyId, 64) || !token(audience, 128) || typeof text !== "string" || text.length !== 44) return undefined;
    const key = Buffer.from(text, "base64");
    if (key.length !== 32 || key.toString("base64") !== text) return undefined;
    return Object.freeze({ headers(url: string, init: RequestInit): Headers {
      const u = new URL(url), method = init.method;
      if (u.origin !== WALLET_SERVICE_ORIGIN || url !== WALLET_SERVICE_ORIGIN + u.pathname ||
          !Object.hasOwn(METHODS, u.pathname) || METHODS[u.pathname] !== method || u.username || u.password || init.redirect !== "manual") bad();
      const h = new Headers(init.headers);
      const allowed = new Set(["accept", "content-type", "origin", "sec-fetch-site", "cookie", "x-csrf-token"]);
      for (const [n] of h) if (!allowed.has(n)) bad();
      const body = init.body == null ? Buffer.alloc(0) : init.body instanceof Uint8Array ? Buffer.from(init.body) : bad();
      const contentType = h.get("content-type"), origin = h.get("origin"), site = h.get("sec-fetch-site");
      const cookie = h.get("cookie"), csrf = h.get("x-csrf-token");
      if (body.length > 4096 || !ascii(contentType, 64) || !ascii(origin, 512) || !ascii(site, 32) || !ascii(cookie, 4096) || !ascii(csrf, 256) ||
          !(method === "POST" ? body.length > 0 && contentType === "application/json" : body.length === 0 && (contentType === null || contentType === "application/json"))) bad();
      const stamp = now(), n = nonce();
      if (!Number.isSafeInteger(stamp) || stamp <= 0 || !(n instanceof Uint8Array) || n.length !== 16) bad();
      const created = String(stamp), hex = Buffer.from(n).toString("hex");
      const record = JSON.stringify(["standard-control-hop/1", keyId, audience, created, hex,
        method, u.pathname, u.host, "https", contentType, origin, site,
        cookie === null ? null : hash(cookie), csrf === null ? null : hash(csrf), String(body.length), hash(body)]);
      const signature = createHmac("sha256", key).update(record, "ascii").digest("hex");
      for (const [name, value] of Object.entries({
        "X-Control-Hop-Version": "1", "X-Control-Hop-Key-Id": keyId,
        "X-Control-Hop-Audience": audience, "X-Control-Hop-Created-Ms": created,
        "X-Control-Hop-Nonce": hex, "X-Control-Hop-Signature": signature,
      })) h.set(name, value);
      return h;
    }});
  } catch { return undefined; } // No secret/error text in result or logs.
}

export function loadHopFromProcessEnv(): HopSigner | undefined {
  // Called explicitly by the server request handler, never at module import.
  // This is the complete read list. No process.env scan, VITE or fallback key.
  if (typeof window !== "undefined" || typeof process === "undefined") return undefined;
  return loadHop({
    STANDARD_CONTROL_HOP_KEY_ID: process.env.STANDARD_CONTROL_HOP_KEY_ID,
    STANDARD_CONTROL_HOP_SECRET_B64: process.env.STANDARD_CONTROL_HOP_SECRET_B64,
    STANDARD_CONTROL_HOP_AUDIENCE: process.env.STANDARD_CONTROL_HOP_AUDIENCE,
  });
}

export function createAuthenticatedWalletControlProxy(
  loader: () => HopSigner | undefined = loadHopFromProcessEnv,
  send: typeof fetch = fetch, now: () => number = Date.now,
) {
  return async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname;
    // Do not load any environment fields for ordinary/BTC/history requests.
    if (!path.startsWith("/api/wallet-auth/") && !path.startsWith("/api/standard-control/") && !path.startsWith("/api/control/")) return createWalletControlProxy(undefined, send, now)(request);
    let signer: HopSigner | undefined;
    try { signer = loader(); } catch { signer = undefined; }
    if (!signer) return createWalletControlProxy(undefined, send, now)(request);
    const signedSend: typeof fetch = async (url, init) => {
      if (typeof url !== "string" || !init) bad();
      const headers = signer!.headers(url as string, init!);
      return send(url, { ...init, headers }); // Same signal/timeout, one attempt, no retry.
    };
    return createWalletControlProxy(WALLET_SERVICE_ORIGIN, signedSend, now)(request);
  };
}
