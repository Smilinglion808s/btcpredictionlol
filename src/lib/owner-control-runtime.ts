import { ControlError, type Transport } from './solana-live-control';
import type { OwnerAuthAdapter } from './owner-auth/owner-login';
import { createOwnerControlTransport } from './owner-auth/owner-control-transport';

export interface OwnerControlRuntime {
  readonly transport: Transport;
  activate(): void;
  close(): void;
}
/** Stable UI transport, fresh adapter per effect lifetime. StrictMode's cleanup
 * permanently closes its old SDK adapter; a later activation never reuses it.
 * No token, credential, identity or raw SDK session is exposed by this boundary.
 */
export function createOwnerControlRuntime(
  createAdapter: () => OwnerAuthAdapter,
  bridge: (adapter: OwnerAuthAdapter) => Transport = createOwnerControlTransport,
): OwnerControlRuntime {
  let current: { adapter: OwnerAuthAdapter; transport: Transport } | null = null;
  let poisoned = false;
  const selected = (): Transport => {
    if (!current) throw new ControlError('unavailable', 'Owner control connection is unavailable. No command is confirmed.');
    return current.transport;
  };
  const close = () => {
    const old = current;
    current = null;
    // Closing invalidates SDK/network/storage leases before another activation.
    try { old?.adapter.close(); } catch { poisoned = true; }
  };
  return {
    transport: {
      async session() { return selected().session(); },
      async status() { return selected().status(); },
      async receipt(commandId) { return selected().receipt(commandId); },
      async command(command, csrfToken) { return selected().command(command, csrfToken); },
    },
    activate() {
      close();
      if (poisoned) return;
      let adapter: OwnerAuthAdapter | undefined;
      try {
        adapter = createAdapter();
        current = { adapter, transport: bridge(adapter) };
      } catch {
        try { adapter?.close(); } catch { poisoned = true; }
        current = null;
      }
    },
    close,
  };
}
