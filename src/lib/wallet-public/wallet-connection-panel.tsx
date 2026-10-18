import { useEffect, useId, useRef, useState } from "react";
import type { OwnerInvalidation, OwnerView } from "./owner-evidence";
import type { WalletSelectionController, WalletSelectionView } from "./wallet-selection-controller";
export interface WalletConnectionPanelProps {
  /** Stable route-owned factory. Must construct a fresh controller on every mount. */
  createController: () => WalletSelectionController;
  presentation?: "panel" | "header";
  /** Navigation/focus only. Must never enroll or request wallet permission. */
  onOpenSessionControls?: () => void;
  /** Existing host session changes/signout must invalidate; no token values are passed. */
  subscribeOwnerInvalidation: (listener: (reason: OwnerInvalidation) => void) => () => void;
}
function ownerGuidance(owner?: OwnerView): {
  label: string;
  detail: string;
  action: "check" | "signin" | "enable" | "session";
} {
  if (!owner || owner.phase === "checking")
    return { label: "Checking owner access…", detail: "Your app session is being checked.", action: "check" };
  if (owner.phase === "current")
    return {
      label: "Owner session checked",
      detail: "App access is ready. Wallet sharing is a separate permission.",
      action: "check",
    };
  if (owner.phase === "expired")
    return {
      label: "Access check expired",
      detail: "Check access again to verify the current session.",
      action: "check",
    };
  if (owner.phase === "revoked" || owner.issue === "revoked")
    return {
      label: "App session revoked",
      detail: "Sign out and sign in again. This session cannot be re-enabled.",
      action: "signin",
    };
  if (owner.issue === "enrollment_required")
    return {
      label: "App session not enabled",
      detail: "Enable your signed-in session for controls, then check access here.",
      action: "enable",
    };
  if (owner.issue === "sign_in_required")
    return {
      label: "App sign-in required",
      detail: "Sign in with your email, or sign in again if the session expired.",
      action: "signin",
    };
  if (owner.issue === "forbidden")
    return {
      label: "Owner access denied",
      detail: "Use the verified owner account. A wallet connection does not grant app access.",
      action: "signin",
    };
  if (owner.issue === "service_unavailable")
    return {
      label: "Access service unavailable",
      detail: "Try checking access later. Public-account access is not confirmed.",
      action: "check",
    };
  return {
    label: "Owner access not confirmed",
    detail: "Check access or open app session controls. Nothing is enabled automatically.",
    action: "session",
  };
}
const noticeLabel = (v: WalletSelectionView) => {
  if (v.notice === "RECHECKING_OWNER_EVIDENCE")
    return "Wallet replied. Checking this owner session before showing its public account…";
  if (v.phase === "requesting") return "Approve or reject the public-account request in your wallet.";
  if (v.phase === "connected") return "Public account shared. Trading is still unavailable.";
  if (v.phase === "cancelled") return "Cancelled here. The wallet prompt may still be open.";
  if (v.phase === "timed_out") return "No response was confirmed. Check your wallet before trying again.";
  if (v.phase === "rejected") return "Permission was not confirmed. You can try again when ready.";
  if (v.notice === "ACCOUNTS_REVOKED") return "Wallet permission was removed. The displayed account was cleared.";
  if (v.notice === "PUBLIC_FACTS_CHANGED_RECONNECT_REQUIRED")
    return "Your wallet changed. Share its public account again to review the current selection.";
  if (v.phase === "invalid") return "Wallet details could not be confirmed. Nothing was activated.";
  if (v.owner.phase === "unavailable" || v.owner.phase === "revoked") return ownerGuidance(v.owner).detail;
  if (v.owner.phase !== "current") return "Check owner access before sharing a wallet account.";
  return v.selectedProviderId
    ? "Review the sharing permission, then continue."
    : "Choose a wallet. Nothing connects automatically.";
};
export function WalletConnectionPanel({
  createController,
  subscribeOwnerInvalidation,
  presentation = "panel",
  onOpenSessionControls,
}: WalletConnectionPanelProps) {
  const id = useId();
  const header = presentation === "header";
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const controller = useRef<WalletSelectionController | null>(null);
  const consentGeneration = useRef<number | null>(null);
  const [view, setView] = useState<WalletSelectionView | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let c: WalletSelectionController | null = null,
      alive = true,
      publishing = false;
    let stop: () => void = () => {},
      stopOwner: () => void = () => {};
    let timer: ReturnType<typeof setInterval> | undefined;
    const clearConsent = () => {
      consentGeneration.current = null;
      if (alive) setAccepted(false);
    };
    const read = () => {
      if (!alive || !c || publishing) return;
      publishing = true;
      try {
        const next = c.snapshot();
        if (consentGeneration.current !== null && consentGeneration.current !== next.generation) clearConsent();
        setView(next);
      } catch {
        setFailed(true);
        setView(null);
        clearConsent();
        try {
          c.close();
        } catch {
          /* Fail closed. */
        }
      } finally {
        publishing = false;
      }
    };
    const invalidate = (reason: OwnerInvalidation) => {
      clearConsent();
      try {
        c?.invalidateOwner(reason);
      } catch {
        if (alive) setFailed(true);
      }
      read();
    };
    const navigation = () => invalidate("navigation");
    try {
      c = createController();
      controller.current = c;
      setFailed(false);
      clearConsent();
      stop = c.subscribe(read);
      stopOwner = subscribeOwnerInvalidation(invalidate);
      c.startDiscovery();
      read();
      void c.refreshOwnerEvidence().then(read, () => {
        if (alive) {
          setFailed(true);
          clearConsent();
        }
      });
      timer = setInterval(read, 1000); // Local expiry tick only, never a background provider/network request.
      window.addEventListener("pagehide", navigation);
      window.addEventListener("pageshow", navigation);
    } catch {
      setFailed(true);
      setView(null);
      clearConsent();
      try {
        c?.close();
      } catch {
        /* Fail closed. */
      }
    }
    return () => {
      alive = false;
      consentGeneration.current = null;
      if (timer !== undefined) clearInterval(timer);
      window.removeEventListener("pagehide", navigation);
      window.removeEventListener("pageshow", navigation);
      try {
        stopOwner();
      } catch {
        /* Continue all teardown steps. */
      }
      try {
        stop();
      } catch {
        /* Continue all teardown steps. */
      }
      try {
        c?.close();
      } catch {
        /* No exception may skip clearing the owned reference. */
      }
      if (controller.current === c) controller.current = null;
    };
  }, [createController, subscribeOwnerInvalidation]);
  function run(work: (c: WalletSelectionController) => unknown) {
    const c = controller.current;
    if (!c || failed) return;
    const fail = () => {
      if (controller.current !== c) return;
      setFailed(true);
      setView(null);
      consentGeneration.current = null;
      setAccepted(false);
      try {
        c.close();
      } catch {
        /* Keep the UI unavailable. */
      }
    };
    try {
      const result = work(c);
      if (result instanceof Promise) void result.catch(fail);
    } catch {
      fail();
    }
  }
  function closePopover(restoreFocus = false) {
    consentGeneration.current = null;
    setAccepted(false);
    run((c) => {
      if (c.snapshot().requestInProgress) c.cancel();
    });
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  const closeRef = useRef(closePopover);
  closeRef.current = closePopover;
  useEffect(() => {
    if (!header || !open) return;
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof window.Node && !wrapper.current?.contains(event.target)) closeRef.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current(true);
      }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [header, open]);
  const disabled = failed || !view || view.phase === "closed";
  const guidance = ownerGuidance(view?.owner);
  // Provider names are discovery labels, never proof of ownership or vendor identity.
  const providers = header ? view?.providers.filter((p) => p.name === "Phantom") : view?.providers;
  const selectedAllowed = !header || providers?.some((p) => p.id === view?.selectedProviderId) === true;
  const openSession = () => {
    closePopover();
    onOpenSessionControls?.();
  };
  const sessionAction =
    guidance.action === "signin" ? (
      <a href="/owner/login" referrerPolicy="no-referrer">
        Sign in with email
      </a>
    ) : (guidance.action === "enable" || guidance.action === "session") && onOpenSessionControls ? (
      <button type="button" onClick={openSession}>
        {guidance.action === "enable" ? "Enable app session" : "Open app session"}
      </button>
    ) : null;

  const body = (
    <section
      id={id + "-panel"}
      hidden={header && !open}
      className="wallet-public-panel"
      aria-labelledby={id + "-title"}
    >
      <header>
        <div>
          <p className="wallet-public-eyebrow">Next step · public account only</p>
          <h3 id={id + "-title"}>{header ? "Connect Phantom" : "Your wallet"}</h3>
        </div>
        <span className="wallet-public-off">Trading unavailable</span>
      </header>
      <p className="wallet-public-description">Choose a wallet to share its public account. No signing or transfers.</p>
      <div className="wallet-public-owner">
        <span role="status">{failed ? "Owner access unavailable" : guidance.label}</span>
        <button
          type="button"
          disabled={disabled || view?.owner.phase === "checking" || view?.requestInProgress}
          onClick={() => run((c) => c.refreshOwnerEvidence())}
        >
          Check access
        </button>
      </div>
      <div className="wallet-public-next">
        <p>{guidance.detail}</p>
        {sessionAction}
      </div>
      {failed && (
        <p role="alert">Wallet setup is unavailable. Return to the dashboard and try again. Nothing was activated.</p>
      )}
      <label htmlFor={id + "-provider"}>Wallet</label>
      <select
        id={id + "-provider"}
        disabled={disabled || view?.requestInProgress}
        value={selectedAllowed ? (view?.selectedProviderId ?? "") : ""}
        onChange={(e) => {
          consentGeneration.current = null;
          setAccepted(false);
          run((c) => c.selectProvider(e.currentTarget.value || null));
        }}
      >
        <option value="">{header ? "Choose Phantom" : "Choose a wallet"}</option>
        {providers?.map((p) => (
          <option key={p.id} value={p.id} disabled={!p.eligible}>
            {p.name}
            {p.eligible ? "" : " · unavailable"}
          </option>
        ))}
      </select>
      {view?.discoveryStarted && providers?.length === 0 && (
        <p className="wallet-public-muted">
          {header ? (
            <>
              Phantom was not detected in this browser. On mobile, open this site inside Phantom.{" "}
              <a
                href="https://phantom.com/download"
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                Get Phantom from the official site
              </a>
              .
            </>
          ) : (
            "No compatible wallet was found in this browser. Nothing has been connected."
          )}
        </p>
      )}
      <label className="wallet-public-consent">
        <input
          type="checkbox"
          checked={accepted}
          disabled={disabled || view?.requestInProgress}
          onChange={(e) => {
            const yes = e.currentTarget.checked;
            consentGeneration.current = yes ? (view?.generation ?? null) : null;
            setAccepted(yes);
          }}
        />
        <span>Share public accounts and addresses with this app.</span>
      </label>
      <details className="wallet-public-details">
        <summary>What am I sharing?</summary>
        <p>
          {view?.permissionExplanation ??
            "The wallet may expose public addresses, public keys, declared networks and capability names. It may remember permission. This step cannot sign or send anything."}
        </p>
        <p>
          Wallet-declared networks are not independently verified. An address does not prove ownership. This app saves
          no wallet selection.
        </p>
      </details>
      <div className="wallet-public-actions">
        <button
          type="button"
          className="wallet-public-primary"
          disabled={disabled || !accepted || !selectedAllowed || !view?.canRequestPermission}
          onClick={(e) => {
            const native = e.nativeEvent;
            run((c) => {
              const latest = c.snapshot();
              const consent =
                accepted &&
                consentGeneration.current === latest.generation &&
                (!header || latest.providers.some((p) => p.id === latest.selectedProviderId && p.name === "Phantom"));
              return c.connectFromUserClick(native, consent);
            });
          }}
        >
          {" "}
          {view?.notice === "RECHECKING_OWNER_EVIDENCE"
            ? "Checking access…"
            : view?.requestInProgress
              ? "Waiting for wallet…"
              : "Share public account"}{" "}
        </button>
        {view?.requestInProgress && (
          <button type="button" onClick={() => run((c) => c.cancel())}>
            Cancel here
          </button>
        )}
        {view?.wallet && (
          <button
            type="button"
            onClick={() => {
              consentGeneration.current = null;
              setAccepted(false);
              run((c) => c.disconnectLocally());
            }}
          >
            Clear from app
          </button>
        )}
      </div>
      {view && (
        <p role="status" className="wallet-public-notice">
          {noticeLabel(view)}
        </p>
      )}
      {view?.pendingPermissionRequest && !view.requestInProgress && (
        <p className="wallet-public-warning">
          A wallet prompt may still be open. Dismiss it in your wallet before another request. Clearing this app does
          not revoke wallet permission.
        </p>
      )}
      {view?.wallet && (
        <div className="wallet-public-account">
          <label htmlFor={id + "-account"}>Public account</label>
          <select
            id={id + "-account"}
            value={view.selectedAddress ?? ""}
            onChange={(e) => run((c) => c.selectAccount(e.currentTarget.value))}
          >
            <option value="" disabled>
              Choose an account
            </option>
            {view.wallet.accounts.map((a) => (
              <option key={a.address} value={a.address}>
                {a.address}
              </option>
            ))}
          </select>
          {view.selectedAddress && <p className="wallet-public-address">{view.selectedAddress}</p>}
          <p className="wallet-public-muted">
            Wallet-declared networks: {view.wallet.chains.join(", ") || "not supplied"}. Ownership and network
            verification remain unavailable.
          </p>
        </div>
      )}
    </section>
  );
  if (!header) return body;
  const connected = view?.phase === "connected" && view.wallet !== null;
  return (
    <div className="wallet-header" ref={wrapper}>
      <button
        ref={trigger}
        type="button"
        className="wallet-header-trigger"
        aria-expanded={open}
        aria-controls={id + "-panel"}
        onClick={() => (open ? closePopover() : setOpen(true))}
      >
        <span>
          {connected ? "Phantom connected" : view?.requestInProgress ? "Connecting Phantom…" : "Connect Phantom"}
        </span>
        <small>{connected ? "Public account only" : "Not connected"}</small>
      </button>
      {(guidance.action === "enable" || guidance.action === "signin") && (
        <div className="wallet-header-next">{sessionAction}</div>
      )}
      {body}
    </div>
  );
}
