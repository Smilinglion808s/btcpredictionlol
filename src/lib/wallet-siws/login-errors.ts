import { BoundaryError, WalletAuthRemoteError } from "./contract";
import { isRejected } from "./provider";
export type LoginStage = "wallet" | "proof" | "verify" | "session";
export interface LoginFailure {
  readonly phase:
    | "rejected"
    | "expired"
    | "invalid_proof"
    | "forbidden"
    | "unavailable"
    | "uncertain"
    | "signed_out";
  readonly detail: string;
}
const failure = (phase: LoginFailure["phase"], detail: string): LoginFailure =>
  Object.freeze({ phase, detail });
const PROOF_ERRORS = new Set([
  "INVALID_PROOF",
  "INVALID_BYTES",
  "INVALID_ADDRESS",
  "ACCOUNT_MISMATCH",
  "MESSAGE_MISMATCH",
  "UNSUPPORTED_MESSAGE_FORMAT",
]);
const UNAVAILABLE_CODES = new Set([
  "SERVICE_UNAVAILABLE",
  "WALLET_AUTH_UNAVAILABLE",
  "WALLET_AUTH_UNCONFIGURED",
  "AUTH_STORE_UNAVAILABLE",
  "AUTH_STORE_INVALID",
  "AUTH_STORE_BINDING",
  "AUTH_BUSY",
  "AUTH_CAPACITY",
  "AUTH_PROCESS_REPLACED",
  "CLOCK_UNSAFE",
  "PILOT_WINDOW_ENDED",
  "RANDOM_UNAVAILABLE",
  "INVALID_CONFIG",
  "INVALID_TIME",
  "PILOT_BINDING",
  "INVALID_WALLET",
]);
const DENIED_REQUEST_CODES = new Set([
  "CHALLENGE_BINDING",
  "CHALLENGE_USED_OR_CANCELED",
  "CSRF_FORBIDDEN",
  "ORIGIN_FORBIDDEN",
]);
const uncertain = () =>
  failure(
    "uncertain",
    "The login result could not be confirmed. This attempt has been canceled; retry explicitly.",
  );
const unavailable = () =>
  failure(
    "unavailable",
    "The login service is unavailable. This attempt has been canceled; try again later.",
  );
/** Callers display detail only AFTER the cancellation latch is acknowledged. */
export function classifyLoginFailure(
  error: unknown,
  stage: LoginStage,
): LoginFailure {
  if (stage === "wallet")
    return isRejected(error)
      ? failure("rejected", "You declined the wallet login request.")
      : uncertain();
  if (stage === "proof") {
    if (
      error instanceof BoundaryError &&
      !(error instanceof WalletAuthRemoteError)
    ) {
      if (error.code === "EXPIRED_CHALLENGE")
        return failure("expired", "Login message expired. Prepare a new one.");
      if (PROOF_ERRORS.has(error.code))
        return failure(
          "invalid_proof",
          "The wallet response did not match this login message. Prepare a new message.",
        );
    }
    return uncertain();
  }
  if (error instanceof WalletAuthRemoteError) {
    // Both status and outcome must match before assigning a definitive remote cause.
    if (error.outcome === "uncertain") return uncertain();
    if (error.outcome === "unavailable") {
      return (error.httpStatus === null || error.httpStatus === 503) &&
        UNAVAILABLE_CODES.has(error.code)
        ? unavailable()
        : uncertain();
    }
    if (error.outcome !== "denied") return uncertain();
    if (
      error.httpStatus === 403 &&
      error.code === "WALLET_FORBIDDEN" &&
      stage === "verify"
    )
      return failure(
        "forbidden",
        "This wallet is not allowed to access owner controls. Choose the allowed wallet.",
      );
    if (error.httpStatus === 403 && error.code === "CHALLENGE_EXPIRED")
      return failure(
        "expired",
        "The server login challenge expired. Prepare a new message.",
      );
    if (
      (error.httpStatus === 400 || error.httpStatus === 403) &&
      error.code === "INVALID_PROOF" &&
      stage === "verify"
    )
      return failure(
        "invalid_proof",
        "The server rejected this login proof. Prepare a new message.",
      );
    if (error.httpStatus === 401 && error.code === "WALLET_SESSION_REQUIRED")
      return failure(
        "signed_out",
        "The server session is no longer available. Sign in again.",
      );
    if (error.httpStatus === 429 && error.code === "AUTH_RATE_LIMITED")
      return failure(
        "unavailable",
        "Too many login requests. This attempt has been canceled; wait before trying again.",
      );
    if (error.httpStatus === 403 && DENIED_REQUEST_CODES.has(error.code))
      return failure(
        "forbidden",
        "The server rejected this login request. Prepare a new login message.",
      );
    return uncertain();
  }
  // Backwards-safe handling while transport upgrades. A code alone is insufficient
  // evidence of a particular remote denial, even when it resembles a server code.
  if (error instanceof BoundaryError && error.code === "SERVICE_UNAVAILABLE")
    return unavailable();
  return uncertain();
}
/** Restore is a GET only. An unavailable/malformed response is not proof of sign-out. */
export function classifyRestoreFailure(error: unknown): LoginFailure {
  if (
    error instanceof WalletAuthRemoteError &&
    error.outcome === "denied" &&
    error.httpStatus === 401 &&
    error.code === "WALLET_SESSION_REQUIRED"
  )
    return failure(
      "signed_out",
      "No current wallet session. Sign in to review controls.",
    );
  return failure(
    "unavailable",
    "The current wallet session could not be checked. Controls stay locked; try again later.",
  );
}
export function classifyChallengeFailure(error: unknown): LoginFailure {
  if (
    error instanceof BoundaryError &&
    !(error instanceof WalletAuthRemoteError) &&
    (error.code === "EXPIRED_CHALLENGE" || error.code === "STALE_CHALLENGE")
  )
    return failure(
      "expired",
      "The server login challenge is stale or expired. No wallet signature was requested.",
    );
  if (
    error instanceof WalletAuthRemoteError &&
    error.outcome === "denied" &&
    error.httpStatus === 429 &&
    error.code === "AUTH_RATE_LIMITED"
  )
    return failure(
      "unavailable",
      "Too many login requests. Wait before trying again. No wallet signature was requested.",
    );
  return failure(
    "unavailable",
    "A valid login challenge could not be obtained. No wallet signature was requested.",
  );
}
