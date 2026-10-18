import { parseReadiness, READINESS_PATH, ReadinessError, type ReadinessDTO } from "./contract";
import { ControlError, type Transport } from "../solana-live-control";
import type { WalletLoginController, Snapshot } from "./controller";

export function verifiedWalletSession(snapshot: Snapshot, now: number): string | null {
  return snapshot.phase === "authenticated" && snapshot.session !== null && Date.parse(snapshot.session.expiresAt) > now
    ? snapshot.session.sessionId
    : null;
}

/** Display evidence never grants server authority. It only denies local requests
 * when the reviewed login controller has no current server-verified session.
 * The backend independently checks the opaque cookie for EVERY request.
 */
export function createWalletControlRuntime(
  login: Pick<WalletLoginController, "getSnapshot" | "subscribe" | "invalidateSession">,
  upstream: Transport,
  onBindingChange: () => void,
  now: () => number = Date.now,
) {
  let closed = false,
    epoch = 0;
  let binding = verifiedWalletSession(login.getSnapshot(), now());
  const off = login.subscribe(() => {
    const next = verifiedWalletSession(login.getSnapshot(), now());
    if (next !== binding) {
      binding = next;
      epoch++;
      onBindingChange();
    }
  });
  const run = async <T,>(operation: () => Promise<T>, mutation = false): Promise<T> => {
    const id = verifiedWalletSession(login.getSnapshot(), now());
    if (closed || id === null || id !== binding)
      throw new ControlError("auth", "Sign in with your owner wallet in the header. No command was sent.");
    const ticket = epoch;
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      // Only the existing transport's definitive 401/403 classification clears
      // display authentication. A timeout or backend outage is NOT sign-out.
      if (!closed && ticket === epoch && error instanceof ControlError && error.code === "auth")
        login.invalidateSession();
      throw error;
    }
    if (closed || ticket !== epoch || id !== verifiedWalletSession(login.getSnapshot(), now()))
      throw new ControlError(
        mutation ? "uncertain" : "auth",
        mutation
          ? "Session changed while the request was in flight. Its outcome is unconfirmed; no automatic retry."
          : "The wallet session changed. Fresh owner verification is required.",
      );
    return result;
  };
  const transport: Transport = {
    session: () => run(() => upstream.session()),
    status: () => run(() => upstream.status()),
    receipt: (id) => run(() => upstream.receipt(id)),
    command: (command, csrf) => run(() => upstream.command(command, csrf), true),
  };
  return {
    transport,
    close() {
      if (closed) return;
      closed = true;
      epoch++;
      off();
    },
  };
}

type ReadinessLogin = Pick<WalletLoginController, "getSnapshot" | "subscribe" | "invalidateSession">;
export interface ReadinessSnapshot {
  readonly phase: "signed_out" | "loading" | "ready" | "unavailable";
  readonly value: ReadinessDTO | null;
}
export type ReadinessReader = (signal: AbortSignal) => Promise<unknown>;
/** Same-origin GET only. No CSRF, identity, session ID or local-storage authority. */
export async function readOwnerReadiness(signal: AbortSignal): Promise<unknown> {
  const response = await fetch(READINESS_PATH, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: { Accept: "application/json" },
    signal,
  });
  if (response.status === 401 || response.status === 403) throw new ReadinessError("auth");
  if (
    response.status !== 200 ||
    response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json"
  )
    throw new ReadinessError("unavailable");
  // Bound both bytes and parsing. An untrusted upstream cannot produce a giant UI payload.
  if (!response.body) throw new ReadinessError("invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) throw new ReadinessError("invalid");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}
/** Inert construction. A fresh verified session triggers one read; only explicit
 * refresh triggers another. Expiry timers clear display evidence, never poll.
 * Backend cookie verification on every GET remains the authority after restarts.
 */
export function createReadinessRuntime(
  login: ReadinessLogin,
  read: ReadinessReader = readOwnerReadiness,
  now = Date.now,
) {
  let active = false,
    closed = false,
    generation = 0;
  let binding: string | null = null;
  let request: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let sessionExpiry: ReturnType<typeof setTimeout> | undefined;
  let off: (() => void) | undefined;
  let state: ReadinessSnapshot = Object.freeze({ phase: "signed_out", value: null });
  const listeners = new Set<() => void>();
  const emit = (next: ReadinessSnapshot) => {
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    generation++;
    request?.abort();
    request = null;
    clearTimeout(timeout);
    clearTimeout(expiry);
  };
  const current = () => verifiedWalletSession(login.getSnapshot(), now());
  const refresh = async () => {
    const id = current();
    if (!active || closed || id === null || id !== binding || state.phase === "loading") return;
    cancel();
    const ticket = generation;
    const abort = new AbortController();
    request = abort;
    emit({ phase: "loading", value: null });
    const stillCurrent = () => active && !closed && generation === ticket && binding === id && current() === id;
    if (!stillCurrent()) return;
    timeout = setTimeout(() => {
      if (!stillCurrent()) return;
      cancel();
      emit({ phase: "unavailable", value: null });
    }, 10000);
    try {
      const result = await read(abort.signal);
      if (!stillCurrent()) return;
      const value = parseReadiness(result, now());
      // The response must not claim a longer session than the currently verified login.
      const localExpiry = Date.parse(login.getSnapshot().session!.expiresAt);
      if (value.session_expires_at * 1000 > localExpiry) throw new ReadinessError("invalid");
      clearTimeout(timeout);
      request = null;
      emit({ phase: "ready", value });
      expiry = setTimeout(
        () => {
          if (generation !== ticket || closed) return;
          cancel();
          emit({ phase: current() === id ? "unavailable" : "signed_out", value: null });
        },
        Math.max(0, Math.min(localExpiry, value.session_expires_at * 1000, value.checked_at * 1000 + 30000) - now()),
      );
    } catch (error) {
      if (!stillCurrent()) return;
      clearTimeout(timeout);
      request = null;
      if (error instanceof ReadinessError && error.kind === "auth") {
        cancel();
        emit({ phase: "signed_out", value: null });
        login.invalidateSession();
      } else emit({ phase: "unavailable", value: null });
    }
  };
  const sync = () => {
    const next = current();
    if (next === binding) return;
    cancel();
    clearTimeout(sessionExpiry);
    binding = next;
    emit({ phase: "signed_out", value: null });
    if (next !== null) {
      // Session expiry is independent of successful responses: pending and failed
      // requests must also lose owner visibility, even without a provider tick.
      sessionExpiry = setTimeout(
        () => {
          if (closed || binding !== next) return;
          cancel();
          binding = null;
          emit({ phase: "signed_out", value: null });
        },
        Math.max(0, Date.parse(login.getSnapshot().session!.expiresAt) - now()),
      );
      void refresh();
    }
  };
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (active || closed) return;
      active = true;
      off = login.subscribe(sync);
      sync();
    },
    refresh,
    close() {
      if (closed) return;
      closed = true;
      active = false;
      cancel();
      clearTimeout(sessionExpiry);
      off?.();
      listeners.clear();
      state = Object.freeze({ phase: "signed_out", value: null });
    },
  };
}
