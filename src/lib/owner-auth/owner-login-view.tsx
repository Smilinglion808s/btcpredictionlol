import { useState, useSyncExternalStore } from "react";
import { RETURN_PATH, type OwnerLoginController, type LoginState } from "./owner-login";

/** Only provider-confirmed state may identify the signed-in email. */
export function OwnerLoginPanel({
  state,
  requestLink,
  checkCurrentSignIn,
  signOut,
}: {
  state: LoginState;
  requestLink: (email: string) => void;
  checkCurrentSignIn: () => void;
  signOut: () => void;
}) {
  const [email, setEmail] = useState("");
  const busy = ["sending", "checking", "exchanging", "waiting", "changed", "signing_out"].includes(state.phase);
  const signedIn = state.phase === "signed_in";
  const recovery = ["uncertain", "signout_partial", "invalid_callback", "error"].includes(state.phase);
  return (
    <section
      aria-labelledby="owner-login-title"
      style={{
        maxWidth: "26rem",
        margin: "4rem auto",
        padding: "1.5rem",
        fontFamily: "system-ui, sans-serif",
        lineHeight: 1.5,
      }}
    >
      <h1 id="owner-login-title">
        {signedIn ? "You’re signed in" : state.phase === "check_email" ? "Check your email" : "Log in with your email"}
      </h1>
      <p role="status" aria-live="polite">
        {signedIn && state.email ? (
          <>
            Signed in as <strong>{state.email}</strong> <span>· Verified</span>
          </>
        ) : (
          state.message
        )}
      </p>
      {signedIn && !state.email && <p>Your email address could not be verified.</p>}
      {!signedIn && state.phase !== "check_email" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (state.canRequestLink && !busy) {
              requestLink(email);
              setEmail("");
            }
          }}
        >
          <label htmlFor="owner-login-email">Email</label>
          <input
            id="owner-login-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            disabled={!state.canRequestLink || busy}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{
              display: "block",
              width: "100%",
              boxSizing: "border-box",
              margin: "0.5rem 0 1rem",
              padding: "0.75rem",
              borderRadius: "0.4rem",
              border: "1px solid #64748b",
            }}
          />
          <button type="submit" disabled={!state.canRequestLink || busy} style={{ padding: "0.75rem 1rem" }}>
            Send sign-in link
          </button>
        </form>
      )}
      {state.phase === "check_email" && (
        <p>A new tab is fine. This browser remembers your sign-in, but sessions can expire or be revoked.</p>
      )}
      {(recovery || state.phase === "check_email") && (
        <p>
          <button type="button" disabled={busy} onClick={checkCurrentSignIn}>
            Check sign-in again
          </button>
        </p>
      )}
      <p>
        <a href={RETURN_PATH}>Back to dashboard</a>
        {signedIn && (
          <>
            {" "}
            ·{" "}
            <button type="button" onClick={signOut}>
              Sign out
            </button>
          </>
        )}
      </p>
    </section>
  );
}
export function OwnerLoginPage({ controller }: { controller: OwnerLoginController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  return (
    <OwnerLoginPanel
      state={state}
      requestLink={(email) => {
        void controller.requestLink(email);
      }}
      signOut={() => {
        void controller.signOut();
      }}
      checkCurrentSignIn={() => {
        void controller.checkCurrentSignIn();
      }}
    />
  );
}
