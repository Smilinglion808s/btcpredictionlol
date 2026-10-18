import { createBrowserOwnerControlAdapter } from "../lib/owner-control-browser";
import { subscribeOwnerSessionInvalidation } from "../lib/owner-session-invalidation";
import { createOwnerBoundWalletController } from "../lib/wallet-public/owner-wallet-runtime";
import { WalletConnectionPanel } from "../lib/wallet-public/wallet-connection-panel";
import "../lib/wallet-public/wallet-connection-panel.css";

// Stable factory, not a singleton: the panel owns a fresh adapter/controller
// for each effect, including a StrictMode remount. Construction never connects.
const createController = () =>
  createOwnerBoundWalletController({ createOwnerAdapter: createBrowserOwnerControlAdapter });

export function OwnerWalletConnection() {
  return (
    <WalletConnectionPanel
      createController={createController}
      subscribeOwnerInvalidation={subscribeOwnerSessionInvalidation}
    />
  );
}
