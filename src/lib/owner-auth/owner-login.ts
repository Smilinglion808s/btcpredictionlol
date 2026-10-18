import {
  OwnerRequestError,
  type OwnerRequest,
  type OwnerResultMap,
  type OwnerSignOutResult,
} from "./owner-request-contract";
/** Uninstalled passwordless flow. Browser state is NEVER owner authorization. */
export const PROVIDER_URL = "https://alevdzyisibxcvwoyrqb.supabase.co";
export const CALLBACK_PATH = "/owner/auth/callback";
export const RETURN_PATH = "/solana-paper";
export const JOURNAL_KEY = "owner-login-flow-v2";
/** Intent/recovery metadata only. Never stores a bearer, owner identifier or authorization. */
export const ENROLLMENT_JOURNAL_KEY = "owner-session-enrollment-v1";
const FLOW_TTL_MS = 15 * 60 * 1000;

export type Identity = { kind: "signed_out" } | { kind: "signed_in"; emailVerified: boolean; email?: string };
/** Only usable while the adapter owns the origin-wide exclusive Web Lock. */
export interface LockedOwnerAuth {
  readonly store: FlowStore;
  newFlowId(): string;
  sendLink(email: string, flowId: string): Promise<void>;
  exchangeCode(code: string, flowId: string): Promise<void>;
  currentIdentity(): Promise<Identity>;
  signOut(): Promise<void>;
  ownerRequest?<K extends OwnerRequest>(request: K): Promise<OwnerResultMap[K["kind"]]>;
  signOutWithRevocation?(): Promise<OwnerSignOutResult>;
}
export interface OwnerAuthAdapter {
  readonly available: boolean;
  /** Explicit separately reviewed capability. Absence never enables app enrollment. */
  readonly ownerApiAvailable?: boolean;
  close(): void;
  /** Fresh SDK per transaction; close/fence BEFORE releasing the lock. */
  transact<T>(work: (lease: LockedOwnerAuth) => Promise<T>): Promise<T>;
}
export interface FlowStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface CallbackNavigation {
  /** Must replace current history with the fixed callback path before exchange. */
  scrub(): void;
}
export type LoginPhase =
  | "unavailable"
  | "ready"
  | "sending"
  | "check_email"
  | "exchanging"
  | "checking"
  | "waiting"
  | "changed"
  | "signing_out"
  | "signout_partial"
  | "signed_out"
  | "signed_in"
  | "invalid_callback"
  | "uncertain"
  | "error";
export type EnrollmentPhase =
  "unavailable" | "not_requested" | "requesting" | "checking" | "enrolled" | "unknown" | "rejected";
export interface EnrollmentState {
  phase: EnrollmentPhase;
  canEnroll: boolean;
  canCheck: boolean;
  message: string;
}
export interface LoginState {
  phase: LoginPhase;
  emailVerified: boolean;
  /** Fresh provider response only; never a public default or token claim. */
  email: string | null;
  ownerAccess: "unavailable";
  liveEnabled: false;
  canRequestLink: boolean;
  message: string;
  enrollment: Readonly<EnrollmentState>;
}
type EnrollmentJournal = {
  version: 1;
  operationId: string;
  phase: "requested" | "enrolled" | "unknown" | "rejected";
  startedAt: number;
};
const enrollmentMessages: Record<EnrollmentPhase, string> = {
  unavailable: "Session enrollment is not configured. Controls remain unavailable.",
  not_requested:
    "No enrollment has been confirmed for this session here. Only the server can verify the configured owner.",
  requesting: "Requesting enrollment of this signed-in session… This does not enable live trading.",
  checking: "Checking this session’s enrollment without changing it…",
  enrolled:
    "The server confirmed enrollment of this session only. This is not a control acknowledgement or live-trading activation.",
  unknown:
    "Session enrollment is unknown. No automatic retry was made. Check current sign-in, then check session enrollment before another request.",
  rejected:
    "Session enrollment was rejected. A revoked session cannot be reopened. Sign in with a new session if needed, then check its enrollment.",
};
type Journal = {
  version: 2;
  flowId: string;
  phase: "requested" | "exchanging" | "consumed" | "uncertain" | "cancelled";
  startedAt: number;
  expiresAt: number;
};
const messages: Record<LoginPhase, string> = {
  unavailable: "Sign-in is unavailable right now. Please try again later.",
  ready: "Log in with your email.",
  sending: "Sending your sign-in link…",
  check_email: "Check your email for a sign-in link. Open it in this browser on this device.",
  exchanging: "Checking your sign-in link…",
  changed: "Your session changed. Checking your sign-in…",
  waiting: "Checking your sign-in…",
  signout_partial: "Sign-out could not be fully confirmed. Check again before leaving a shared device.",
  signing_out: "Signing out…",
  checking: "Checking your sign-in…",
  signed_out: "You’re signed out.",
  signed_in: "You’re signed in.",
  invalid_callback:
    "This link could not be used. Open your latest link in the browser where you requested it, or check your sign-in again.",
  uncertain: "We couldn’t confirm your sign-in. Please check again.",
  error: "We couldn’t send a sign-in link. Check your email address and try again.",
};
export function exactOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || value !== url.origin || url.username || url.password)
    throw new Error("Exact HTTPS origin required");
  return value;
}
export function confirmedEmail(value: unknown, nowMs: number): boolean {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    return false;
  const year = Number(value.slice(0, 4)),
    month = Number(value.slice(5, 7)),
    day = Number(value.slice(8, 10));
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    Number(value.slice(17, 19)) > 59
  )
    return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && Number.isSafeInteger(nowMs) && parsed > 0 && parsed <= nowMs;
}
export function validEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    // eslint-disable-next-line no-control-regex -- Reject ASCII control characters before transmission.
    /^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(value)
  );
}
export function validFlowId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}
export function parseCallback(raw: string, origin: string): { code: string; flowId: string } | null {
  try {
    if (typeof raw !== "string" || raw.length > 2048) return null;
    const url = new URL(raw);
    if (
      url.origin !== exactOrigin(origin) ||
      url.pathname !== CALLBACK_PATH ||
      url.hash ||
      url.username ||
      url.password
    )
      return null;
    const params = [...url.searchParams];
    if (
      params.length !== 2 ||
      params.filter(([k]) => k === "code").length !== 1 ||
      params.filter(([k]) => k === "flow").length !== 1
    )
      return null;
    const code = url.searchParams.get("code")!;
    const flowId = url.searchParams.get("flow");
    return /^[A-Za-z0-9_-]{16,512}$/.test(code) && validFlowId(flowId) ? { code, flowId } : null;
  } catch {
    return null;
  }
}

export class OwnerLoginController {
  private state: LoginState;
  private readonly listeners = new Set<() => void>();
  private closed = false;
  private generation = 0;
  private operation: Promise<void> | null = null;
  private pendingInvalidation = false;
  private journal: Journal | null = null;
  private configured = false;
  private enrollmentPhase: EnrollmentPhase = "not_requested";
  private enrollmentJournal: EnrollmentJournal | null = null;
  private enrollmentRaw: string | null = null;
  private cancelWait: (() => void) | null = null;
  private verifiedIdentity: Extract<Identity, { kind: "signed_in" }> | null = null;
  constructor(
    private readonly auth: OwnerAuthAdapter,
    private readonly origin: string,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = 12_000,
  ) {
    this.state = this.makeState("unavailable");
    try {
      exactOrigin(origin);
      if (auth.available !== true || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
      // No journal/auth-storage access or SDK construction outside the Web Lock.
      this.configured = true;
      this.state = this.makeState("checking");
    } catch {
      /* Missing/unreliable storage is unavailable, never a fresh empty flow. */
    }
  }
  private makeState(phase: LoginPhase, emailVerified = false): LoginState {
    return Object.freeze({
      phase,
      emailVerified,
      email:
        phase === "signed_in" &&
        emailVerified &&
        this.verifiedIdentity?.email &&
        validEmail(this.verifiedIdentity.email)
          ? this.verifiedIdentity.email
          : null,
      ownerAccess: "unavailable",
      liveEnabled: false,
      canRequestLink:
        this.configured &&
        !this.activeJournal() &&
        ![
          "sending",
          "exchanging",
          "checking",
          "waiting",
          "changed",
          "signing_out",
          "unavailable",
          "signed_in",
        ].includes(phase),
      message: messages[phase],
      enrollment: Object.freeze({
        phase: this.auth.ownerApiAvailable === true ? this.enrollmentPhase : "unavailable",
        canEnroll:
          this.configured &&
          this.auth.ownerApiAvailable === true &&
          phase === "signed_in" &&
          emailVerified &&
          this.enrollmentPhase === "not_requested",
        canCheck:
          this.configured &&
          this.auth.ownerApiAvailable === true &&
          phase === "signed_in" &&
          emailVerified &&
          !["requesting", "checking"].includes(this.enrollmentPhase),
        message: enrollmentMessages[this.auth.ownerApiAvailable === true ? this.enrollmentPhase : "unavailable"],
      }),
    });
  }
  snapshot = (): LoginState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(phase: LoginPhase, emailVerified = false) {
    if (this.closed) return;
    if (this.pendingInvalidation && phase === "signed_in") {
      phase = "changed";
      emailVerified = false;
    }
    this.state = this.makeState(phase, emailVerified);
    for (const listener of this.listeners) listener();
  }
  private readJournal(store: FlowStore): Journal | null {
    const raw = store.getItem(JOURNAL_KEY);
    if (raw === null) return null;
    if (raw.length > 512) throw new Error("Invalid flow record");
    const j = JSON.parse(raw) as Journal;
    if (
      !j ||
      typeof j !== "object" ||
      Object.keys(j).sort().join(",") !== "expiresAt,flowId,phase,startedAt,version" ||
      j.version !== 2 ||
      !validFlowId(j.flowId) ||
      !["requested", "exchanging", "consumed", "uncertain", "cancelled"].includes(j.phase) ||
      !Number.isSafeInteger(j.startedAt) ||
      j.startedAt < 0 ||
      !Number.isSafeInteger(j.expiresAt) ||
      j.expiresAt !== j.startedAt + FLOW_TTL_MS
    )
      throw new Error("Invalid flow record");
    if (!Number.isSafeInteger(this.now()) || j.startedAt > this.now()) throw new Error("Invalid flow clock");
    return j;
  }
  private activeJournal() {
    const n = this.now();
    return (
      this.journal !== null &&
      !["consumed", "cancelled"].includes(this.journal.phase) &&
      Number.isSafeInteger(n) &&
      n >= this.journal.startedAt &&
      n < this.journal.expiresAt
    );
  }
  private writeJournal(store: FlowStore, journal: Journal) {
    store.setItem(JOURNAL_KEY, JSON.stringify(journal));
    if (store.getItem(JOURNAL_KEY) !== JSON.stringify(journal)) throw new Error("Storage unavailable");
    this.journal = journal;
  }
  private mark(store: FlowStore, phase: Journal["phase"]) {
    if (this.journal) this.writeJournal(store, { ...this.journal, phase });
  }
  private readEnrollment(store: FlowStore) {
    const raw = store.getItem(ENROLLMENT_JOURNAL_KEY);
    if (raw === this.enrollmentRaw) return;
    if (raw === null) {
      // Missing metadata is not evidence that an already observed attempt did not execute.
      if (this.enrollmentRaw !== null) this.enrollmentPhase = "unknown";
      return;
    }
    if (raw.length > 512) throw new Error("Invalid enrollment record");
    const j = JSON.parse(raw) as EnrollmentJournal;
    if (
      !j ||
      typeof j !== "object" ||
      Object.keys(j).sort().join(",") !== "operationId,phase,startedAt,version" ||
      j.version !== 1 ||
      !validFlowId(j.operationId) ||
      !["requested", "enrolled", "unknown", "rejected"].includes(j.phase) ||
      !Number.isSafeInteger(j.startedAt) ||
      j.startedAt < 0 ||
      !Number.isSafeInteger(this.now()) ||
      j.startedAt > this.now()
    )
      throw new Error("Invalid enrollment record");
    this.enrollmentJournal = j;
    this.enrollmentRaw = raw;
    // Reload/cross-tab metadata is an uncertainty marker, never current-session evidence.
    this.enrollmentPhase = "unknown";
  }
  private writeEnrollment(store: FlowStore, journal: EnrollmentJournal) {
    const raw = JSON.stringify(journal);
    store.setItem(ENROLLMENT_JOURNAL_KEY, raw);
    if (store.getItem(ENROLLMENT_JOURNAL_KEY) !== raw) throw new Error("Enrollment storage unavailable");
    this.enrollmentJournal = journal;
    this.enrollmentRaw = raw;
  }
  private finishEnrollment(store: FlowStore, phase: "enrolled" | "unknown" | "rejected") {
    this.enrollmentPhase = phase;
    if (this.enrollmentJournal) {
      try {
        this.writeEnrollment(store, { ...this.enrollmentJournal, phase });
      } catch {
        this.enrollmentPhase = "unknown";
      }
    }
  }
  private invalidateEnrollment() {
    if (this.enrollmentPhase !== "not_requested") this.enrollmentPhase = "unknown";
  }
  private run(task: (generation: number, lease: LockedOwnerAuth) => Promise<void>): Promise<void> {
    if (this.closed || !this.configured || this.operation) return this.operation ?? Promise.resolve();
    const generation = ++this.generation;
    // Register the operation before any task body runs, fencing synchronous double clicks.
    this.operation = Promise.resolve()
      .then(() => {
        if (!this.current(generation)) return;
        this.emit("waiting");
        if (!this.current(generation)) return;
        return this.auth.transact(async (lease) => {
          if (this.current(generation)) {
            if (this.auth.ownerApiAvailable === true) {
              try {
                this.readEnrollment(lease.store);
              } catch {
                // Unusable enrollment metadata cannot erase provider sign-in evidence.
                // It still blocks any implicit or repeated enrollment mutation.
                this.enrollmentPhase = "unknown";
                this.enrollmentJournal = null;
              }
            }
            await task(generation, lease);
          }
        });
      })
      .catch(() => {
        if (this.current(generation)) this.emit("unavailable");
      })
      .finally(() => {
        if (generation === this.generation) {
          this.operation = null;
          if (this.pendingInvalidation) {
            this.pendingInvalidation = false;
            this.invalidateEnrollment();
            this.emit("changed");
            void this.checkCurrentSignIn();
          }
        }
      });
    return this.operation;
  }
  private current(generation: number) {
    return !this.closed && generation === this.generation;
  }
  private bounded<T>(work: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out")), this.timeoutMs);
      const cancel = () => {
        clearTimeout(timer);
        reject(new Error("Closed"));
      };
      this.cancelWait = cancel;
      work.then(resolve, reject).finally(() => {
        clearTimeout(timer);
        if (this.cancelWait === cancel) this.cancelWait = null;
      });
    });
  }
  requestLink(email: string): Promise<void> {
    return this.run(async (generation, lease) => {
      let providerStarted = false;
      try {
        this.journal = this.readJournal(lease.store);
        if (this.activeJournal()) {
          this.emit(this.journal?.phase === "requested" ? "check_email" : "uncertain");
          return;
        } // No overlap, resend, or retry while prior link may be alive.
        if (!validEmail(email.trim())) {
          this.emit("error");
          return;
        }
        const startedAt = this.now();
        if (!Number.isSafeInteger(startedAt) || startedAt < 0) throw new Error("Clock");
        this.writeJournal(lease.store, {
          version: 2,
          flowId: lease.newFlowId(),
          phase: "requested",
          startedAt,
          expiresAt: startedAt + FLOW_TTL_MS,
        });
        this.emit("sending");
        if (!this.current(generation)) return;
        providerStarted = true;
        await this.bounded(lease.sendLink(email.trim(), this.journal!.flowId));
        if (this.current(generation)) this.emit("check_email");
      } catch {
        if (!this.current(generation)) return;
        if (!providerStarted) {
          this.configured = false;
          this.emit("unavailable");
          return;
        }
        try {
          this.mark(lease.store, "uncertain");
          this.emit("uncertain");
        } catch {
          this.configured = false;
          this.emit("unavailable");
        }
      }
    });
  }
  completeCallback(rawUrl: string, navigation: CallbackNavigation): Promise<void> {
    let callback = parseCallback(rawUrl, this.origin);
    // Scrub synchronously, even if this controller is unconfigured or already closed.
    rawUrl = "";
    try {
      navigation.scrub();
    } catch {
      this.configured = false;
      this.emit("unavailable");
      return Promise.resolve();
    }
    return this.run(async (generation, lease) => {
      let providerStarted = false;
      try {
        this.journal = this.readJournal(lease.store);
        if (
          !callback ||
          callback.flowId !== this.journal?.flowId ||
          !this.activeJournal() ||
          this.journal?.phase !== "requested"
        ) {
          callback = null;
          this.emit("invalid_callback");
          return;
        }
        this.mark(lease.store, "exchanging"); // Persist consumption intent BEFORE the non-retryable exchange.
        this.emit("exchanging");
        if (!this.current(generation)) {
          callback = null;
          return;
        }
        providerStarted = true;
        const exchange = lease.exchangeCode(callback.code, callback.flowId);
        callback = null;
        await this.bounded(exchange);
        if (!this.current(generation)) return;
        this.mark(lease.store, "consumed");
        if (!this.current(generation)) return;
        const identity = await this.bounded(lease.currentIdentity());
        if (!this.current(generation)) return;
        if (!this.pendingInvalidation) this.emitIdentity(identity);
      } catch {
        callback = null;
        if (!this.current(generation)) return;
        if (!providerStarted) {
          this.configured = false;
          this.emit("unavailable");
          return;
        }
        try {
          this.mark(lease.store, "uncertain");
          this.emit("uncertain");
        } catch {
          this.configured = false;
          this.emit("unavailable");
        }
      }
    });
  }
  checkCurrentSignIn(): Promise<void> {
    return this.run(async (generation, lease) => {
      this.journal = this.readJournal(lease.store);
      this.emit("checking");
      if (!this.current(generation)) return;
      try {
        const identity = await this.bounded(lease.currentIdentity());
        if (this.current(generation) && !this.pendingInvalidation) {
          if (identity.kind === "signed_out" && this.activeJournal() && this.journal?.phase === "requested")
            this.emit("check_email");
          else this.emitIdentity(identity);
        }
      } catch {
        if (this.current(generation)) this.emit("uncertain");
      }
    });
  }
  /** Explicit user action only. Provider identity is a UX prerequisite, not owner authority. */
  enrollCurrentSession(): Promise<void> {
    if (this.operation) return this.operation;
    if (!this.state.enrollment.canEnroll) return Promise.resolve();
    return this.run(async (generation, lease) => {
      // Re-read under the origin lock: another tab's attempt must not be replayed.
      if (this.enrollmentPhase !== "not_requested" || !lease.ownerRequest || this.pendingInvalidation) {
        this.emit("changed");
        return;
      }
      let verified: Identity | null = null;
      try {
        this.enrollmentPhase = "requesting";
        this.emit("checking");
        const identity = await this.bounded(lease.currentIdentity());
        if (!this.current(generation) || this.pendingInvalidation) return;
        if (identity.kind !== "signed_in" || identity.emailVerified !== true) {
          this.enrollmentPhase = "rejected";
          this.emitIdentity(identity, true);
          return;
        }
        verified = identity;
        this.verifiedIdentity = identity;
        const startedAt = this.now();
        if (!Number.isSafeInteger(startedAt) || startedAt < 0) throw new Error("Clock");
        this.writeEnrollment(lease.store, {
          version: 1,
          operationId: lease.newFlowId(),
          phase: "requested",
          startedAt,
        });
        this.emit("checking", true);
        if (!this.current(generation) || this.pendingInvalidation) return;
        await this.bounded(lease.ownerRequest({ kind: "enroll-current-session" }));
        if (!this.current(generation)) return;
        this.finishEnrollment(lease.store, this.pendingInvalidation ? "unknown" : "enrolled");
        this.emit("signed_in", true);
      } catch (error) {
        if (!this.current(generation)) return;
        const definitive = error instanceof OwnerRequestError && error.outcome !== "uncertain";
        this.finishEnrollment(lease.store, definitive ? "rejected" : "unknown");
        // Failure before transmission is not fresh provider evidence; no error text is exposed.
        if (verified && !this.pendingInvalidation) this.emitIdentity(verified, true);
        else this.emit("uncertain");
      }
    });
  }
  /** Explicit read-only recovery. Never enroll, retry a POST, or infer worker/control state. */
  checkSessionEnrollment(): Promise<void> {
    if (this.operation) return this.operation;
    if (!this.state.enrollment.canCheck) return Promise.resolve();
    return this.run(async (generation, lease) => {
      if (!lease.ownerRequest || this.pendingInvalidation) {
        this.emit("changed");
        return;
      }
      let verified = false;
      try {
        this.enrollmentPhase = "checking";
        this.emit("checking");
        const identity = await this.bounded(lease.currentIdentity());
        if (!this.current(generation) || this.pendingInvalidation) return;
        if (identity.kind !== "signed_in" || identity.emailVerified !== true) {
          this.enrollmentPhase = "unknown";
          this.emitIdentity(identity, true);
          return;
        }
        verified = true;
        this.verifiedIdentity = identity;
        await this.bounded(lease.ownerRequest({ kind: "session-evidence" }));
        if (!this.current(generation)) return;
        this.finishEnrollment(lease.store, this.pendingInvalidation ? "unknown" : "enrolled");
        this.emit("signed_in", true);
      } catch (error) {
        if (!this.current(generation)) return;
        if (
          error instanceof OwnerRequestError &&
          error.outcome !== "uncertain" &&
          error.code === "APP_SESSION_ENROLL_REQUIRED"
        )
          this.enrollmentPhase = "not_requested";
        else
          this.finishEnrollment(
            lease.store,
            error instanceof OwnerRequestError && error.outcome === "rejected" ? "rejected" : "unknown",
          );
        this.emit(verified ? "signed_in" : "uncertain", verified);
      }
    });
  }
  /** Local-only reload state. No provider request or SDK is constructed. */
  initialize(): Promise<void> {
    return this.run(async (_generation, lease) => {
      this.journal = this.readJournal(lease.store);
      this.emit(this.activeJournal() ? (this.journal?.phase === "requested" ? "check_email" : "uncertain") : "ready");
    });
  }
  signOut(): Promise<void> {
    this.invalidateEnrollment();
    return this.run(async (generation, lease) => {
      this.journal = this.readJournal(lease.store);
      this.mark(lease.store, "cancelled"); // Pending links must not undo an explicit sign-out.
      this.emit("signing_out");
      if (!this.current(generation)) return;
      try {
        const outcome = lease.signOutWithRevocation
          ? await this.bounded(lease.signOutWithRevocation())
          : (await this.bounded(lease.signOut()), null);
        if (this.current(generation))
          this.emit(
            outcome?.appRevocation === "not_configured" && outcome.providerSignOut !== "confirmed"
              ? "uncertain"
              : outcome &&
                  (outcome.providerSignOut !== "confirmed" ||
                    !["confirmed", "not_configured"].includes(outcome.appRevocation))
                ? "signout_partial"
                : "signed_out",
          );
      } catch {
        if (this.current(generation)) this.emit("uncertain");
      }
    });
  }
  private emitIdentity(identity: Identity, preserveEnrollment = false) {
    if (!preserveEnrollment) this.invalidateEnrollment();
    this.verifiedIdentity = identity.kind === "signed_in" ? identity : null;
    if (identity.kind === "signed_in" && typeof identity.emailVerified === "boolean")
      this.emit("signed_in", identity.emailVerified);
    else if (identity.kind === "signed_out") this.emit("signed_out");
    else this.emit("uncertain");
  }
  /** A storage event is only an invalidation hint, never evidence of sign-in or owner identity. */
  notifySessionChanged() {
    if (!this.configured || this.closed) return;
    this.invalidateEnrollment();
    this.verifiedIdentity = null;
    this.emit("changed");
    if (this.operation) this.pendingInvalidation = true;
    else void this.checkCurrentSignIn();
  }
  close() {
    this.closed = true;
    this.generation++;
    this.cancelWait?.();
    try {
      this.auth.close?.();
    } catch {
      /* Teardown must never expose provider errors. */
    }
    this.listeners.clear();
    // Owned SDK adapter fences late responses/storage writes; injected adapters must honor close themselves.
  }
}
