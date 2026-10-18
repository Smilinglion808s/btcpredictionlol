import { ControlError, type Transport } from "../solana-live-control";
import type { WalletLoginController, Snapshot } from "./controller";

export function verifiedWalletSession(snapshot: Snapshot, now: number): string | null {
  return snapshot.phase === "authenticated" &&
    snapshot.session !== null &&
    Date.parse(snapshot.session.expiresAt) > now
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
  const run = async <T>(operation: () => Promise<T>, mutation = false): Promise<T> => {
    const id = verifiedWalletSession(login.getSnapshot(), now());
    if (closed || id === null || id !== binding)
      throw new ControlError(
        "auth",
        "Sign in with your owner wallet in the header. No command was sent.",
      );
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
