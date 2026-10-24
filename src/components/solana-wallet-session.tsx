import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { getWallets } from "@wallet-standard/app";
import { WalletLoginController } from "../lib/wallet-siws/controller";
import { createWalletHostRuntime, WALLET_INVALIDATION_CHANNEL } from "../lib/wallet-siws/host-runtime";
import {
  WalletLoginProvider,
  WalletLoginHeader,
  WalletSessionStatus,
  useWalletLogin,
} from "../lib/wallet-siws/wallet-login-header";
import { StandardBackendControls } from "./standard-backend-controls";
import {
  createReadinessRuntime,
  type ReadinessSnapshot,
} from "../lib/wallet-siws/control-runtime";

/** Route-owned context. SSR is inert. StrictMode creates a NEW runtime on setup,
 * permanently fencing the cleaned-up controller rather than reviving its SDK work.
 */
export function SolanaWalletSessionProvider({ children }: { children: ReactNode }) {
  const [controller, setController] = useState(() => new WalletLoginController());
  useEffect(() => {
    const runtime = createWalletHostRuntime({
      origin: window.location.origin,
      isTopLevel: window.top === window,
      registry: getWallets,
      channel: () => {
        const channel = new BroadcastChannel(WALLET_INVALIDATION_CHANNEL);
        const port = {
          onmessage: null as ((event: { data: unknown }) => void) | null,
          postMessage: (message: "invalidate") => channel.postMessage(message),
          close: () => {
            channel.onmessage = null;
            channel.close();
          },
        };
        channel.onmessage = (event) => port.onmessage?.({ data: event.data as unknown });
        return port;
      },
    });
    setController(runtime.controller);
    runtime.start();
    return () => runtime.close();
  }, []);
  return <WalletLoginProvider controller={controller}>{children}</WalletLoginProvider>;
}

export function SolanaWalletHeader() {
  return (
    <WalletLoginHeader
      onReviewControls={() => {
        const panel = document.getElementById("solana-live-panel");
        if (panel instanceof HTMLDetailsElement) {
          panel.open = true;
          const summary = panel.querySelector("summary");
          summary?.scrollIntoView({ block: "center" });
          summary?.focus();
        }
      }}
    />
  );
}

/** No legacy email owner controller/SDK is mounted. The same wallet store drives
 * the header and this panel; every network command still authenticates on server.
 */
export function WalletSolanaControls() {
  const { controller } = useWalletLogin();
  return <WalletControlsInstance key={controllerKey(controller)} controller={controller} />;
}
const controllerIds = new WeakMap<WalletLoginController, number>();
let nextId = 0;
function controllerKey(controller: WalletLoginController) {
  let id = controllerIds.get(controller);
  if (id === undefined) {
    id = ++nextId;
    controllerIds.set(controller, id);
  }
  return id;
}
function WalletControlsInstance({ controller }: { controller: WalletLoginController }) {
  return <StandardBackendControls controller={controller} />;
}

export function OwnerReadiness({ controller }: { controller: WalletLoginController }) {
  const [runtime, setRuntime] = useState(() => createReadinessRuntime(controller));
  const state = useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
  useEffect(() => {
    // StrictMode cleanup permanently fences its old requests.
    const current = createReadinessRuntime(controller);
    setRuntime(current);
    current.start();
    return () => current.close();
  }, [controller]);
  return (
    <OwnerReadinessStatus
      state={state}
      onRefresh={() => {
        void runtime.refresh();
      }}
    />
  );
}
export function OwnerReadinessStatus({ state, onRefresh }: { state: ReadinessSnapshot; onRefresh: () => void }) {
  if (state.phase === "signed_out") return null;
  const control = state.value?.control;
  return (
    <section
      className="sr-card rounded-xl border border-violet-400/30 bg-violet-400/5 p-4"
      aria-label="Owner setup status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="sr-eyebrow">OWNER SETUP · EXECUTION OFF</p>
        <button
          type="button"
          className="rounded-md border border-violet-400/40 px-3 py-1 text-xs font-semibold disabled:opacity-50"
          onClick={onRefresh}
          disabled={state.phase === "loading"}
        >
          Refresh setup
        </button>
      </div>
      <div role="status" aria-live="polite">
        <p className="mt-2 text-sm font-semibold">
          {state.phase === "loading"
            ? "Checking local setup…"
            : state.phase === "unavailable"
              ? "Setup check unavailable"
              : "Setup incomplete"}
        </p>
        {state.value && (
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>Connect market data.</li>
            <li>Provision the live worker, signer and risk limits.</li>
            <li>Review automation permissions separately.</li>
            {(control?.halted || control?.reconciliation_required) && (
              <li>Review the safety hold and reconcile control state.</li>
            )}
            {(control?.worker_stale || control?.pending_ack) && <li>Verify a fresh worker acknowledgment.</li>}
          </ul>
        )}
        {state.phase === "unavailable" && (
          <p className="mt-1 text-xs text-muted-foreground">
            Refresh to try again. No readiness or permission is assumed.
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Local check only, not market or chain verification. No trading enabled.
        </p>
      </div>
    </section>
  );
}
