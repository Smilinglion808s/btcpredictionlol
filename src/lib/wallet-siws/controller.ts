import {
  BoundaryError,
  DEFAULT_LOGIN_CONFIG,
  isoTime,
  unixTime,
  messagePreview,
  parseAcknowledgment,
  parseChallenge,
  parseSession,
  sameSession,
  validateConfig,
  type BackendPort,
  type ChallengeDTO,
  type LoginConfig,
  type SessionDTO,
} from "./contract";
import {
  accountEventAddress,
  createSiwsAdapter,
  inspectWallet,
  snapshotProof,
  type SiwsAdapter,
  type StandardWalletCandidate,
  type WalletChoice,
} from "./provider";
import {
  classifyChallengeFailure,
  classifyLoginFailure,
  classifyRestoreFailure,
  type LoginStage,
} from "./login-errors";
export type Phase =
  | "unconfigured"
  | "checking_session"
  | "closed"
  | "choose_wallet"
  | "provider_missing"
  | "provider_incompatible"
  | "ready"
  | "loading_challenge"
  | "review"
  | "awaiting_wallet"
  | "verifying"
  | "authenticated"
  | "rejected"
  | "expired"
  | "invalid_proof"
  | "forbidden"
  | "unavailable"
  | "error"
  | "uncertain"
  | "canceling"
  | "canceled"
  | "signed_out";
export interface Preview {
  readonly challengeId: string;
  readonly domain: string;
  readonly uri: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly requestId: string;
  readonly message: string;
}
export interface Snapshot {
  readonly phase: Phase;
  readonly opened: boolean;
  readonly busy: boolean;
  readonly choices: readonly WalletChoice[];
  readonly selectionId: string | null;
  readonly preview: Preview | null;
  readonly session: {
    readonly walletAddress: string;
    readonly sessionId: string;
    readonly expiresAt: string;
  } | null;
  readonly detail: string;
  readonly realExecutionEnabled: false;
}
interface Operation {
  readonly generation: number;
  readonly adapter: SiwsAdapter;
  challenge: ChallengeDTO | null;
  canceled: boolean;
  cancellationConfirmed: boolean;
  cancellationPromise: Promise<boolean> | null;
  walletPending: boolean;
  requestPending: boolean;
  expectedAccount: string | null;
}
const EMPTY: Snapshot = Object.freeze({
  phase: "unconfigured",
  opened: false,
  busy: false,
  choices: Object.freeze([]),
  selectionId: null,
  preview: null,
  session: null,
  detail: "Wallet login is not configured in this local candidate.",
  realExecutionEnabled: false,
});
/** One header-owned store. Construction, subscribe, open, and tick never sign or restore a cached session. */
export class WalletLoginController {
  private snapshot: Snapshot = EMPTY;
  private listeners = new Set<() => void>();
  private config: LoginConfig | null;
  private generation = 0;
  private selectionGeneration = 0;
  private adapter: SiwsAdapter | null = null;
  private selectedAccount: string | null = null;
  private stopObserving: (() => void) | null = null;
  private operation: Operation | null = null;
  private session: SessionDTO | null = null;
  private pendingLogout: SessionDTO | null = null;
  private initializationAttempted = false;
  private restoring = false;
  private restoreBlocked = false;
  private destroyed = false;
  private walletIds = new WeakMap<object, string>();
  private nextWalletId = 0;
  private choiceWallets = new Map<string, StandardWalletCandidate>();
  constructor(
    private readonly backend: BackendPort | null = null,
    config: LoginConfig | null = DEFAULT_LOGIN_CONFIG,
    private wallets: readonly StandardWalletCandidate[] = [],
    private readonly now: () => number = Date.now,
  ) {
    this.config = config ? validateConfig(config) : null;
    if (this.config && backend)
      this.snapshot = Object.freeze({
        ...EMPTY,
        phase: "closed",
        detail: "Sign in with the allowlisted wallet to review owner controls.",
      });
  }
  getSnapshot = (): Snapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<Snapshot>): void {
    if (this.destroyed) return;
    this.snapshot = Object.freeze({
      ...this.snapshot,
      ...patch,
      realExecutionEnabled: false,
    });
    for (const listener of this.listeners) listener();
  }
  private current(op: Operation): boolean {
    return (
      !this.destroyed &&
      this.operation === op &&
      !op.canceled &&
      op.generation === this.generation
    );
  }
  private fence(op: Operation): void {
    if (!this.current(op)) throw new BoundaryError("STALE_OPERATION");
  }
  private removeObserver(): void {
    const off = this.stopObserving;
    this.stopObserving = null;
    off?.();
  }
  open(): void {
    if (this.destroyed) return;
    if (!this.config || !this.backend) {
      this.set({ opened: true, phase: "unconfigured" });
      return;
    }
    if (
      this.operation ||
      this.session ||
      this.pendingLogout ||
      this.restoring
    ) {
      this.set({ opened: true });
      return;
    }
    const generation = this.generation;
    this.updateWallets(this.wallets);
    if (generation !== this.generation || this.destroyed) return;
    const choices = this.snapshot.choices;
    this.set({
      opened: true,
      phase: choices.length ? "choose_wallet" : "provider_missing",
      detail: choices.length
        ? "Choose a wallet to prepare a login message."
        : "No compatible wallet is available in this browser.",
    });
  }
  /** Metadata-only registration update. Stable object IDs preserve a pending choice across unrelated additions. */
  updateWallets(wallets: readonly StandardWalletCandidate[]): void {
    if (
      this.destroyed ||
      !this.config ||
      !this.backend ||
      !Array.isArray(wallets) ||
      wallets.length > 20
    )
      return;
    const generation = this.generation;
    const fence = () => {
      if (this.destroyed || generation !== this.generation)
        throw new BoundaryError("STALE_OPERATION");
    };
    const entries = new Map<string, StandardWalletCandidate>();
    let choices: WalletChoice[];
    try {
      choices = [...new Set(wallets)].map((wallet) => {
        let id = this.walletIds.get(wallet);
        if (!id) {
          id = `wallet-${this.nextWalletId++}`;
          this.walletIds.set(wallet, id);
        }
        entries.set(id, wallet);
        return inspectWallet(wallet, id, fence);
      });
      fence();
    } catch {
      return;
    }
    this.wallets = wallets.slice();
    this.choiceWallets = entries;
    const removed =
      this.snapshot.selectionId !== null &&
      !choices.some((c) => c.id === this.snapshot.selectionId && c.compatible);
    this.set({ choices: Object.freeze(choices) });
    if (removed) {
      this.selectionGeneration++;
      this.removeObserver();
      this.adapter = null;
      this.selectedAccount = null;
      this.set({ selectionId: null });
      if (this.operation)
        this.cancel("Selected wallet was removed. Login canceled.");
      else if (this.session) void this.logout();
      else
        this.set({
          phase: choices.length ? "choose_wallet" : "provider_missing",
          preview: null,
          detail:
            "Selected wallet is no longer available. Choose a compatible wallet.",
        });
    }
  }
  /** Explicit header click can prepare for one recognized compatible Phantom; it still never signs. */
  async openFromHeader(): Promise<void> {
    this.open();
    if (
      !this.snapshot.opened ||
      this.operation ||
      this.session ||
      this.pendingLogout ||
      this.restoring
    )
      return;
    const phantom = this.snapshot.choices.filter(
      (c) => c.compatible && c.name === "Phantom",
    );
    if (phantom.length === 1) {
      this.selectWallet(phantom[0].id);
      await this.prepare();
    }
  }
  selectWallet(id: string): void {
    if (this.destroyed || !this.config || !this.backend || this.restoring)
      return;
    if (this.operation) {
      this.cancel(
        "Wallet selection changed. Previous login has been canceled.",
      );
      return;
    }
    if (this.session || this.pendingLogout) {
      void this.logout();
      return;
    }
    const choice = this.snapshot.choices.find((c) => c.id === id);
    if (!choice) return;
    this.generation++;
    const selection = ++this.selectionGeneration;
    const generation = this.generation;
    this.removeObserver();
    this.adapter = null;
    this.selectedAccount = null;
    this.set({
      selectionId: id,
      preview: null,
      session: null,
      phase: choice.compatible ? "ready" : "provider_incompatible",
      detail: choice.compatible
        ? "Prepare a one-time login message, then review it before signing."
        : "This wallet does not support the required Sign-In With Solana feature. No fallback signature will be requested.",
    });
    if (!choice.compatible) return;
    const wallet = this.choiceWallets.get(id);
    if (!wallet) return;
    const adapter = createSiwsAdapter(wallet, choice);
    const fence = () => {
      if (
        this.destroyed ||
        selection !== this.selectionGeneration ||
        generation !== this.generation ||
        !this.snapshot.opened
      )
        throw new BoundaryError("STALE_SELECTION");
    };
    try {
      this.adapter = adapter;
      this.stopObserving = adapter.observeAccounts(
        (accounts) => {
          if (this.destroyed || selection !== this.selectionGeneration) return;
          const address = accountEventAddress(accounts);
          const expected =
            this.operation?.expectedAccount ??
            this.session?.wallet_address ??
            this.selectedAccount;
          this.selectedAccount = address;
          if (address && (!expected || address === expected)) {
            if (this.operation) this.operation.expectedAccount = address;
            return;
          }
          if (this.operation)
            this.cancel("Wallet account changed. Login canceled.");
          else if (this.session) void this.logout();
          else {
            this.generation++;
            this.set({
              phase: "ready",
              preview: null,
              detail:
                "Wallet account changed. The server will verify the next login against the owner allowlist.",
            });
          }
        },
        fence,
        () => {
          if (this.destroyed || selection !== this.selectionGeneration) return;
          this.selectionGeneration++;
          this.removeObserver();
          this.adapter = null;
          this.selectedAccount = null;
          this.set({
            selectionId: null,
            choices: Object.freeze(
              this.snapshot.choices.map((c) =>
                c.id === id ? Object.freeze({ ...c, compatible: false }) : c,
              ),
            ),
          });
          if (this.operation)
            this.cancel("Wallet capabilities changed. Login canceled.");
          else if (this.session) void this.logout();
          else
            this.set({
              phase: "provider_incompatible",
              preview: null,
              detail:
                "Wallet capabilities changed. Select a compatible wallet again.",
            });
        },
      );
    } catch {
      this.adapter = null;
      if (generation !== this.generation || !this.snapshot.opened) return;
      this.set({
        phase: "provider_incompatible",
        detail: "Wallet events are unavailable. Login stays locked.",
      });
    }
  }
  /** Explicit Prepare click only. Body is {}, never provider-selected address or caller nonce. */
  async prepare(): Promise<void> {
    if (
      this.destroyed ||
      !this.config ||
      !this.backend ||
      !this.adapter ||
      this.operation ||
      this.session ||
      this.pendingLogout ||
      this.restoring ||
      this.snapshot.busy ||
      !this.snapshot.opened
    )
      return;
    const op: Operation = {
      generation: ++this.generation,
      adapter: this.adapter,
      challenge: null,
      canceled: false,
      cancellationConfirmed: false,
      cancellationPromise: null,
      walletPending: false,
      requestPending: true,
      expectedAccount: this.selectedAccount,
    };
    this.operation = op;
    this.set({
      phase: "loading_challenge",
      busy: true,
      preview: null,
      session: null,
      detail: "Preparing a short-lived login challenge. No wallet prompt yet.",
    });
    try {
      this.fence(op);
      const raw = await this.backend.createChallenge();
      op.requestPending = false;
      // Even a late response needs its cancellation latch invalidated. It can never authorize the UI.
      if (!this.current(op)) {
        op.challenge = parseChallenge(raw, this.config, this.now(), true);
        await this.cancelOperation(op);
        return;
      }
      op.challenge = parseChallenge(raw, this.config, this.now());
      const c = op.challenge;
      const input = c.sign_in_input;
      this.set({
        phase: "review",
        busy: false,
        preview: Object.freeze({
          challengeId: c.challenge_id,
          domain: input.domain,
          uri: input.uri,
          nonce: input.nonce,
          issuedAt: input.issuedAt,
          expiresAt: input.expirationTime,
          requestId: input.requestId,
          message: messagePreview(input),
        }),
        detail:
          "Review the exact login-only message. Signing does not authorize transactions, transfers, or trading.",
      });
    } catch (error) {
      op.requestPending = false;
      if (op.canceled) {
        this.operation = null;
        this.set({
          phase: "canceled",
          busy: false,
          detail:
            "Closed before signing. The challenge request did not finish; no login proof was submitted.",
        });
        return;
      }
      if (!this.current(op)) return;
      this.operation = null;
      const failure = classifyChallengeFailure(error);
      this.set({
        phase: failure.phase,
        busy: false,
        preview: null,
        detail: failure.detail,
      });
    }
  }
  /** Only explicit click with the exact currently displayed challenge ID may reach the SIWS method. */
  async confirmLogin(challengeId: string): Promise<void> {
    const op = this.operation;
    if (
      !op ||
      !this.current(op) ||
      !this.backend ||
      !this.config ||
      !op.challenge ||
      this.snapshot.phase !== "review" ||
      this.snapshot.busy ||
      !this.snapshot.opened ||
      challengeId !== op.challenge.challenge_id
    )
      return;
    if (this.now() >= unixTime(op.challenge.expires_at)) {
      this.cancel("Login message expired. Prepare a new message.", "expired");
      return;
    }
    op.walletPending = true;
    this.set({
      phase: "awaiting_wallet",
      busy: true,
      detail:
        "Review the login-only prompt in your wallet. No transaction is requested.",
    });
    let stage: LoginStage = "wallet";
    try {
      const output = await op.adapter.signIn(op.challenge.sign_in_input, () =>
        this.fence(op),
      );
      op.walletPending = false;
      if (!this.current(op)) {
        this.finishCanceled(op);
        return;
      }
      stage = "proof";
      if (this.now() >= unixTime(op.challenge.expires_at))
        throw new BoundaryError("EXPIRED_CHALLENGE");
      const proof = snapshotProof(output, op.challenge, () => this.fence(op));
      if (op.expectedAccount && proof.account.address !== op.expectedAccount)
        throw new BoundaryError("ACCOUNT_MISMATCH");
      this.fence(op);
      this.set({
        phase: "verifying",
        detail:
          "Verifying the proof and current session on the server. Controls remain locked.",
      });
      this.fence(op);
      op.requestPending = true;
      stage = "verify";
      const raw = await this.backend.verifyProof(
        proof,
        op.challenge.csrf_token,
      );
      op.requestPending = false;
      if (!this.current(op)) {
        this.finishCanceled(op);
        return;
      }
      const verified = parseSession(raw, this.config, this.now());
      if (
        verified.wallet_address !== proof.account.address ||
        unixTime(verified.issued_at) <
          isoTime(op.challenge.sign_in_input.issuedAt)
      )
        throw new BoundaryError("SESSION_MISMATCH");
      this.fence(op);
      op.requestPending = true;
      stage = "session";
      const freshRaw = await this.backend.readSession();
      op.requestPending = false;
      if (!this.current(op)) {
        this.finishCanceled(op);
        return;
      }
      const fresh = parseSession(freshRaw, this.config, this.now());
      if (!sameSession(verified, fresh))
        throw new BoundaryError("SESSION_MISMATCH");
      this.fence(op);
      this.session = fresh;
      this.operation = null;
      this.set({
        phase: "authenticated",
        busy: false,
        preview: null,
        session: Object.freeze({
          walletAddress: fresh.wallet_address,
          sessionId: fresh.session_id,
          expiresAt: new Date(unixTime(fresh.expires_at)).toISOString(),
        }),
        detail:
          "Wallet login verified. Owner controls are available for review. Execution state is shown separately in backend controls.",
      });
    } catch (error) {
      op.walletPending = false;
      op.requestPending = false;
      if (!this.current(op)) {
        this.finishCanceled(op);
        return;
      }
      const failure = classifyLoginFailure(error, stage);
      this.cancel(failure.detail, failure.phase);
    }
  }
  private finishCanceled(op: Operation): void {
    if (
      this.operation === op &&
      op.canceled &&
      op.cancellationConfirmed &&
      !op.walletPending &&
      !op.requestPending
    ) {
      this.operation = null;
      this.set({ busy: false });
    }
  }
  private async cancelOperation(
    op: Operation,
    terminal: Phase = "canceled",
    detail = "Login canceled. No controls are authorized.",
  ): Promise<boolean> {
    if (op.cancellationConfirmed) {
      this.finishCanceled(op);
      return true;
    }
    if (op.cancellationPromise) return op.cancellationPromise;
    if (!op.challenge || !this.backend) return false;
    const challenge = op.challenge;
    const promise = (async () => {
      try {
        const raw = await this.backend!.cancelChallenge(
          challenge.challenge_id,
          challenge.csrf_token,
        );
        parseAcknowledgment(raw, "canceled", this.now());
        op.cancellationConfirmed = true;
        if (this.operation === op) {
          this.set({
            phase: terminal,
            busy: op.walletPending || op.requestPending,
            detail:
              detail +
              (op.walletPending
                ? " Dismiss any still-open wallet prompt."
                : ""),
            preview: null,
            session: null,
          });
          this.finishCanceled(op);
        }
        return true;
      } catch {
        if (this.operation === op)
          this.set({
            phase: "uncertain",
            busy: op.walletPending || op.requestPending,
            preview: null,
            session: null,
            detail:
              "Server cancellation is not confirmed. Controls stay locked; retry cancellation before starting another login.",
          });
        return false;
      } finally {
        op.cancellationPromise = null;
      }
    })();
    op.cancellationPromise = promise;
    return promise;
  }
  cancel(
    detail = "Login canceled. No controls are authorized.",
    terminal: Phase = "canceled",
  ): void {
    const op = this.operation;
    if (!op) return;
    op.canceled = true;
    this.restoreBlocked = true;
    this.generation++;
    this.session = null;
    this.set({
      phase: "canceling",
      preview: null,
      session: null,
      busy: true,
      detail:
        "Canceling login on the server. Closing this panel alone does not revoke a server session.",
    });
    if (op.challenge) void this.cancelOperation(op, terminal, detail);
  }
  async retryCancellation(): Promise<void> {
    if (this.pendingLogout) {
      await this.logout();
      return;
    }
    const op = this.operation;
    if (op?.canceled && op.challenge) await this.cancelOperation(op);
  }
  close(): void {
    if (!this.operation) this.generation++;
    this.set(
      this.restoring
        ? {
            opened: false,
            phase: "closed",
            busy: false,
            detail: "Session check dismissed. No login request was made.",
          }
        : { opened: false },
    );
    if (this.operation) this.cancel();
  }
  /** Notification only: no address, proof, token, or session ID needs to cross tab boundaries. */
  invalidateSession(): void {
    this.restoreBlocked = true;
    if (this.pendingLogout) {
      this.set({ session: null, preview: null });
      return;
    }
    if (this.operation)
      this.cancel("Session changed in another tab. Login canceled.");
    else {
      this.generation++;
      this.session = null;
      this.set({
        phase: "signed_out",
        busy: false,
        preview: null,
        session: null,
        detail: "Session changed. Sign in again to review controls.",
      });
    }
  }
  /** Host invokes once per controller lifetime. Fresh cookie-backed server verification, never cached-token auth. */
  async restoreSession(): Promise<SessionDTO | null> {
    if (
      this.destroyed ||
      this.initializationAttempted ||
      this.restoreBlocked ||
      this.restoring ||
      this.operation ||
      this.pendingLogout ||
      this.session ||
      !this.backend ||
      !this.config
    )
      return null;
    this.initializationAttempted = true;
    this.restoring = true;
    const generation = ++this.generation;
    this.set({
      phase: "checking_session",
      busy: true,
      session: null,
      preview: null,
      detail: "Checking the current wallet session on the server.",
    });
    try {
      if (
        this.destroyed ||
        generation !== this.generation ||
        this.restoreBlocked
      )
        return null;
      const fresh = parseSession(
        await this.backend.readSession(),
        this.config,
        this.now(),
      );
      if (
        this.destroyed ||
        generation !== this.generation ||
        this.restoreBlocked ||
        this.operation ||
        this.pendingLogout
      )
        return null;
      this.session = fresh;
      this.set({
        phase: "authenticated",
        busy: false,
        session: Object.freeze({
          walletAddress: fresh.wallet_address,
          sessionId: fresh.session_id,
          expiresAt: new Date(unixTime(fresh.expires_at)).toISOString(),
        }),
        detail:
          "Current wallet session verified by the server. Execution state is shown separately in backend controls.",
      });
      return fresh;
    } catch (error) {
      if (
        !this.destroyed &&
        generation === this.generation &&
        !this.restoreBlocked
      ) {
        const failure = classifyRestoreFailure(error);
        this.set({
          phase: failure.phase,
          busy: false,
          session: null,
          detail: failure.detail,
        });
      }
      return null;
    } finally {
      this.restoring = false;
    }
  }
  /** Focus checks do nothing while a wallet prompt is pending; never auto-sign or create a challenge. */
  async checkSession(): Promise<SessionDTO | null> {
    if (
      this.destroyed ||
      this.operation ||
      !this.backend ||
      !this.config ||
      !this.session
    )
      return null;
    const prior = this.session;
    const generation = this.generation;
    try {
      const fresh = parseSession(
        await this.backend.readSession(),
        this.config,
        this.now(),
      );
      if (
        this.destroyed ||
        generation !== this.generation ||
        this.session !== prior
      )
        return null;
      if (!sameSession(prior, fresh))
        throw new BoundaryError("SESSION_MISMATCH");
      this.session = fresh;
      return fresh;
    } catch (error) {
      if (generation === this.generation && this.session === prior) {
        this.generation++;
        this.session = null;
        this.restoreBlocked = true;
        const failure = classifyRestoreFailure(error);
        this.set({
          phase: failure.phase,
          busy: false,
          session: null,
          preview: null,
          detail: failure.detail,
        });
      }
      return null;
    }
  }

  async logout(): Promise<void> {
    this.restoreBlocked = true;
    if (this.pendingLogout && this.snapshot.busy) return;
    if (this.operation) {
      this.cancel();
      return;
    }
    const prior = this.session ?? this.pendingLogout;
    if (!prior || !this.backend) {
      this.invalidateSession();
      return;
    }
    const generation = ++this.generation;
    this.pendingLogout = prior;
    this.session = null;
    this.set({
      phase: "canceling",
      session: null,
      preview: null,
      busy: true,
      detail: "Signing out on the server. Controls are locked immediately.",
    });
    try {
      parseAcknowledgment(
        await this.backend.logout(prior.csrf_token),
        "logged_out",
        this.now(),
      );
      if (generation === this.generation) {
        this.pendingLogout = null;
        this.set({
          phase: "signed_out",
          busy: false,
          detail:
            "Signed out. Server sessions and pending challenges were revoked.",
        });
      }
    } catch {
      if (generation === this.generation)
        this.set({
          phase: "uncertain",
          busy: false,
          detail:
            "Server sign-out is unconfirmed. Controls stay locked. Reloading is not proof of revocation.",
        });
    }
  }
  tick(): void {
    if (
      this.operation?.challenge &&
      !this.operation.canceled &&
      this.now() >= unixTime(this.operation.challenge.expires_at)
    )
      this.cancel("Login message expired. Prepare a new one.", "expired");
    if (this.session && this.now() >= unixTime(this.session.expires_at)) {
      this.generation++;
      this.session = null;
      this.set({
        phase: "expired",
        session: null,
        preview: null,
        detail: "Your short app session expired. Sign in again.",
      });
    }
  }
  destroy(): void {
    if (this.destroyed) return;
    this.close();
    this.removeObserver();
    this.selectionGeneration++;
    this.generation++;
    this.session = null;
    this.destroyed = true;
    this.listeners.clear();
  }
}
