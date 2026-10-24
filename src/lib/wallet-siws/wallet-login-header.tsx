import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { WalletLoginController } from "./controller";
import "./wallet-login.css";
const LoginContext = createContext<WalletLoginController | null>(null);
/** Host owns ONE stable controller. Unrelated BTC auth and legacy owner adapters are not imported. */
export function WalletLoginProvider({
  controller,
  children,
}: {
  controller: WalletLoginController;
  children: ReactNode;
}) {
  useEffect(() => {
    const interval = setInterval(() => controller.tick(), 1000);
    const focus = () => {
      void controller.checkSession();
    };
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [controller]);
  return (
    <LoginContext.Provider value={controller}>{children}</LoginContext.Provider>
  );
}
export function useWalletLogin() {
  const controller = useContext(LoginContext);
  if (!controller) throw new Error("WalletLoginProvider is required");
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { controller, snapshot };
}
export function WalletLoginHeader({
  onReviewControls,
}: {
  onReviewControls?: () => void;
}) {
  const { controller, snapshot: s } = useWalletLogin();
  const title = useId();
  const detail = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    if (s.opened && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!s.opened && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      trigger.current?.focus();
    }
  }, [s.opened]);
  const signedIn = s.phase === "authenticated" && s.session !== null;
  const canPrepare =
    !s.busy &&
    !!s.selectionId &&
    [
      "ready",
      "rejected",
      "expired",
      "invalid_proof",
      "forbidden",
      "unavailable",
      "signed_out",
      "error",
      "canceled",
    ].includes(s.phase);
  return (
    <div className="wallet-login-header">
      <span className="wallet-login-off">LOGIN ONLY · SEE BACKEND CONTROLS</span>
      <button
        ref={trigger}
        className="wallet-login-trigger"
        onClick={() => {
          void controller.openFromHeader();
        }}
        aria-haspopup="dialog"
      >
        {s.phase === "checking_session"
          ? "Checking wallet session…"
          : signedIn
            ? "Owner wallet · signed in"
            : s.choices.filter((c) => c.compatible && c.name === "Phantom")
                  .length === 1
              ? "Sign in with Phantom"
              : "Sign in with wallet"}
      </button>
      <dialog
        ref={panel}
        className="wallet-login-dialog"
        aria-labelledby={title}
        aria-describedby={detail}
        onCancel={(event) => {
          event.preventDefault();
          controller.close();
        }}
        onClose={() => {
          if (s.opened) controller.close();
        }}
      >
        <div className="wallet-login-top">
          <div>
            <span className="wallet-login-eyebrow">OWNER ACCESS · SOLANA</span>
            <h2 id={title}>Sign in to owner controls</h2>
          </div>
          <button
            onClick={() => controller.close()}
            aria-label="Close wallet login"
          >
            Close
          </button>
        </div>
        <p id={detail} role="status" aria-live="polite">
          {s.detail}
        </p>
        <div className="wallet-login-note">
          Login only. No transaction, transfer, or trading permission.
        </div>
        {s.phase === "unconfigured" && (
          <p className="wallet-login-warning">
            Local candidate only. Server binding and owner configuration are not
            activated.
          </p>
        )}
        {s.choices.length > 0 &&
          !signedIn &&
          (!s.selectionId || s.choices.length > 1) && (
            <fieldset disabled={s.busy}>
              <legend>Wallet</legend>
              {s.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className={
                    s.selectionId === choice.id
                      ? "wallet-choice selected"
                      : "wallet-choice"
                  }
                  aria-pressed={s.selectionId === choice.id}
                  onClick={() => controller.selectWallet(choice.id)}
                >
                  {choice.name}
                  {!choice.compatible ? " · incompatible" : ""}
                </button>
              ))}
            </fieldset>
          )}
        {canPrepare && (
          <button
            className="wallet-login-primary"
            onClick={() => {
              void controller.prepare();
            }}
          >
            Prepare login message
          </button>
        )}
        {s.preview && (
          <section
            className="wallet-login-review"
            aria-label="Login message preview"
          >
            <p className="wallet-login-domain">{s.preview.domain}</p>
            <p>
              Sign in to owner controls. This message does not authorize
              transactions, transfers, or trading.
            </p>
            <details>
              <summary>Message details</summary>
              <dl>
                <dt>Domain</dt>
                <dd>{s.preview.domain}</dd>
                <dt>Wallet</dt>
                <dd>
                  Your wallet will display its selected address. The server will
                  check it against the owner allowlist.
                </dd>
                <dt>URI</dt>
                <dd>{s.preview.uri}</dd>
                <dt>Nonce</dt>
                <dd>{s.preview.nonce}</dd>
                <dt>Issued</dt>
                <dd>{s.preview.issuedAt}</dd>
                <dt>Expires</dt>
                <dd>{s.preview.expiresAt}</dd>
                <dt>Request ID</dt>
                <dd>{s.preview.requestId}</dd>
              </dl>
              <label htmlFor={`${title}-message`}>
                Login-only message template; your wallet fills the address
              </label>
              <textarea
                id={`${title}-message`}
                readOnly
                value={s.preview.message}
                rows={12}
              />
            </details>
            <button
              className="wallet-login-primary"
              disabled={s.busy || s.phase !== "review"}
              onClick={() => {
                void controller.confirmLogin(s.preview!.challengeId);
              }}
            >
              Sign login message
            </button>
          </section>
        )}
        {s.busy && (
          <p>
            No further wallet request will be started while this one is
            unresolved.
          </p>
        )}
        {s.phase === "uncertain" && (
          <button
            onClick={() => {
              void controller.retryCancellation();
            }}
          >
            Retry cancellation
          </button>
        )}
        {signedIn && (
          <section className="wallet-login-session">
            <p>
              Allowed wallet: <span>{s.session!.walletAddress}</span>
            </p>
            <p>Session expires: {s.session!.expiresAt}</p>
            <button
              className="wallet-login-primary"
              onClick={() => {
                controller.close();
                onReviewControls?.();
              }}
            >
              Review controls
            </button>
            <button
              onClick={() => {
                void controller.logout();
              }}
            >
              Sign out
            </button>
          </section>
        )}
        {!signedIn && s.phase !== "unconfigured" && (
          <button onClick={() => controller.close()}>Cancel and close</button>
        )}
        <p className="wallet-login-footnote">
          A verified login is not permission to move funds. Backend controls show
          the acknowledged execution state.
        </p>
      </dialog>
    </div>
  );
}
/** Display only. Real control requests still require fresh server session checks and existing command policy. */
export function WalletSessionStatus() {
  const { snapshot: s } = useWalletLogin();
  return (
    <div className="wallet-session-summary" role="status">
      {s.phase === "checking_session"
        ? "Checking the current wallet session on the server…"
        : s.session
          ? "Owner wallet verified for this short session."
          : "Sign in with your owner wallet in the header to review controls."}{" "}
      Execution state is shown separately in backend controls.
    </div>
  );
}
