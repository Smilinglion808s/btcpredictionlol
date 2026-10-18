import { WalletLoginController } from "./controller";
import { PUBLIC_ORIGIN, PUBLIC_URI, STATEMENT, type LoginConfig } from "./contract";
import { createWalletBackend } from "./browser-transport";
import type { StandardWalletCandidate } from "./provider";

export const WALLET_INVALIDATION_CHANNEL = "solana-wallet-session-notify-v1";
export const WALLET_INVALIDATION_MESSAGE = "invalidate";
export interface WalletRegistry {
  get(): readonly StandardWalletCandidate[];
  on(event: "register" | "unregister", callback: () => void): () => void;
}
export interface InvalidationChannel {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: typeof WALLET_INVALIDATION_MESSAGE): void;
  close(): void;
}
/** One mount owns one controller and registry listener set. Discovery only reads
 * metadata; construction/restoration never creates a challenge or prompts a wallet.
 * Channel data is a fixed notification, never identity, tokens or a proof.
 */
export function createWalletHostRuntime(options: {
  origin: string;
  isTopLevel: boolean;
  registry: () => WalletRegistry;
  fetcher?: typeof fetch;
  channel?: () => InvalidationChannel;
  now?: () => number;
}) {
  const configured = options.origin === PUBLIC_ORIGIN && options.isTopLevel === true;
  const config: LoginConfig | null = configured
    ? { origin: PUBLIC_ORIGIN, uri: PUBLIC_URI, statement: STATEMENT, chainId: "solana:mainnet" }
    : null;
  const controller = new WalletLoginController(
    configured
      ? createWalletBackend({ origin: options.origin, isTopLevel: true }, options.fetcher)
      : null,
    config,
    [],
    options.now,
  );
  let closed = false,
    remoteNotification = false;
  let channel: InvalidationChannel | undefined;
  const stops: Array<() => void> = [];
  if (configured) {
    try {
      const registry = options.registry();
      const update = () => {
        if (!closed) {
          try {
            controller.updateWallets(registry.get());
          } catch {
            controller.updateWallets([]);
          }
        }
      };
      stops.push(registry.on("register", update));
      stops.push(registry.on("unregister", update));
      update();
    } catch {
      controller.updateWallets([]);
    }
    try {
      channel = options.channel?.();
      if (channel)
        channel.onmessage = (event) => {
          if (closed || event.data !== WALLET_INVALIDATION_MESSAGE) return;
          remoteNotification = true;
          try {
            controller.invalidateSession();
          } finally {
            remoteNotification = false;
          }
        };
    } catch {
      /* No fallback persistence. Server checks and focus verification remain active. */
    }
    let prior = controller.getSnapshot();
    stops.push(
      controller.subscribe(() => {
        const next = controller.getSnapshot();
        const changed =
          next.session?.sessionId !== prior.session?.sessionId &&
          prior.phase !== "checking_session";
        const revoking = next.phase === "canceling" && prior.phase !== "canceling";
        prior = next;
        if (!closed && !remoteNotification && (changed || revoking)) {
          try {
            channel?.postMessage(WALLET_INVALIDATION_MESSAGE);
          } catch {
            /* Notification loss never grants authority. */
          }
        }
      }),
    );
  }
  return {
    controller,
    start() {
      if (!closed && configured) void controller.restoreSession();
    },
    close() {
      if (closed) return;
      closed = true;
      // Destroy fences late provider/network completion and attempts existing cancellation.
      controller.destroy();
      for (const stop of stops) {
        try {
          stop();
        } catch {
          /* Closed fence remains authoritative. */
        }
      }
      if (channel) {
        channel.onmessage = null;
        try {
          channel.close();
        } catch {
          /* No retained listener. */
        }
      }
    },
  };
}
