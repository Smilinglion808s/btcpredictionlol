import { AUTH_STORAGE_KEY } from "./owner-auth/pinned-supabase-adapter";
import { ENROLLMENT_JOURNAL_KEY, JOURNAL_KEY } from "./owner-auth/owner-login";
import type { OwnerInvalidation } from "./wallet-public/owner-evidence";

type Listener = (reason: OwnerInvalidation) => void;
const listeners = new Set<() => void>();

/** Notification only: never carries identity, credentials or authorization. */
export function emitOwnerSessionInvalidation(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A broken subscriber must not delay sign-out or other invalidations.
    }
  }
}

/** Stable, memory-only same-tab relay plus key-only cross-tab invalidation. */
export function subscribeOwnerSessionInvalidation(listener: Listener): () => void {
  let active = true;
  const notify = () => {
    if (active) listener("session_changed");
  };
  const storage = (event: StorageEvent) => {
    // Do not inspect storageArea, oldValue, newValue or any storage content.
    const key = event.key;
    if (
      key === null ||
      key === AUTH_STORAGE_KEY ||
      key === JOURNAL_KEY ||
      key === ENROLLMENT_JOURNAL_KEY
    ) {
      try {
        notify();
      } catch {
        // Storage notifications cannot grant authority or change auth behavior.
      }
    }
  };
  const target = typeof window === "undefined" ? null : window;
  listeners.add(notify);
  try {
    target?.addEventListener("storage", storage);
  } catch {
    active = false;
    listeners.delete(notify);
    try {
      target?.removeEventListener("storage", storage);
    } catch {
      // No active subscriber survives a failed setup.
    }
    throw new Error("Owner invalidation unavailable");
  }
  return () => {
    if (!active) return;
    active = false;
    listeners.delete(notify);
    target?.removeEventListener("storage", storage);
  };
}
