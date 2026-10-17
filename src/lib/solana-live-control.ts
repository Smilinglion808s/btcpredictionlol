/** Offline operator-control candidate. No signer, wallet SDK, RPC or live adapter. */
export const LIVE_ACTIVATION_IMPLEMENTED = false;
export const STATUS_MAX_AGE_MS = 10_000;
export const WORKER_MAX_AGE_SECONDS = 15;
export const PENDING_STORAGE_KEY = "solana-control-pending-v1";
export type Action = "OFF" | "PAUSE_ENTRIES" | "REQUEST_LIVE";
export type Mode = "OFF" | "PAUSE_ENTRIES" | "UNKNOWN";
export interface ControlStatus {
  contract_version: 1;
  accounting_scope: "SYNTHETIC_FIXTURES_ONLY";
  package_mode: "OFFLINE_PREPARATION";
  owner_authenticated: boolean;
  desired_mode: "OFF" | "PAUSE_ENTRIES";
  observed_mode: Mode;
  version: number;
  acknowledged_version: number | null;
  applied_command_id: string | null;
  pending_command_id: string | null;
  pending_ack: boolean;
  worker_epoch: number;
  worker_stale: boolean;
  worker_heartbeat_at: number | null;
  halted: boolean;
  halt_generation: number;
  halt_reasons: string[];
  reconciliation_required: boolean;
  reconciliation_as_of: number | null;
  pending_outcomes: number | null;
  unknown_outcomes: number | null;
  residual_holdings_count: number | null;
  existing_exit_monitoring_active: boolean;
  readiness: { ready: boolean; blockers: string[] };
  live_capable: boolean;
  runtime_identity: string;
  policy_hash: string;
  server_time: number;
}
export interface Command {
  command_id: string;
  expected_version: number;
  action: Action;
  expires_at: number;
  expected_runtime_identity: string;
  expected_policy_hash: string;
  reason: string;
}
export interface Receipt {
  contract_version: 1;
  command_id: string;
  accepted: boolean;
  code: string;
  version: number;
  desired_mode: "OFF" | "PAUSE_ENTRIES";
  acknowledged: false;
  created_at: number;
  blockers: string[];
}
export interface Session {
  csrf_token: string;
  expires_at: number;
}
export interface Pending {
  command: Command;
  acceptedVersion: number | null;
  uncertain: boolean;
}
export interface ControlState {
  status: ControlStatus | null;
  receivedAt: number | null;
  session: Session | null;
  connection: "loading" | "connected" | "unavailable" | "unauthorized";
  pending: Pending | null;
  sending: Action | null;
  message: string | null;
  journalError: string | null;
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Malformed control response");
  return v as Record<string, unknown>;
};
const text = (v: unknown, max = 256): string => {
  if (typeof v !== "string" || !v.length || v.length > max)
    throw new Error("Malformed control text");
  return v;
};
const bool = (v: unknown): boolean => {
  if (typeof v !== "boolean") throw new Error("Malformed control flag");
  return v;
};
const integer = (v: unknown): number => {
  if (!Number.isSafeInteger(v) || (v as number) < 0)
    throw new Error("Malformed control counter");
  return v as number;
};
const nullableInteger = (v: unknown): number | null =>
  v === null ? null : integer(v);
const optionalInteger = (v: unknown): number | null =>
  v === undefined ? null : nullableInteger(v);
const nullableText = (v: unknown): string | null =>
  v === null ? null : text(v);
const texts = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.length > 100)
    throw new Error("Malformed control reasons");
  return v.map((x) => text(x, 1000));
};
function desired(v: unknown): "OFF" | "PAUSE_ENTRIES" {
  if (v !== "OFF" && v !== "PAUSE_ENTRIES")
    throw new Error("Unsupported desired mode");
  return v;
}
export function parseStatus(input: unknown): ControlStatus {
  const v = object(input),
    r = object(v.readiness);
  if (
    v.contract_version !== 1 ||
    v.package_mode !== "OFFLINE_PREPARATION" ||
    v.accounting_scope !== "SYNTHETIC_FIXTURES_ONLY"
  )
    throw new Error("Unsupported control contract");
  if (
    typeof v.observed_mode !== "string" ||
    !["OFF", "PAUSE_ENTRIES", "UNKNOWN"].includes(v.observed_mode)
  )
    throw new Error("Unsupported worker mode");
  const result: ControlStatus = {
    contract_version: 1,
    accounting_scope: "SYNTHETIC_FIXTURES_ONLY",
    package_mode: "OFFLINE_PREPARATION",
    owner_authenticated: bool(v.owner_authenticated),
    desired_mode: desired(v.desired_mode),
    observed_mode: v.observed_mode as Mode,
    version: integer(v.version),
    acknowledged_version: nullableInteger(v.acknowledged_version),
    applied_command_id: nullableText(v.applied_command_id),
    pending_command_id: nullableText(v.pending_command_id),
    pending_ack: bool(v.pending_ack),
    worker_epoch: integer(v.worker_epoch),
    worker_stale: bool(v.worker_stale),
    worker_heartbeat_at: nullableInteger(v.worker_heartbeat_at),
    halted: bool(v.halted),
    halt_generation: integer(v.halt_generation),
    halt_reasons: texts(v.halt_reasons),
    reconciliation_required: bool(v.reconciliation_required),
    reconciliation_as_of: optionalInteger(v.reconciliation_as_of),
    pending_outcomes: optionalInteger(v.pending_outcomes),
    unknown_outcomes: optionalInteger(v.unknown_outcomes),
    residual_holdings_count: optionalInteger(v.residual_holdings_count),
    existing_exit_monitoring_active: bool(v.existing_exit_monitoring_active),
    readiness: { ready: bool(r.ready), blockers: texts(r.blockers) },
    live_capable: bool(v.live_capable),
    runtime_identity: text(v.runtime_identity),
    policy_hash: text(v.policy_hash),
    server_time: integer(v.server_time),
  };
  if (
    result.acknowledged_version !== null &&
    result.acknowledged_version > result.version
  )
    throw new Error("Impossible worker version");
  if (
    result.worker_heartbeat_at !== null &&
    result.worker_heartbeat_at > result.server_time + 2
  )
    throw new Error("Future worker heartbeat");
  return result;
}
export function parseReceipt(input: unknown): Receipt {
  const v = object(input);
  if (v.contract_version !== 1 || v.acknowledged !== false)
    throw new Error("A receipt is not worker acknowledgement");
  return {
    contract_version: 1,
    command_id: text(v.command_id),
    accepted: bool(v.accepted),
    code: text(v.code),
    version: integer(v.version),
    desired_mode: desired(v.desired_mode),
    acknowledged: false,
    created_at: integer(v.created_at),
    blockers: texts(v.blockers),
  };
}
export function parseSession(input: unknown): Session {
  const v = object(input);
  return {
    csrf_token: text(v.csrf_token, 4096),
    expires_at: integer(v.expires_at),
  };
}
export function transportFresh(state: ControlState, now: number): boolean {
  return (
    state.connection === "connected" &&
    state.receivedAt !== null &&
    now >= state.receivedAt &&
    now - state.receivedAt <= STATUS_MAX_AGE_MS
  );
}
export function workerFresh(state: ControlState, now: number): boolean {
  const s = state.status;
  if (
    !s ||
    !transportFresh(state, now) ||
    s.worker_stale ||
    s.worker_heartbeat_at === null
  )
    return false;
  const age =
    s.server_time - s.worker_heartbeat_at + (now - state.receivedAt!) / 1000;
  return age >= -2 && age <= WORKER_MAX_AGE_SECONDS;
}
export function ownerReady(state: ControlState, now: number): boolean {
  const s = state.status,
    session = state.session;
  return Boolean(
    s?.owner_authenticated &&
    session &&
    transportFresh(state, now) &&
    session.expires_at > s.server_time + (now - state.receivedAt!) / 1000,
  );
}
export function canCommand(
  state: ControlState,
  action: Action,
  now: number,
): boolean {
  // This is a presentation guard, never authorization. The server independently validates every command.
  if (state.journalError) return false;
  if (action === "REQUEST_LIVE") return false; // No financial adapter exists in this candidate.
  if (
    !ownerReady(state, now) ||
    state.sending === action ||
    state.pending?.command.action === action
  )
    return false;
  if (action === "OFF") return true; // Restrictive stop stays available during stale worker / pending pause.
  return (
    state.sending === null &&
    state.pending === null &&
    workerFresh(state, now) &&
    !state.status!.halted
  );
}
export function observedLabel(state: ControlState, now: number): string {
  const s = state.status;
  if (!s) return "Unavailable";
  if (!transportFresh(state, now) || !workerFresh(state, now))
    return "UNKNOWN · worker not current";
  if (
    s.pending_ack ||
    s.acknowledged_version !== s.version ||
    s.pending_command_id
  )
    return "PENDING · not acknowledged";
  if (s.observed_mode !== s.desired_mode)
    return "UNKNOWN · desired / observed mismatch";
  if (
    state.pending?.acceptedVersion === s.version &&
    s.applied_command_id !== state.pending.command.command_id
  )
    return "UNKNOWN · command acknowledgement mismatch";
  if (s.observed_mode === "OFF") return "OFF · worker acknowledged";
  if (s.observed_mode === "PAUSE_ENTRIES") return "PAUSED · entries only";
  return "UNKNOWN";
}
export interface Transport {
  session(): Promise<Session>;
  status(): Promise<ControlStatus>;
  command(command: Command, csrf: string): Promise<Receipt>;
  receipt(commandId: string): Promise<Receipt | null>;
}
export class ControlError extends Error {
  code: "auth" | "stale" | "blocked" | "unavailable" | "uncertain";
  constructor(code: ControlError["code"], message: string) {
    super(message);
    this.code = code;
  }
}
export function createHttpTransport(
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
): Transport {
  async function request(
    path: string,
    init: RequestInit = {},
    command = false,
  ): Promise<unknown> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const r = await fetcher(path, {
        ...init,
        signal: abort.signal,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json", ...init.headers },
      });
      if (r.status === 401 || r.status === 403)
        throw new ControlError(
          "auth",
          "Owner session expired or permission denied. No control action is confirmed.",
        );
      if (r.status === 409)
        throw new ControlError(
          "stale",
          "Control state changed. Refreshed state is required; nothing is retried automatically.",
        );
      if (r.status === 422)
        throw new ControlError(
          "blocked",
          "The backend refused this request because a safety requirement is not met.",
        );
      if (!r.ok)
        throw new ControlError(
          command ? "uncertain" : "unavailable",
          command
            ? "Request outcome is unknown. Refresh status before any further request."
            : "Control backend unavailable. The paper session is separate and unchanged.",
        );
      if (
        !r.headers
          .get("content-type")
          ?.toLowerCase()
          .includes("application/json")
      )
        throw new Error("Expected JSON");
      const raw = await r.text();
      if (raw.length > 65536) throw new Error("Response too large");
      return JSON.parse(raw);
    } catch (e) {
      if (e instanceof ControlError) throw e;
      throw new ControlError(
        command ? "uncertain" : "unavailable",
        command
          ? "Request timed out or returned an invalid response. It may have been accepted; no automatic retry."
          : "Control backend unavailable or invalid. Controls remain locked.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    session: async () => parseSession(await request("/api/control/session")),
    status: async () => parseStatus(await request("/api/control/status")),
    command: async (body, csrf) =>
      parseReceipt(
        await request(
          "/api/control/commands",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrf,
            },
            body: JSON.stringify(body),
          },
          true,
        ),
      ),
    receipt: async (id) => {
      try {
        return parseReceipt(
          await request(`/api/control/commands/${encodeURIComponent(id)}`),
        );
      } catch (e) {
        if (e instanceof ControlError && e.code === "unavailable") return null;
        throw e;
      }
    },
  };
}
export interface PendingStore {
  read(): Pending | null;
  write(pending: Pending | null): void;
}
export function sessionPendingStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): PendingStore {
  return {
    read() {
      try {
        const raw = storage.getItem(PENDING_STORAGE_KEY);
        if (raw === null) return null;
        if (!raw.length || raw.length > 4096)
          throw new Error("Invalid saved request journal");
        const p = object(JSON.parse(raw)),
          c = object(p.command);
        if (
          typeof c.action !== "string" ||
          !["OFF", "PAUSE_ENTRIES"].includes(c.action)
        )
          throw new Error("Invalid saved action");
        return {
          command: {
            command_id: text(c.command_id),
            expected_version: integer(c.expected_version),
            action: c.action as Action,
            expires_at: integer(c.expires_at),
            expected_runtime_identity: text(c.expected_runtime_identity),
            expected_policy_hash: text(c.expected_policy_hash),
            reason: text(c.reason, 1000),
          },
          acceptedVersion: nullableInteger(p.acceptedVersion),
          uncertain: true,
        };
      } catch {
        throw new Error(
          "Browser request journal is unreadable or malformed. Prior request outcome is unknown.",
        );
      }
    },
    write(pending) {
      if (pending)
        storage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
      else storage.removeItem(PENDING_STORAGE_KEY);
    },
  };
}
export class ControlClient {
  private state: ControlState;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private refreshSequence = 0;
  private closed = false;
  constructor(
    private transport: Transport,
    private now: () => number = Date.now,
    private id: () => string = () => crypto.randomUUID(),
    private store?: PendingStore,
  ) {
    this.state = this.initialState();
  }
  private initialState(): ControlState {
    let pending: Pending | null = null;
    let journalError: string | null = null;
    try {
      pending = this.store?.read() ?? null;
    } catch {
      journalError =
        "Browser request journal is unreadable. Previous request outcome is unknown; controls are locked.";
    }
    return {
      status: null,
      receivedAt: null,
      session: null,
      connection: "loading",
      pending,
      sending: null,
      journalError,
      message:
        journalError ??
        (pending
          ? "A previous request needs reconciliation. Nothing was replayed after reload."
          : null),
    };
  }
  /** Re-enter from a React effect, including StrictMode setup/cleanup/setup. Never replay. */
  activate() {
    this.epoch++;
    this.refreshSequence++;
    this.closed = false;
    this.state = this.initialState();
    for (const fn of this.listeners) fn();
  }
  snapshot = (): ControlState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<ControlState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  private pending(pending: Pending | null) {
    try {
      this.store?.write(pending);
    } catch {
      const message =
        "Browser request journal could not be saved. Controls are locked; no request is retried.";
      this.update({ journalError: message });
      throw new ControlError("uncertain", message);
    }
    this.update({ pending });
  }
  close() {
    this.closed = true;
    this.epoch++;
    this.refreshSequence++;
    this.listeners.clear();
  }
  async refresh(): Promise<void> {
    if (this.closed) return;
    const seq = ++this.refreshSequence,
      epoch = this.epoch;
    try {
      const session = await this.transport.session(),
        status = await this.transport.status();
      if (this.closed || seq !== this.refreshSequence || epoch !== this.epoch)
        return;
      if (
        this.state.status &&
        (status.version < this.state.status.version ||
          status.server_time < this.state.status.server_time ||
          status.worker_epoch < this.state.status.worker_epoch)
      )
        throw new ControlError(
          "unavailable",
          "Older control evidence was rejected. Status is not current.",
        );
      this.update({
        session,
        status,
        receivedAt:
          status.server_time === this.state.status?.server_time
            ? this.state.receivedAt
            : this.now(),
        connection: status.owner_authenticated ? "connected" : "unauthorized",
      });
      const pending = this.state.pending;
      if (!pending) return;
      let receipt: Receipt | null = null;
      if (pending.acceptedVersion === null)
        receipt = await this.transport.receipt(pending.command.command_id);
      if (
        this.closed ||
        seq !== this.refreshSequence ||
        epoch !== this.epoch ||
        this.state.pending?.command.command_id !== pending.command.command_id
      )
        return;
      if (receipt && receipt.command_id !== pending.command.command_id)
        throw new Error("Wrong receipt identity");
      if (receipt && !receipt.accepted) {
        this.pending(null);
        this.update({
          message:
            "The previous request was rejected. Review current status before trying a different request.",
        });
        return;
      }
      const acceptedVersion = receipt?.version ?? pending.acceptedVersion;
      if (
        acceptedVersion !== null &&
        (status.version > acceptedVersion ||
          (status.acknowledged_version === acceptedVersion &&
            status.applied_command_id === pending.command.command_id &&
            !status.pending_ack))
      ) {
        this.pending(null);
        this.update({
          message:
            status.version > acceptedVersion
              ? "A newer command superseded this request. Current server state is shown."
              : "A recorded acknowledgement matches this request. Current worker health is shown separately. This does not close holdings or recall pending transactions.",
        });
      } else if (acceptedVersion !== pending.acceptedVersion)
        this.pending({ ...pending, acceptedVersion, uncertain: false });
    } catch (e) {
      if (this.closed || seq !== this.refreshSequence || epoch !== this.epoch)
        return;
      const err =
        e instanceof ControlError
          ? e
          : new ControlError(
              "unavailable",
              "Invalid control evidence. Controls remain locked.",
            );
      this.update({
        connection: err.code === "auth" ? "unauthorized" : "unavailable",
        session: null,
        message: err.message,
      });
    }
  }
  async send(action: Action): Promise<boolean> {
    if (this.closed || !canCommand(this.state, action, this.now()))
      return false;
    const status = this.state.status!,
      session = this.state.session!;
    const command: Command = {
      command_id: this.id(),
      expected_version: status.version,
      action,
      expires_at:
        status.server_time +
        Math.floor((this.now() - this.state.receivedAt!) / 1000) +
        30,
      expected_runtime_identity: status.runtime_identity,
      expected_policy_hash: status.policy_hash,
      reason:
        action === "OFF"
          ? "Owner requested OFF: prevent new execution; retain reconciliation."
          : "Owner requested pause entries: retain existing-position monitoring.",
    };
    const epoch = ++this.epoch;
    try {
      // Persist identity before transport. A storage error prevents the POST.
      this.pending({ command, acceptedVersion: null, uncertain: true });
      this.update({
        sending: action,
        message: "Sending control request. Worker state has not changed yet.",
      });
      const receipt = await this.transport.command(command, session.csrf_token);
      if (this.closed || epoch !== this.epoch) return true;
      if (
        receipt.command_id !== command.command_id ||
        !receipt.accepted ||
        receipt.version <= command.expected_version
      )
        throw new ControlError(
          "uncertain",
          "Command receipt could not be verified. Refresh to reconcile; nothing is retried automatically.",
        );
      this.pending({
        command,
        acceptedVersion: receipt.version,
        uncertain: false,
      });
      this.update({
        sending: null,
        message:
          "Request recorded. Waiting for the worker to acknowledge; not yet applied.",
      });
      await this.refresh();
      return true;
    } catch (e) {
      if (this.closed || epoch !== this.epoch) return true;
      const err =
        e instanceof ControlError
          ? e
          : new ControlError(
              "uncertain",
              "Request outcome is not confirmed. Refresh to reconcile; no automatic retry.",
            );
      if (["auth", "stale", "blocked"].includes(err.code)) {
        try {
          this.pending(null);
        } catch {
          /* The journal error remains visible and controls stay locked. */
        }
      }
      this.update({
        sending: null,
        message: err.message,
        connection:
          err.code === "auth"
            ? "unauthorized"
            : err.code === "uncertain"
              ? "unavailable"
              : this.state.connection,
        session: err.code === "auth" ? null : this.state.session,
      });
      if (err.code === "stale") await this.refresh();
      return false;
    }
  }
}
