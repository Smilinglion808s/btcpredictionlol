import { validateSuccess } from "./response-validation.server";
/** Exact same-origin transport boundary. No identity is inferred here: the
 * dedicated server authenticates opaque cookies and every command separately. */
export const WALLET_APP_ORIGIN = "https://btcpredictionlol.lovable.app";
export const WALLET_SERVICE_ORIGIN = "https://owner-control-api-controls-pilot.up.railway.app";
const LOGIN_COOKIE = "__Host-owner_wallet_login";
const SESSION_COOKIE = "__Host-owner_wallet";
const COOKIE_NAMES = new Set([LOGIN_COOKIE, SESSION_COOKIE]);
const COOKIE_VALUE = /^[a-f0-9]{64}$/;
const CSRF_VALUE = /^[A-Za-z0-9_-]{16,256}$/;
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
class BoundaryError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
function response(value: unknown, status: number, cookies: string[] = []): Response {
  const headers = new Headers(HEADERS);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(value), { status, headers });
}
function failure(wallet: boolean, code: string, status: number): Response {
  return response(wallet ? { schema_version: 1, error: { code } } : { contract_version: 1, error: { code } }, status);
}
function scope(path: string): "wallet" | "control" | "legacy" | null {
  if (path === "/api/wallet-auth" || path.startsWith("/api/wallet-auth/")) return "wallet";
  if (path === "/api/standard-control" || path.startsWith("/api/standard-control/")) return "control";
  if (path === "/api/control" || path.startsWith("/api/control/")) return "control";
  if (path === "/api/owner-control" || path.startsWith("/api/owner-control/")) return "legacy";
  return null;
}
function allowed(method: string, path: string): boolean {
  return (
    (method === "POST" &&
      [
        "/api/wallet-auth/challenge",
        "/api/wallet-auth/verify",
        "/api/wallet-auth/cancel",
        "/api/wallet-auth/logout",
        "/api/control/commands",
        "/api/standard-control/commands",
      ].includes(path)) ||
    (method === "GET" &&
      (["/api/standard-control/run", "/api/standard-control/status", "/api/wallet-auth/session", "/api/control/session", "/api/control/status", "/api/control/readiness"].includes(
        path,
      ) ||
        /^\/api\/control\/commands\/[A-Za-z0-9_-]{1,240}$/.test(path)))
  );
}
async function boundedAwait<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("Deadline exceeded");
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      cleanup();
      reject(new Error("Deadline exceeded"));
    };
    const cleanup = () => signal.removeEventListener("abort", aborted);
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) aborted();
  });
}
async function bytes(source: Request | Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!source.body) return new Uint8Array();
  const reader = source.body.getReader(),
    parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await boundedAwait(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new BoundaryError("INVALID_BODY", 413);
      parts.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* A canceled pending read cannot change the result. */
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
function selectedCookies(raw: string | null): string | null {
  if (raw === null) return null;
  if (raw.length > 16384) throw new BoundaryError("INVALID_COOKIE", 400);
  const selected = new Map<string, string>();
  for (const item of raw.split(";")) {
    const piece = item.trim(),
      eq = piece.indexOf("=");
    if (eq < 0) {
      if (COOKIE_NAMES.has(piece)) throw new BoundaryError("INVALID_COOKIE");
      continue;
    }
    const name = piece.slice(0, eq);
    if (!COOKIE_NAMES.has(name)) continue;
    const value = piece.slice(eq + 1);
    if (selected.has(name) || !COOKIE_VALUE.test(value)) throw new BoundaryError("INVALID_COOKIE");
    selected.set(name, value);
  }
  return selected.size ? [...selected].map(([k, v]) => k + "=" + v).join("; ") : null;
}
function upstreamCookies(headers: Headers, path: string, status: number): string[] {
  const header = headers.get("Set-Cookie");
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const raw =
    typeof extended.getSetCookie === "function"
      ? extended.getSetCookie()
      : header === null
        ? []
        : header.split(/,\s*(?=__Host-)/);
  if (
    !Array.isArray(raw) ||
    raw.length > 2 ||
    (header !== null && raw.length === 0) ||
    (header === null && raw.length !== 0)
  )
    throw new Error("Invalid cookie response");
  const seen = new Map<string, { value: string; age: number; canonical: string }>();
  for (const line of raw) {
    if (typeof line !== "string" || line.length > 256 || /[\r\n,]/.test(line))
      throw new Error("Invalid cookie response");
    const pieces = line.split(";").map((x) => x.trim());
    if (pieces.length !== 6) throw new Error("Invalid cookie attributes");
    const first = pieces.shift()!,
      eq = first.indexOf("=");
    if (eq < 0) throw new Error("Invalid cookie");
    const name = first.slice(0, eq),
      value = first.slice(eq + 1);
    if (!COOKIE_NAMES.has(name) || seen.has(name)) throw new Error("Invalid cookie name");
    const attrs = new Map<string, string>();
    for (const part of pieces) {
      const n = part.indexOf("="),
        key = (n < 0 ? part : part.slice(0, n)).toLowerCase(),
        val = n < 0 ? "" : part.slice(n + 1);
      if (attrs.has(key)) throw new Error("Duplicate attribute");
      attrs.set(key, val);
    }
    if (
      attrs.size !== 5 ||
      attrs.get("path") !== "/" ||
      attrs.get("secure") !== "" ||
      attrs.get("httponly") !== "" ||
      attrs.get("samesite")?.toLowerCase() !== "strict" ||
      !/^\d{1,3}$/.test(attrs.get("max-age") ?? "")
    )
      throw new Error("Invalid cookie attributes");
    const age = Number(attrs.get("max-age"));
    if (age > 720 || (!(value === "" && age === 0) && !COOKIE_VALUE.test(value)))
      throw new Error("Invalid cookie value");
    seen.set(name, {
      value,
      age,
      canonical: `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`,
    });
  }
  const success = status === 200;
  const expected =
    success && path === "/api/wallet-auth/challenge"
      ? [LOGIN_COOKIE]
      : success && path === "/api/wallet-auth/verify"
        ? [SESSION_COOKIE]
        : success && path === "/api/wallet-auth/logout"
          ? [LOGIN_COOKIE, SESSION_COOKIE]
          : [];
  if (seen.size !== expected.length || expected.some((name) => !seen.has(name)))
    throw new Error("Unexpected cookie response");
  for (const [name, cookie] of seen) {
    if (path.endsWith("/logout") ? cookie.age !== 0 : cookie.age === 0 || (name === SESSION_COOKIE && cookie.age > 600))
      throw new Error("Invalid cookie lifetime");
  }
  return [...seen.values()].map((x) => x.canonical);
}
/** Unconfigured returns a sanitized denial before inspecting headers or body.
 * Legacy owner-email endpoints never authorize the replacement controls. */
export function createWalletControlProxy(
  serviceOrigin?: string,
  send: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  const configured = serviceOrigin === WALLET_SERVICE_ORIGIN;
  return async function handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url),
      kind = scope(url.pathname);
    if (kind === null) return null;
    const wallet = kind === "wallet" || url.pathname === "/api/control/readiness";
    if (kind === "legacy") return failure(false, "OWNER_AUTH_REPLACED", 410);
    if (!configured) return failure(wallet, "UNCONFIGURED", 503);
    let handedOff = false,
      upstreamStarted = false;
    let failureStage: "REQUEST" | "FETCH" | "HEADERS" | "BODY" | "DTO" | "COOKIE" = "REQUEST";
    let deadline: AbortSignal | undefined;
    try {
      const origin = request.headers.get("Origin");
      if (
        url.origin !== WALLET_APP_ORIGIN ||
        url.search ||
        url.hash ||
        (origin !== null && origin !== WALLET_APP_ORIGIN) ||
        (request.method === "POST" && origin !== WALLET_APP_ORIGIN) ||
        request.headers.get("Sec-Fetch-Site") === "cross-site"
      )
        throw new BoundaryError("ORIGIN_FORBIDDEN", 403);
      if (!allowed(request.method, url.pathname)) throw new BoundaryError("NOT_FOUND", 404);
      deadline = AbortSignal.timeout(url.pathname === "/api/control/readiness" ? 8000 : 3000);
      const headers = new Headers({ Accept: "application/json", Origin: WALLET_APP_ORIGIN });
      const cookie = selectedCookies(request.headers.get("Cookie"));
      if (cookie) headers.set("Cookie", cookie);
      const site = request.headers.get("Sec-Fetch-Site");
      if (site !== null) {
        if (site !== "same-origin") throw new BoundaryError("ORIGIN_FORBIDDEN", 403);
        headers.set("Sec-Fetch-Site", site);
      }
      let body: Uint8Array | undefined;
      if (request.method === "POST") {
        if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
          throw new BoundaryError("JSON_CONTENT_TYPE_REQUIRED", 415);
        body = await bytes(request, wallet ? 4096 : 8192, deadline);
        if (!body.length) throw new BoundaryError("INVALID_BODY");
        headers.set("Content-Type", "application/json");
        if (url.pathname !== "/api/wallet-auth/challenge") {
          const csrf = request.headers.get("X-CSRF-Token");
          if (!csrf || !CSRF_VALUE.test(csrf)) throw new BoundaryError("CSRF_FORBIDDEN", 403);
          headers.set("X-CSRF-Token", csrf);
        }
      } else if (request.body !== null) throw new BoundaryError("INVALID_BODY");
      handedOff = request.method === "POST";
      upstreamStarted = true;
      failureStage = "FETCH";
      const upstream = await boundedAwait(
        send(WALLET_SERVICE_ORIGIN + url.pathname, {
          method: request.method,
          headers,
          body: body as BodyInit | undefined,
          redirect: "manual",
          credentials: "omit",
          cache: "no-store",
          signal: deadline,
        }),
        deadline,
      );
      failureStage = "HEADERS";
      if (
        upstream.status < 200 ||
        upstream.status >= 500 ||
        upstream.status === 204 ||
        (upstream.status >= 300 && upstream.status < 400) ||
        upstream.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json"
      )
        throw new Error("Unavailable");
      failureStage = "BODY";
      const raw = await bytes(upstream, 65536, deadline);
      failureStage = "DTO";
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid DTO");
      if (upstream.status >= 400) {
        const dto = value as Record<string, unknown>,
          key = wallet ? "schema_version" : "contract_version";
        if (
          Object.keys(dto).length !== 2 ||
          dto[key] !== 1 ||
          dto.error === null ||
          typeof dto.error !== "object" ||
          Array.isArray(dto.error)
        )
          throw new Error("Invalid error DTO");
        const error = dto.error as Record<string, unknown>;
        if (
          Object.keys(error).length !== 1 ||
          typeof error.code !== "string" ||
          !/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
        )
          throw new Error("Invalid error DTO");
      }
      const valid = upstream.status < 300 ? validateSuccess(value, url.pathname, upstream.status, now()) : value;
      failureStage = "COOKIE";
      const cookies = upstreamCookies(upstream.headers, url.pathname, upstream.status);
      const result=response(valid, upstream.status, cookies);
      if(upstream.status===200&&(url.pathname==="/api/standard-control/status"||url.pathname==="/api/standard-control/commands"||url.pathname==="/api/standard-control/run")){
        const readId=request.headers.get("X-Control-Read-Id");
        if(readId!==null){
          if(!/^[a-f0-9]{32}$/.test(readId))throw new Error("Invalid read binding");
          const dto=valid as {sampled_at_ms?:number;observed_at_ms?:number;auth_expires_at_ms?:number;entries_until_ms?:number|null},observed=now();
          const run=url.pathname==="/api/standard-control/run",sample=run?dto.observed_at_ms:dto.sampled_at_ms;
          if(sample===undefined)throw new Error("Invalid status timing");
          const age=Math.ceil(observed-sample);
          if(!Number.isSafeInteger(observed)||age<0||age>5000)throw new Error("Invalid status timing");
          result.headers.set("X-Control-Read-Id",readId);result.headers.set("X-Control-Sample-Age-Ms",String(age));
          if(run){const end=dto.entries_until_ms;if(end===undefined)throw new Error("Invalid run timing");const remaining=end===null?null:Math.max(0,Math.floor(end-observed));if(remaining!==null&&remaining>86400000)throw new Error("Invalid run timing");result.headers.set("X-Control-Run-Remaining-Ms",remaining===null?"none":String(remaining));}
          else{if(dto.auth_expires_at_ms===undefined)throw new Error("Invalid auth timing");const remaining=Math.floor(dto.auth_expires_at_ms-observed);if(remaining<=0||remaining>600000)throw new Error("Invalid auth timing");result.headers.set("X-Control-Auth-Remaining-Ms",String(remaining));}
        }
      }
      return result;
    } catch (error) {
      if (!upstreamStarted && error instanceof BoundaryError) return failure(wallet, error.code, error.status);
      const result = failure(wallet, handedOff ? "RESULT_UNCERTAIN" : "SERVICE_UNAVAILABLE", 503);
      // Bounded operational diagnostics only. Never expose exception messages,
      // URLs, request/response values, identity, cookie data or authentication proofs.
      const category = deadline?.aborted ? "TIMEOUT" : error instanceof TypeError ? "TYPE_ERROR" : "ERROR";
      result.headers.set("X-Wallet-Proxy-Failure", `${failureStage}_${category}`);
      return result;
    }
  };
}
