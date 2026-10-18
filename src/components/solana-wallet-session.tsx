import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getWallets } from "@wallet-standard/app";
import { WalletLoginController } from "../lib/wallet-siws/controller";
import {
  createWalletHostRuntime,
  WALLET_INVALIDATION_CHANNEL,
} from "../lib/wallet-siws/host-runtime";
import {
  WalletLoginProvider,
  WalletLoginHeader,
  WalletSessionStatus,
  useWalletLogin,
} from "../lib/wallet-siws/wallet-login-header";
import {
  ControlClient,
  createHttpTransport,
  sessionPendingStore,
} from "../lib/solana-live-control";
import { createWalletControlRuntime } from "../lib/wallet-siws/control-runtime";
import { createControlPoller, type ControlPoller } from "../lib/owner-control-polling";
import { LiveControlPanel } from "./solana-live-controls";

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
  const pollerRef = useRef<ControlPoller | null>(null);
  const [client] = useState(
    () =>
      new ControlClient({
        session: async () => {
          throw new Error("Mount not active");
        },
        status: async () => {
          throw new Error("Mount not active");
        },
        receipt: async () => {
          throw new Error("Mount not active");
        },
        command: async () => {
          throw new Error("Mount not active");
        },
      }),
  );
  const [activeClient, setActiveClient] = useState(client);
  const state = useSyncExternalStore(
    activeClient.subscribe,
    activeClient.snapshot,
    activeClient.snapshot,
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const runtime = createWalletControlRuntime(controller, createHttpTransport(), () => {
      current.activate();
      pollerRef.current?.refreshNow();
    });
    let store;
    try {
      store = sessionPendingStore(window.sessionStorage);
    } catch {
      store = {
        read: () => {
          throw new Error("Journal unavailable");
        },
        write: () => {
          throw new Error("Journal unavailable");
        },
      };
    }
    const current = new ControlClient(runtime.transport, Date.now, undefined, store);
    current.activate();
    setActiveClient(current);
    const poller = createControlPoller({
      refresh: () => current.refresh(),
      healthy: () => current.snapshot().connection === "connected",
      visible: () => document.visibilityState === "visible",
    });
    pollerRef.current = poller;
    poller.start();
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 1000);
    const visible = () => {
      setNow(Date.now());
      poller.visibilityChanged();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      runtime.close();
      current.close();
      poller.close();
      clearInterval(tick);
      if (pollerRef.current === poller) pollerRef.current = null;
      document.removeEventListener("visibilitychange", visible);
    };
  }, [controller]);
  return (
    <LiveControlPanel
      state={state}
      now={now}
      onCommand={(action) => {
        void activeClient.send(action);
      }}
      onRefresh={() => pollerRef.current?.refreshNow()}
      ownerStatus={<WalletSessionStatus />}
    />
  );
}
