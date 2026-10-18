import { createBrowserOwnerControlAdapter } from "../lib/owner-control-browser";
import { subscribeOwnerSessionInvalidation } from "../lib/owner-session-invalidation";
import { createOwnerBoundWalletController } from "../lib/wallet-public/owner-wallet-runtime";
import { WalletConnectionPanel } from "../lib/wallet-public/wallet-connection-panel";
import "../lib/wallet-public/wallet-connection-panel.css";

// Stable factory, not a singleton: the panel owns a fresh adapter/controller
// for each effect, including a StrictMode remount. Construction never connects.
const createController = () =>
  createOwnerBoundWalletController({ createOwnerAdapter: createBrowserOwnerControlAdapter });

/** Opens the existing explicit enrollment action. It never clicks it or sends a request. */
export function focusOwnerSessionControls() {
  const outer = document.getElementById("solana-live-panel");
  const session = document.getElementById("owner-session-access");
  if (outer instanceof HTMLDetailsElement) outer.open = true;
  if (session instanceof HTMLDetailsElement) session.open = true;
  const enable = document.getElementById("owner-session-enable");
  const summary = session?.querySelector("summary");
  const target = enable instanceof HTMLButtonElement && !enable.disabled ? enable : summary;
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (target instanceof HTMLElement) target.focus();
}
export function OwnerWalletConnection() {
  return (
    <WalletConnectionPanel
      presentation="header"
      onOpenSessionControls={focusOwnerSessionControls}
      createController={createController}
      subscribeOwnerInvalidation={subscribeOwnerSessionInvalidation}
    />
  );
}
