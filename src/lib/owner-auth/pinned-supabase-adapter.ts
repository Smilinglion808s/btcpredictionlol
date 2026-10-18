import {
  OWNER_API_POLICY_REVISION,
  OwnerRequestError,
  describeOwnerRequest,
  parseOwnerResponse,
  type OwnerRequest,
  type OwnerResultMap,
  type OwnerResponseContext,
  type OwnerErrorCode,
  type OwnerSignOutResult,
} from "./owner-request-contract";
import { isPublicProjectKey } from "./public-project-key";
import { AuthClient, isAuthSessionMissingError, type SupabaseClient, type createClient } from "@supabase/supabase-js";
import {
  CALLBACK_PATH,
  JOURNAL_KEY,
  ENROLLMENT_JOURNAL_KEY,
  PROVIDER_URL,
  confirmedEmail,
  exactOrigin,
  validFlowId,
  validEmail,
  type Identity,
  type LockedOwnerAuth,
  type OwnerAuthAdapter,
} from "./owner-login";

export const AUTH_STORAGE_KEY = "owner-control-auth-v2";
export const FLOW_LOCK_NAME = "owner-auth-flow-v2";
export const LEASE_KEY = "owner-login-lease-v2";
export interface ReviewedBrowserConfig {
  applicationOrigin: string;
  publishableKey: string;
  /** Exact callback path with an opaque flow query must survive the provider/template. */
  callbackMode: "reviewed-pkce-code-flow-v2";
  /** Separate UNSET capability until app-server session policy and transport are reviewed. */
  ownerApiPolicyRevision?: typeof OWNER_API_POLICY_REVISION;
}
export interface OriginLocks {
  request<T>(name: string, options: { mode: "exclusive"; signal: AbortSignal }, callback: () => Promise<T>): Promise<T>;
}
export interface BrowserRuntime {
  readonly origin: string;
  readonly isTopLevel: boolean;
  /** Dedicated SDK keys in the approved app origin only; never an editor broker. */
  readonly localStorage: Storage;
  readonly locks: OriginLocks;
  readonly randomUUID: () => string;
  readonly fetch: typeof fetch;
}
export type ClientFactory = (
  url: string,
  key: string,
  options: Parameters<typeof createClient>[2],
) => Pick<SupabaseClient, "auth">;
/** Official auth-only SDK, without SupabaseClient's detached INITIAL_SESSION subscription. */
export const createAuthOnlyClient: ClientFactory = (url, key, options) => ({
  auth: new AuthClient({
    ...options?.auth,
    url: url + "/auth/v1",
    headers: { apikey: key, Authorization: "Bearer " + key },
    fetch: options?.global?.fetch,
  }),
});
const unavailable: OwnerAuthAdapter = Object.freeze({
  available: false,
  close() {},
  async transact() {
    throw new Error("Owner sign-in unavailable");
  },
});

/** SDK requests may reach only these exact routes on the already-pinned Auth provider. */
export function providerOnlyFetch(fetcher: typeof fetch, callbackUrl: string | null): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const params = [...url.searchParams];
    const allowed =
      url.origin === PROVIDER_URL &&
      !url.username &&
      !url.password &&
      !url.hash &&
      ((url.pathname === "/auth/v1/user" && method === "GET" && params.length === 0) ||
        (url.pathname === "/auth/v1/otp" &&
          method === "POST" &&
          params.length === 1 &&
          params[0][0] === "redirect_to" &&
          callbackUrl !== null &&
          params[0][1] === callbackUrl) ||
        (url.pathname === "/auth/v1/token" &&
          method === "POST" &&
          params.length === 1 &&
          params[0][0] === "grant_type" &&
          ["pkce", "refresh_token"].includes(params[0][1])) ||
        (url.pathname === "/auth/v1/logout" &&
          method === "POST" &&
          params.length === 1 &&
          params[0][0] === "scope" &&
          params[0][1] === "local"));
    if (!allowed) throw new Error("Auth destination not allowed");
    return fetcher(input, {
      ...init,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  };
}

type DurableLease = { version: 2; generation: number; operationId: string };
function nextLease(raw: string | null, operationId: string): DurableLease {
  let generation = 0;
  if (raw !== null) {
    if (raw.length > 256) throw new Error("Storage unavailable");
    const previous = JSON.parse(raw) as DurableLease;
    if (
      !previous ||
      Object.keys(previous).sort().join(",") !== "generation,operationId,version" ||
      previous.version !== 2 ||
      !validFlowId(previous.operationId) ||
      !Number.isSafeInteger(previous.generation) ||
      previous.generation < 1 ||
      previous.generation >= Number.MAX_SAFE_INTEGER
    )
      throw new Error("Storage unavailable");
    generation = previous.generation;
  }
  if (!validFlowId(operationId)) throw new Error("Secure randomness unavailable");
  return { version: 2, generation: generation + 1, operationId };
}

/** Decode only bounded routing/freshness hints. The server still verifies signature/owner/session. */
function tokenContext(token: unknown, nowSeconds: number): OwnerResponseContext {
  try {
    if (
      typeof token !== "string" ||
      token.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    )
      throw new Error("Token");
    const raw = atob(token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"));
    if (raw.length > 6144) throw new Error("Token");
    const claims = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))),
    ) as Record<string, unknown>;
    const uuid = (v: unknown): v is string =>
      typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
    const sec = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
    if (
      !claims ||
      typeof claims !== "object" ||
      Array.isArray(claims) ||
      claims.iss !== PROVIDER_URL + "/auth/v1" ||
      claims.aud !== "authenticated" ||
      !uuid(claims.sub) ||
      !uuid(claims.session_id) ||
      !sec(claims.iat) ||
      !sec(claims.exp) ||
      !sec(nowSeconds) ||
      claims.iat > nowSeconds ||
      claims.exp <= nowSeconds ||
      claims.iat >= claims.exp
    )
      throw new Error("Claims");
    return {
      nowSeconds,
      subject: claims.sub,
      sessionId: claims.session_id,
      tokenIat: claims.iat,
      tokenExp: claims.exp,
    };
  } catch {
    throw new OwnerRequestError("AUTH_REQUIRED", "not_sent");
  }
}
async function readOwnerJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    throw new Error("JSON required");
  const declared = response.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 65536)) throw new Error("Response too large");
  if (!response.body) throw new Error("Missing body");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    void reader.cancel().catch(() => {});
    rejectAbort(new Error("Body cancelled"));
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.length;
      if (size > 65536 || parts.length >= 128) throw new Error("Response too large");
      parts.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
const serverErrorCodes = new Set<OwnerErrorCode>([
  "AUTH_REQUIRED",
  "TOKEN_TOO_OLD",
  "OWNER_FORBIDDEN",
  "APP_SESSION_REVOKED",
  "APP_SESSION_ENROLL_REQUIRED",
  "ORIGIN_FORBIDDEN",
  "REGISTRY_UNAVAILABLE",
  "REGISTRY_RESULT_UNCERTAIN",
  "UNCONFIGURED",
  "CONTROL_SERVICE_UNCONFIGURED",
  "CONTROL_SERVICE_UNAVAILABLE",
  "CONTROL_RESULT_UNCERTAIN",
  "CSRF_FORBIDDEN",
]);

/** Inert on import and construction. All durable state and SDK work happens under one Web Lock. */
export function createReviewedOwnerAuth(
  config?: ReviewedBrowserConfig,
  runtime?: BrowserRuntime,
  clientFactory: ClientFactory = createAuthOnlyClient,
  now: () => number = Date.now,
  queueTimeoutMs = 12_000,
  ownerTimeoutMs = 12_000,
): OwnerAuthAdapter {
  if (!config || !runtime) return unavailable;
  try {
    if (
      exactOrigin(config.applicationOrigin) !== "https://btcpredictionlol.lovable.app" ||
      config.applicationOrigin !== runtime.origin ||
      runtime.isTopLevel !== true ||
      config.callbackMode !== "reviewed-pkce-code-flow-v2" ||
      !isPublicProjectKey(config.publishableKey) ||
      typeof runtime.locks?.request !== "function" ||
      typeof runtime.randomUUID !== "function" ||
      typeof runtime.fetch !== "function" ||
      typeof runtime.localStorage?.getItem !== "function" ||
      typeof runtime.localStorage?.setItem !== "function" ||
      typeof runtime.localStorage?.removeItem !== "function" ||
      !Number.isFinite(queueTimeoutMs) ||
      queueTimeoutMs <= 0 ||
      !Number.isFinite(ownerTimeoutMs) ||
      ownerTimeoutMs <= 0
    )
      return unavailable;
  } catch {
    return unavailable;
  }
  // Capture validated dependencies. The current page cannot swap a runtime field after validation.
  const rawStorage = runtime.localStorage,
    locks = runtime.locks,
    fetcher = runtime.fetch,
    randomUUID = runtime.randomUUID;
  // SDK can log native storage/fetch exceptions. Sanitize at that boundary, before the SDK sees them.
  const storage = {
    getItem(key: string) {
      try {
        return rawStorage.getItem(key);
      } catch {
        throw new Error("Durable storage unavailable");
      }
    },
    setItem(key: string, value: string) {
      try {
        rawStorage.setItem(key, value);
      } catch {
        throw new Error("Durable storage unavailable");
      }
    },
    removeItem(key: string) {
      try {
        rawStorage.removeItem(key);
      } catch {
        throw new Error("Durable storage unavailable");
      }
    },
  };
  const origin = config.applicationOrigin,
    publicKey = config.publishableKey;
  const ownerApiEnabled = config.ownerApiPolicyRevision === OWNER_API_POLICY_REVISION;
  let closed = false;
  let csrfCache: {
    subject: string;
    sessionId: string;
    csrfToken: string;
    expiresAt: number;
  } | null = null;
  const queued = new Set<AbortController>();
  const active = new Set<() => void>();
  return Object.freeze({
    get available() {
      return !closed;
    },
    get ownerApiAvailable() {
      return !closed && ownerApiEnabled;
    },
    close() {
      if (closed) return;
      closed = true;
      csrfCache = null;
      for (const abort of queued) abort.abort();
      for (const cancel of active) cancel(); // Fence FIRST, then permit lock callback to settle.
      queued.clear();
    },
    async transact<T>(work: (lease: LockedOwnerAuth) => Promise<T>): Promise<T> {
      if (closed) throw new Error("Owner sign-in closed");
      const waiting = new AbortController();
      queued.add(waiting);
      const queueTimer = setTimeout(() => waiting.abort(), queueTimeoutMs);
      try {
        return await locks.request(FLOW_LOCK_NAME, { mode: "exclusive", signal: waiting.signal }, async () => {
          clearTimeout(queueTimer);
          queued.delete(waiting);
          if (closed || waiting.signal.aborted) throw new Error("Owner sign-in closed");
          // Web Locks, not these reads/writes, provide atomicity. No lease expiry or lock stealing.
          const record = JSON.stringify(nextLease(storage.getItem(LEASE_KEY), randomUUID()));
          storage.setItem(LEASE_KEY, record);
          if (storage.getItem(LEASE_KEY) !== record) throw new Error("Durable storage unavailable");
          let open = true;
          let storageHealthy = true;
          let client: Pick<SupabaseClient, "auth"> | undefined;
          let initialization: Promise<unknown> | undefined;
          let sdkFlow: string | undefined;
          let mayConsumeVerifier = false;
          const pending = new Set<AbortController>();
          const live = () => open && !closed && storageHealthy && storage.getItem(LEASE_KEY) === record;
          const assertLive = () => {
            if (!live()) throw new Error("Auth operation closed");
          };
          const dispose = () => {
            try {
              if (typeof client?.auth.dispose === "function") void client.auth.dispose().catch(() => {});
            } catch {
              /* Sanitized local teardown only. */
            }
          };
          const fence = () => {
            if (!open) return;
            open = false;
            for (const abort of pending) abort.abort();
            pending.clear();
            dispose();
            // No new initialization here. Dispose again after the already-started initialization.
            void initialization?.then(dispose, dispose);
          };
          let cancelReject!: (error: Error) => void;
          const cancellation = new Promise<never>((_resolve, reject) => {
            cancelReject = reject;
          });
          const cancel = () => {
            fence();
            cancelReject(new Error("Owner sign-in closed"));
          };
          active.add(cancel);
          const sdkKey = (key: string) =>
            key === AUTH_STORAGE_KEY ||
            key === AUTH_STORAGE_KEY + "-code-verifier" ||
            key === AUTH_STORAGE_KEY + "-user";
          const ownedStorage = {
            getItem(key: string) {
              // SDK detached initial-session read must be empty, not an unhandled rejection, after close.
              try {
                return live() && sdkKey(key) ? storage.getItem(key) : null;
              } catch {
                storageHealthy = false;
                return null;
              }
            },
            setItem(key: string, value: string) {
              assertLive();
              if (!sdkKey(key)) throw new Error("Storage key not allowed");
              storage.setItem(key, value);
              if (storage.getItem(key) !== value) throw new Error("Durable storage unavailable");
            },
            removeItem(key: string) {
              assertLive();
              if (!sdkKey(key)) throw new Error("Storage key not allowed");
              // A refresh/recovery/check must not consume a different pending email flow.
              if (key === AUTH_STORAGE_KEY + "-code-verifier" && !mayConsumeVerifier) return;
              storage.removeItem(key);
              if (storage.getItem(key) !== null) throw new Error("Durable storage unavailable");
            },
          };
          const ownedFetch: typeof fetch = async (input, init) => {
            assertLive();
            const abort = new AbortController();
            const incoming = init?.signal ?? (input instanceof Request ? input.signal : undefined);
            const stop = () => abort.abort();
            if (incoming?.aborted) throw new Error("Auth operation cancelled");
            incoming?.addEventListener("abort", stop, { once: true });
            pending.add(abort);
            try {
              const response = await fetcher(input, {
                ...init,
                signal: abort.signal,
              });
              assertLive();
              if (abort.signal.aborted) throw new Error("Auth operation cancelled");
              return response;
            } catch {
              throw new Error("Auth transport not confirmed");
            } finally {
              pending.delete(abort);
              incoming?.removeEventListener("abort", stop);
            }
          };
          const getClient = async (flowId?: string) => {
            assertLive();
            if (flowId !== undefined && !validFlowId(flowId)) throw new Error("Invalid flow");
            if (client && flowId !== undefined && sdkFlow !== flowId) throw new Error("Flow changed");
            if (!client) {
              sdkFlow = flowId;
              const callbackUrl = flowId ? origin + CALLBACK_PATH + "?flow=" + flowId : null;
              client = clientFactory(PROVIDER_URL, publicKey, {
                global: { fetch: providerOnlyFetch(ownedFetch, callbackUrl) },
                auth: {
                  flowType: "pkce",
                  detectSessionInUrl: false,
                  persistSession: true,
                  autoRefreshToken: false,
                  skipAutoInitialize: true,
                  storageKey: AUTH_STORAGE_KEY,
                  storage: ownedStorage,
                },
              });
              // All initialization/recovery/refresh is inside this same lease and storage fence.
              if (typeof client.auth.initialize === "function") {
                initialization = client.auth.initialize();
                void initialization.catch(() => {});
              }
            }
            const initialized = await initialization;
            assertLive();
            if (initialized && typeof initialized === "object" && "error" in initialized && initialized.error)
              throw new Error("SDK initialization not confirmed");
            // No visibility-triggered recovery may overlap an explicit SDK action.
            if (typeof client.auth.stopAutoRefresh === "function") await client.auth.stopAutoRefresh();
            assertLive();
            return client;
          };
          let busy = false;
          const sdkWork = async <R,>(call: () => Promise<R>): Promise<R> => {
            assertLive();
            if (busy) throw new Error("Overlapping SDK operation");
            busy = true;
            try {
              const result = await call();
              assertLive();
              return result;
            } catch (error) {
              if (error instanceof OwnerRequestError) throw error;
              throw new Error("Provider operation not confirmed");
            } finally {
              busy = false;
            }
          };
          const ownerRequest = async <K extends OwnerRequest>(request: K): Promise<OwnerResultMap[K["kind"]]> => {
            // Validate before constructing SDK or reading any bearer.
            const descriptor = describeOwnerRequest(request);
            if (!ownerApiEnabled) throw new OwnerRequestError("UNCONFIGURED", "not_sent");
            let sent = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => {
                csrfCache = null;
                fence();
                reject(new OwnerRequestError("TIMEOUT", sent && descriptor.mutation ? "uncertain" : "not_sent"));
              }, ownerTimeoutMs);
            });
            const action = sdkWork(async () => {
              assertLive();
              if (descriptor.kind === "enroll-current-session" || descriptor.kind === "revoke-current-session")
                csrfCache = null;
              mayConsumeVerifier = false;
              const sdk = await getClient();
              const initial = await sdk.auth.getSession();
              assertLive();
              if (initial.error || !initial.data.session) {
                csrfCache = null;
                throw new OwnerRequestError("AUTH_REQUIRED", "not_sent");
              }
              let bearer = initial.data.session.access_token;
              let context: OwnerResponseContext;
              try {
                context = tokenContext(bearer, Math.floor(now() / 1000));
              } catch (error) {
                csrfCache = null;
                throw error;
              }
              // A 30s margin avoids crossing the independently enforced 300s server bound in transit.
              if (
                descriptor.requiresFreshJwt &&
                (context.nowSeconds >= context.tokenIat + 270 || context.tokenExp - context.nowSeconds <= 30)
              ) {
                const refreshed = await sdk.auth.refreshSession();
                assertLive();
                if (refreshed.error || !refreshed.data.session) {
                  csrfCache = null;
                  throw new OwnerRequestError("AUTH_REQUIRED", "not_sent");
                }
                bearer = refreshed.data.session.access_token;
                const fresh = tokenContext(bearer, Math.floor(now() / 1000));
                if (
                  fresh.subject !== context.subject ||
                  fresh.sessionId !== context.sessionId ||
                  fresh.nowSeconds >= fresh.tokenIat + 270 ||
                  fresh.tokenExp - fresh.nowSeconds <= 30
                ) {
                  csrfCache = null;
                  throw new OwnerRequestError("TOKEN_TOO_OLD", "not_sent");
                }
                context = fresh;
              }
              if (csrfCache && (csrfCache.subject !== context.subject || csrfCache.sessionId !== context.sessionId))
                csrfCache = null;
              if (
                descriptor.kind === "control-session" &&
                csrfCache &&
                csrfCache.expiresAt - context.nowSeconds >= 15
              ) {
                return Object.freeze({
                  csrf_token: csrfCache.csrfToken,
                  expires_at: csrfCache.expiresAt,
                }) as OwnerResultMap[K["kind"]];
              }
              if (
                descriptor.kind === "control-command" &&
                (request.kind !== "control-command" ||
                  !csrfCache ||
                  request.csrfToken !== csrfCache.csrfToken ||
                  csrfCache.expiresAt - context.nowSeconds < 5)
              )
                throw new OwnerRequestError("CSRF_REFRESH_REQUIRED", "not_sent");
              const abort = new AbortController();
              pending.add(abort);
              try {
                assertLive();
                const destination = origin + descriptor.path;
                const headers = new Headers({
                  Accept: "application/json",
                  ...descriptor.headers,
                  Authorization: "Bearer " + bearer,
                });
                sent = true;
                // Origin for POST is browser-generated. Never spoof it or accept caller auth/URL headers.
                const response = await fetcher(destination, {
                  method: descriptor.method,
                  headers,
                  ...(descriptor.body !== undefined ? { body: descriptor.body } : {}),
                  signal: abort.signal,
                  credentials: "omit",
                  cache: "no-store",
                  redirect: "error",
                  referrerPolicy: "no-referrer",
                });
                assertLive();
                if (
                  abort.signal.aborted ||
                  response.redirected ||
                  (response.url !== "" && response.url !== destination)
                )
                  throw new Error("Response destination");
                const value = await readOwnerJson(response, abort.signal);
                assertLive();
                if (!response.ok) {
                  const candidate =
                    value && typeof value === "object" && "error" in value
                      ? (value as { error?: { code?: unknown } }).error?.code
                      : undefined;
                  if (response.status === 401 || response.status === 403) csrfCache = null;
                  const fallback: OwnerErrorCode =
                    response.status === 401
                      ? "AUTH_REQUIRED"
                      : response.status === 403
                        ? "OWNER_FORBIDDEN"
                        : response.status === 409
                          ? "STALE"
                          : response.status === 422
                            ? "BLOCKED"
                            : "CONTROL_SERVICE_UNAVAILABLE";
                  const code =
                    typeof candidate === "string" && serverErrorCodes.has(candidate as OwnerErrorCode)
                      ? (candidate as OwnerErrorCode)
                      : fallback;
                  throw new OwnerRequestError(
                    code,
                    descriptor.mutation && response.status >= 500 ? "uncertain" : "rejected",
                    response.status,
                  );
                }
                if (response.status !== 200 && !(descriptor.kind === "control-command" && response.status === 202))
                  throw new OwnerRequestError(
                    "INVALID_RESPONSE",
                    descriptor.mutation ? "uncertain" : "rejected",
                    response.status,
                  );
                const result = parseOwnerResponse(descriptor.kind, value, {
                  ...context,
                  nowSeconds: Math.floor(now() / 1000),
                });
                if (
                  (descriptor.kind === "control-command" || descriptor.kind === "control-receipt") &&
                  "command_id" in result
                ) {
                  const expected =
                    request.kind === "control-command"
                      ? request.command.command_id
                      : request.kind === "control-receipt"
                        ? request.commandId
                        : "";
                  if (result.command_id !== expected) throw new OwnerRequestError("INVALID_RESPONSE", "uncertain");
                }
                if (descriptor.kind === "control-session" && "csrf_token" in result)
                  csrfCache = {
                    subject: context.subject,
                    sessionId: context.sessionId,
                    csrfToken: result.csrf_token,
                    expiresAt: result.expires_at,
                  };
                return result as OwnerResultMap[K["kind"]];
              } catch (error) {
                if (error instanceof OwnerRequestError) throw error;
                throw new OwnerRequestError(
                  "CONTROL_SERVICE_UNAVAILABLE",
                  sent && descriptor.mutation ? "uncertain" : "not_sent",
                );
              } finally {
                bearer = "";
                pending.delete(abort);
              }
            });
            try {
              return await Promise.race([action, timeout]);
            } finally {
              clearTimeout(timer);
            }
          };
          const lease: LockedOwnerAuth = Object.freeze({
            ownerRequest,
            signOutWithRevocation: async (): Promise<OwnerSignOutResult> => {
              let appRevocation: OwnerSignOutResult["appRevocation"] = "not_configured";
              if (ownerApiEnabled) {
                try {
                  await ownerRequest({ kind: "revoke-current-session" });
                  appRevocation = "confirmed";
                } catch (error) {
                  appRevocation =
                    error instanceof OwnerRequestError && error.outcome === "rejected" ? "rejected" : "uncertain";
                }
              }
              if (!open || closed) return { appRevocation, providerSignOut: "not_attempted" };
              try {
                await lease.signOut();
                return { appRevocation, providerSignOut: "confirmed" };
              } catch {
                return { appRevocation, providerSignOut: "uncertain" };
              }
            },
            store: Object.freeze({
              getItem(key: string) {
                assertLive();
                if (key !== JOURNAL_KEY && key !== ENROLLMENT_JOURNAL_KEY) throw new Error("Journal key not allowed");
                return storage.getItem(key);
              },
              setItem(key: string, value: string) {
                assertLive();
                if (key !== JOURNAL_KEY && key !== ENROLLMENT_JOURNAL_KEY) throw new Error("Journal key not allowed");
                storage.setItem(key, value);
              },
            }),
            newFlowId() {
              assertLive();
              const id = randomUUID();
              if (!validFlowId(id)) throw new Error("Secure randomness unavailable");
              return id;
            },
            sendLink: (email: string, flowId: string) =>
              sdkWork(async () => {
                const sdk = await getClient(flowId);
                mayConsumeVerifier = true;
                const { error } = await sdk.auth.signInWithOtp({
                  email,
                  options: {
                    shouldCreateUser: false,
                    emailRedirectTo: origin + CALLBACK_PATH + "?flow=" + flowId,
                  },
                });
                if (error) throw new Error("Sign-in request not confirmed");
              }),
            exchangeCode: (code: string, flowId: string) =>
              sdkWork(async () => {
                const sdk = await getClient(flowId);
                mayConsumeVerifier = true;
                const { data, error } = await sdk.auth.exchangeCodeForSession(code);
                if (error || !data.session || !data.user) throw new Error("Sign-in link not verified");
              }),
            currentIdentity: () =>
              sdkWork(async (): Promise<Identity> => {
                mayConsumeVerifier = false;
                const { data, error } = await (await getClient()).auth.getUser();
                if (isAuthSessionMissingError(error)) return { kind: "signed_out" };
                if (error) throw new Error("Current sign-in not confirmed");
                const user = data.user;
                if (!user || user.is_anonymous !== false) return { kind: "signed_out" };
                return {
                  kind: "signed_in",
                  emailVerified: confirmedEmail(user.email_confirmed_at, now()),
                  ...(typeof user.email === "string" && validEmail(user.email) ? { email: user.email } : {}),
                };
              }),
            signOut: () =>
              sdkWork(async () => {
                csrfCache = null;
                const sdk = await getClient();
                mayConsumeVerifier = true;
                const { error } = await sdk.auth.signOut({ scope: "local" });
                if (error) throw new Error("Sign-out not confirmed");
              }),
          });
          try {
            return await Promise.race([
              Promise.resolve().then(() => {
                assertLive();
                return work(lease);
              }),
              cancellation,
            ]);
          } finally {
            fence();
            active.delete(cancel);
          }
        });
      } catch (error) {
        if (error instanceof OwnerRequestError) throw error;
        throw new Error("Owner sign-in operation not confirmed");
      } finally {
        clearTimeout(queueTimer);
        queued.delete(waiting);
      }
    },
  });
}

export function browserRuntime(): BrowserRuntime | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return {
      origin: window.location.origin,
      isTopLevel: window.top === window.self,
      localStorage: window.localStorage,
      locks: window.navigator.locks,
      randomUUID: () => window.crypto.randomUUID(),
      fetch: window.fetch.bind(window),
    };
  } catch {
    return undefined;
  }
}
