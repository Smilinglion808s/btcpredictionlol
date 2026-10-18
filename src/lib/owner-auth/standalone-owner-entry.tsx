import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { JOURNAL_KEY, ENROLLMENT_JOURNAL_KEY } from "./owner-login";
import { OwnerLoginPage } from "./owner-login-view";
import { AUTH_STORAGE_KEY, browserRuntime, createReviewedOwnerAuth } from "./pinned-supabase-adapter";
import { startOwnerPage, type StartupInput } from "./standalone-owner-startup";

/** Dedicated browser bundle entry, never the normal application entry/root/error handler. */
export function startStandaloneOwnerPage(input: StartupInput): () => void {
  const node = document.getElementById("owner-auth-root");
  if (!node) return () => {};
  let root: Root | null = null;
  return startOwnerPage(
    input,
    {
      location: window.location,
      replaceState: (path) => window.history.replaceState(null, "", path),
      onSessionChange: (changed) => {
        const receive = (event: StorageEvent) => {
          if (
            event.storageArea === window.localStorage &&
            (event.key === AUTH_STORAGE_KEY ||
              event.key === JOURNAL_KEY ||
              event.key === ENROLLMENT_JOURNAL_KEY ||
              event.key === null)
          )
            changed();
        };
        const refresh = () => {
          if (document.visibilityState === "visible") changed();
        };
        window.addEventListener("storage", receive);
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
          window.removeEventListener("storage", receive);
          window.removeEventListener("focus", refresh);
          document.removeEventListener("visibilitychange", refresh);
        };
      },
      onLeave: (leave) => {
        for (const event of ["pagehide", "popstate", "hashchange"]) window.addEventListener(event, leave);
        return () => {
          for (const event of ["pagehide", "popstate", "hashchange"]) window.removeEventListener(event, leave);
        };
      },
    },
    {
      mount: (controller) => {
        root = createRoot(node);
        root.render(<OwnerLoginPage controller={controller} />);
      },
      unmount: () => {
        root?.unmount();
        root = null;
      },
      unavailable: () => {
        node.textContent = "Sign-in is unavailable. Reload this page to try again.";
      },
    },
    (config) => createReviewedOwnerAuth(config ?? undefined, browserRuntime()),
  );
}
