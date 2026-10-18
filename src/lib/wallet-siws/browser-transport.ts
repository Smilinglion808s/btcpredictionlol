import {
  WalletAuthRemoteError,
  BoundaryError,
  type BackendPort,
  type VerifyRequest,
} from "./contract";
const ORIGIN = "https://btcpredictionlol.lovable.app";
const paths = {
  challenge: "/api/wallet-auth/challenge",
  verify: "/api/wallet-auth/verify",
  session: "/api/wallet-auth/session",
  cancel: "/api/wallet-auth/cancel",
  logout: "/api/wallet-auth/logout",
} as const;
export interface WalletBrowserBoundary {
  readonly origin: string;
  readonly isTopLevel: boolean;
}
/** Fixed same-origin cookie transport. No caller URL, bearer, storage, token reader,
 * redirect, automatic replay or arbitrary fetch capability escapes this port. */
export function createWalletBackend(
  boundary: WalletBrowserBoundary | null = null,
  fetcher: typeof fetch = fetch,
): BackendPort {
  const origin =
    boundary && typeof boundary === "object"
      ? Object.getOwnPropertyDescriptor(boundary, "origin")
      : undefined;
  const top =
    boundary && typeof boundary === "object"
      ? Object.getOwnPropertyDescriptor(boundary, "isTopLevel")
      : undefined;
  const configured =
    !!origin &&
    "value" in origin &&
    origin.value === ORIGIN &&
    !!top &&
    "value" in top &&
    top.value === true;
  async function request(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
    csrf?: string,
  ): Promise<unknown> {
    if (!configured) throw new BoundaryError("UNCONFIGURED");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5000);
    let sent = false;
    const race = <T>(promise: Promise<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        const stop = () => {
          cleanup();
          reject(
            new WalletAuthRemoteError(
              sent && method === "POST" ? "RESULT_UNCERTAIN" : "SERVICE_UNAVAILABLE",
              null,
              sent && method === "POST" ? "uncertain" : "unavailable",
            ),
          );
        };
        const cleanup = () => abort.signal.removeEventListener("abort", stop);
        abort.signal.addEventListener("abort", stop, { once: true });
        promise.then(
          (v) => {
            cleanup();
            resolve(v);
          },
          (e) => {
            cleanup();
            reject(e);
          },
        );
        if (abort.signal.aborted) stop();
      });
    try {
      const headers = new Headers({ Accept: "application/json" });
      let encoded: string | undefined;
      if (method === "POST") {
        headers.set("Content-Type", "application/json");
        encoded = JSON.stringify(body);
        if (!encoded || new TextEncoder().encode(encoded).byteLength > 4096)
          throw new BoundaryError("INVALID_REQUEST");
        if (csrf !== undefined) {
          if (typeof csrf !== "string" || !/^[a-f0-9]{64}$/.test(csrf))
            throw new BoundaryError("INVALID_REQUEST");
          headers.set("X-CSRF-Token", csrf);
        }
      }
      sent = true;
      const result = await race(
        fetcher(path, {
          method,
          headers,
          body: encoded,
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: abort.signal,
        }),
      );
      if (
        result.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !==
        "application/json"
      )
        throw new Error("Invalid response");
      const reader = result.body?.getReader();
      if (!reader) throw new Error("Empty response");
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await race(reader.read());
          if (part.done) break;
          size += part.value.length;
          if (size > 65536) throw new Error("Large response");
          parts.push(part.value);
        }
      } catch (error) {
        void reader.cancel().catch(() => {});
        throw error;
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* Canceled pending read stays fenced. */
        }
      }
      const bytes = new Uint8Array(size);
      let off = 0;
      for (const part of parts) {
        bytes.set(part, off);
        off += part.length;
      }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (result.status !== 200) {
        if (
          result.status >= 400 &&
          result.status < 500 &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          const record = value as Record<string, unknown>,
            error = record.error;
          if (
            Object.keys(record).length === 2 &&
            record.schema_version === 1 &&
            error &&
            typeof error === "object" &&
            !Array.isArray(error)
          ) {
            const e = error as Record<string, unknown>;
            if (
              Object.keys(e).length === 1 &&
              typeof e.code === "string" &&
              /^[A-Z][A-Z0-9_]{0,63}$/.test(e.code)
            )
              throw new WalletAuthRemoteError(e.code, result.status, "denied");
          }
        }
        throw new Error("Unconfirmed response");
      }
      return value;
    } catch (error) {
      if (error instanceof BoundaryError) throw error;
      throw new WalletAuthRemoteError(
        sent && method === "POST" ? "RESULT_UNCERTAIN" : "SERVICE_UNAVAILABLE",
        null,
        sent && method === "POST" ? "uncertain" : "unavailable",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({
    createChallenge: () => request(paths.challenge, "POST", {}),
    verifyProof: (proof: VerifyRequest, csrf: string) => request(paths.verify, "POST", proof, csrf),
    readSession: () => request(paths.session, "GET"),
    cancelChallenge: (challengeId: string, csrf: string) => {
      if (typeof challengeId !== "string" || !/^[a-f0-9]{32}$/.test(challengeId))
        return Promise.reject(new BoundaryError("INVALID_REQUEST"));
      return request(paths.cancel, "POST", { challenge_id: challengeId }, csrf);
    },
    logout: (csrf: string) => request(paths.logout, "POST", {}, csrf),
  });
}
