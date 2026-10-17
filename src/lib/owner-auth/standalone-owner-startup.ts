import {
  CALLBACK_PATH,
  OwnerLoginController,
  type OwnerAuthAdapter,
} from "./owner-login";
import type { ReviewedBrowserConfig } from "./pinned-supabase-adapter";
export interface StartupInput {
  mode: "login" | "callback";
  callbackUrl: string | null;
  config: ReviewedBrowserConfig | null;
}
export interface StartupRuntime {
  readonly location: {
    readonly origin: string;
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
  };
  replaceState(path: string): void;
  onLeave(callback: () => void): () => void;
  onSessionChange?(callback: () => void): () => void;
}
export interface StartupView {
  mount(controller: OwnerLoginController): void;
  unmount(): void;
  unavailable(): void;
}
/** Only entered after synchronous head bootstrap capture/scrub. No app/root/analytics dependency. */
export function startOwnerPage(
  input: StartupInput,
  runtime: StartupRuntime,
  view: StartupView,
  createAuth: (config: ReviewedBrowserConfig | null) => OwnerAuthAdapter,
): () => void {
  const expectedPath =
    input.mode === "callback" ? CALLBACK_PATH : "/owner/login";
  const origin = "https://btcpredictionlol.lovable.app";
  let controller: OwnerLoginController | null = null;
  let auth: OwnerAuthAdapter | null = null;
  let off: (() => void) | null = null;
  let offStorage: (() => void) | null = null;
  let closed = false;
  let callbackUrl = input.callbackUrl;
  input.callbackUrl = null; // Do not leave raw callback data in a caller-owned object.
  const clean = () =>
    runtime.location.origin === origin &&
    runtime.location.pathname === expectedPath &&
    runtime.location.search === "" &&
    runtime.location.hash === "";
  const dispose = () => {
    if (closed) return;
    closed = true;
    callbackUrl = null;
    if (controller) controller.close();
    else {
      try {
        auth?.close?.();
      } catch {
        /* Teardown remains local and sanitized. */
      }
    }
    off?.();
    offStorage?.();
    view.unmount();
    view.unavailable(); // Covers bfcache restore too: a closed controller never looks actionable.
  };
  try {
    if (
      !clean() ||
      !["login", "callback"].includes(input.mode) ||
      (input.mode === "callback" && typeof callbackUrl !== "string")
    )
      throw new Error("Unavailable");
    const removeLeave = runtime.onLeave(dispose);
    if (closed) {
      removeLeave();
      return dispose;
    }
    off = removeLeave;
    auth = createAuth(input.config);
    if (closed) {
      try {
        auth.close?.();
      } catch {
        /* Already closed. */
      }
      return dispose;
    }
    if (!clean()) {
      dispose();
      return dispose;
    }
    controller = new OwnerLoginController(auth, origin);
    if (closed) {
      controller.close();
      return dispose;
    }
    const ownedController = controller;
    offStorage = runtime.onSessionChange?.(() => ownedController.notifySessionChanged()) ?? null;
    if (closed) { offStorage?.(); return dispose; }
    view.mount(controller);
    if (closed) return dispose;
    if (input.mode === "login") void controller.initialize();
    if (input.mode === "callback" && callbackUrl) {
      const local = callbackUrl;
      callbackUrl = null;
      void controller.completeCallback(local, {
        scrub: () => {
          runtime.replaceState(CALLBACK_PATH);
          if (!clean()) throw new Error("Scrub failed");
        },
      });
    }
  } catch {
    dispose();
  }
  return dispose;
}
