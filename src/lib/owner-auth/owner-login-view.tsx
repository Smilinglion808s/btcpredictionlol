import { useState, useSyncExternalStore } from "react";
import {
  RETURN_PATH,
  type OwnerLoginController,
  type LoginState,
} from "./owner-login";

/** Presentational only. It cannot enable controls or infer an owner from an email. */
export function OwnerLoginPanel({
  state,
  requestLink,
  checkCurrentSignIn,
  signOut,
  enrollCurrentSession,
  checkSessionEnrollment,
}: {
  state: LoginState;
  requestLink: (email: string) => void;
  checkCurrentSignIn: () => void;
  signOut: () => void;
  enrollCurrentSession?: () => void;
  checkSessionEnrollment?: () => void;
}) {
  const [email, setEmail] = useState("");
  const busy = ["sending", "checking", "exchanging", "waiting", "signing_out"].includes(state.phase);
  const canSend = state.canRequestLink;
  return (
    <section
      aria-labelledby="owner-login-title"
      style={{
        maxWidth: "34rem",
        margin: "1.5rem auto",
        padding: "1.25rem",
        border: "1px solid #64748b",
        borderRadius: "1rem",
      }}
    >
      <h2 id="owner-login-title">Owner sign-in</h2>
      <p>
        The paper dashboard remains public. Sign-in alone does not unlock
        trading controls.
      </p>
      <p role="status" aria-live="polite">
        {state.message}
      </p>
      {state.phase === "signed_in" && (
        <p>
          {state.emailVerified
            ? "The provider reports this email as verified."
            : "Email verification has not been confirmed."}{" "}
          This is not owner authorization.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend && !busy) {
            requestLink(email);
            setEmail("");
          }
        }}
      >
        <label htmlFor="owner-login-email">Account email</label>
        <input
          id="owner-login-email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
          disabled={!canSend || busy}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={{
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            margin: "0.5rem 0 1rem",
            padding: "0.75rem",
          }}
        />
        <button type="submit" disabled={!canSend || busy}>
          Send sign-in link
        </button>
      </form>
      <p>
        Open the link in the same browser and device; a new tab is supported. This app stores the sign-in session in this browser until you sign out. A link cannot create an account.
        New owner setup is a separate, unconfigured step.
      </p>
      <button
        type="button"
        disabled={busy || state.phase === "unavailable"}
        onClick={checkCurrentSignIn}
      >
        Check current sign-in
      </button>
      <button type="button" disabled={busy || state.phase === "unavailable"} onClick={signOut}>Sign out of this app</button>
      <section aria-labelledby="owner-enrollment-title">
        <h3 id="owner-enrollment-title">Enable this session for controls</h3>
        <p role="status" aria-live="polite">{state.enrollment.message}</p>
        <p>After a verified sign-in, you can ask the server to enroll this session. The server must verify the configured owner. This does not enable live trading or acknowledge a control command.</p>
        <button type="button" disabled={busy || !state.enrollment.canEnroll || !enrollCurrentSession} onClick={enrollCurrentSession}>Enable this signed-in session for controls</button>
        <button type="button" disabled={busy || !state.enrollment.canCheck || !checkSessionEnrollment} onClick={checkSessionEnrollment}>Check session enrollment</button>
      </section>
      <p>Owner control access: unavailable on this sign-in page. ON remains disabled.</p>
      <button type="button" disabled aria-describedby="owner-live-blocker">
        ON unavailable
      </button>
      <p id="owner-live-blocker">
        Real-money execution is not configured or authorized by signing in.
      </p>
      <a href={RETURN_PATH}>Return to paper dashboard</a>
    </section>
  );
}
export function OwnerLoginPage({
  controller,
}: {
  controller: OwnerLoginController;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  return (
    <OwnerLoginPanel
      state={state}
      requestLink={(email) => {
        void controller.requestLink(email);
      }}
      signOut={() => { void controller.signOut(); }}
      enrollCurrentSession={() => { void controller.enrollCurrentSession(); }}
      checkSessionEnrollment={() => { void controller.checkSessionEnrollment(); }}
      checkCurrentSignIn={() => {
        void controller.checkCurrentSignIn();
      }}
    />
  );
}
