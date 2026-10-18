import { OwnerRequestError } from "../owner-auth/owner-request-contract";
/** Display/public-account gate only. Never a replacement for server command authorization. */
export const SESSION_POLICY = "app-session-jwt-age300-v1" as const;
export type OwnerEvidenceReader = () => Promise<unknown>;
export type OwnerPhase = "unknown" | "checking" | "current" | "expired" | "unavailable" | "revoked" | "closed";
export type OwnerInvalidation = "session_changed" | "signed_out" | "navigation" | "revoked";
export type OwnerAccessIssue =
  "enrollment_required" | "sign_in_required" | "revoked" | "forbidden" | "service_unavailable" | "unverified";
export interface OwnerView {
  readonly phase: OwnerPhase;
  readonly generation: number;
  readonly validUntil: number | null;
  readonly issue?: OwnerAccessIssue;
}
/** Sanitized denial guidance only, never authorization or proof of the user's cause. */
class EvidenceReadError extends Error {
  constructor(readonly issue: OwnerAccessIssue) {
    super("OWNER_EVIDENCE_UNAVAILABLE");
  }
}
function safeIssue(error: unknown): OwnerAccessIssue {
  try {
    if (!(error instanceof OwnerRequestError) || Object.getPrototypeOf(error) !== OwnerRequestError.prototype)
      return "unverified";
    const fields = Object.getOwnPropertyDescriptors(error);
    for (const key of ["code", "outcome", "status"])
      if (!fields[key] || !Object.hasOwn(fields[key], "value")) return "unverified";
    const code = fields.code.value,
      outcome = fields.outcome.value,
      status = fields.status.value;
    if (
      typeof code !== "string" ||
      typeof outcome !== "string" ||
      !["not_sent", "rejected", "uncertain"].includes(outcome) ||
      (status !== null && !Number.isInteger(status))
    )
      return "unverified";
    if (outcome === "rejected" && status === 403) {
      if (code === "APP_SESSION_ENROLL_REQUIRED") return "enrollment_required";
      if (code === "APP_SESSION_REVOKED") return "revoked";
      if (code === "OWNER_FORBIDDEN") return "forbidden";
    }
    if (
      (code === "AUTH_REQUIRED" || code === "TOKEN_TOO_OLD") &&
      ((outcome === "not_sent" && status === null) || (outcome === "rejected" && status === 401))
    )
      return "sign_in_required";
    if (
      [
        "UNCONFIGURED",
        "ORIGIN_FORBIDDEN",
        "REGISTRY_UNAVAILABLE",
        "CONTROL_SERVICE_UNAVAILABLE",
        "CONTROL_SERVICE_UNCONFIGURED",
        "TIMEOUT",
        "CLOSED",
      ].includes(code)
    )
      return "service_unavailable";
  } catch {
    /* Unknown objects and accessors never supply UI instructions. */
  }
  return "unverified";
}
export interface OwnerProjection {
  snapshot(): OwnerView;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<OwnerView>;
  invalidate(reason?: OwnerInvalidation): OwnerView;
  close(): void;
}
export interface EvidenceAdapter {
  readonly available: boolean;
  readonly ownerApiAvailable?: boolean;
  transact<T>(
    work: (lease: { ownerRequest?: (request: { kind: "session-evidence" }) => Promise<unknown> }) => Promise<T>,
  ): Promise<T>;
}
/** Existing adapter owns bearer transport and current-provider/session verification. No token escapes. */
export function ownerEvidenceReader(adapter: EvidenceAdapter): OwnerEvidenceReader {
  return async () => {
    try {
      if (adapter.available !== true || adapter.ownerApiAvailable !== true)
        throw new OwnerRequestError("UNCONFIGURED", "not_sent");
      return await adapter.transact(async (lease) => {
        if (typeof lease.ownerRequest !== "function") throw new OwnerRequestError("UNCONFIGURED", "not_sent");
        return lease.ownerRequest({ kind: "session-evidence" });
      });
    } catch (error) {
      throw new EvidenceReadError(safeIssue(error));
    }
  };
}
const KEYS = [
  "schema_version",
  "subject",
  "session_id",
  "active",
  "observed_at",
  "valid_until",
  "policy_revision",
  "aal",
  "token_iat",
  "token_exp",
].sort();
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
function parseEvidence(input: unknown, now: number): { binding: string; deadline: number } {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new Error("EVIDENCE");
  const d = Object.getOwnPropertyDescriptors(input);
  if (
    Reflect.ownKeys(input).length !== KEYS.length ||
    Object.keys(d).sort().join("|") !== KEYS.join("|") ||
    Object.values(d).some((p) => !Object.hasOwn(p, "value"))
  )
    throw new Error("EVIDENCE");
  const v = Object.fromEntries(Object.entries(d).map(([k, p]) => [k, p.value]));
  if (
    v.schema_version !== 1 ||
    v.active !== true ||
    !uuid(v.subject) ||
    !uuid(v.session_id) ||
    v.policy_revision !== SESSION_POLICY ||
    !["aal1", "aal2"].includes(v.aal) ||
    !integer(v.observed_at) ||
    !integer(v.valid_until) ||
    !integer(v.token_iat) ||
    !integer(v.token_exp) ||
    v.token_iat > now ||
    v.token_exp <= now ||
    v.token_iat >= v.token_exp ||
    v.observed_at > now + 2 ||
    v.observed_at < now - 10 ||
    v.valid_until !== Math.min(v.token_exp, v.token_iat + 300) ||
    v.valid_until <= now ||
    v.valid_until <= v.observed_at
  )
    throw new Error("EVIDENCE");
  // Use the existing server policy deadline, not an arbitrary UI timeout. Remote revocation can still occur between reads.
  return { binding: v.subject + "/" + v.session_id, deadline: v.valid_until };
}
export function createOwnerProjection(
  reader: OwnerEvidenceReader,
  options: { nowMs?: () => number; timeoutMs?: number } = {},
): OwnerProjection {
  const nowMs = options.nowMs ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error("Invalid timeout");
  let phase: OwnerPhase = "unknown",
    generation = 0,
    epoch = 0,
    closed = false,
    binding: string | null = null,
    deadline: number | null = null,
    lastMs: number | null = null;
  let issue: OwnerAccessIssue | undefined;
  let active: Promise<OwnerView> | null = null,
    refreshing = false,
    clockFailed = false;
  const listeners = new Set<() => void>();
  const view = (): OwnerView =>
    Object.freeze({
      phase,
      generation,
      validUntil: phase === "current" ? deadline : null,
      ...(issue ? { issue } : {}),
    });
  const emit = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* A broken view cannot restore evidence. */
      }
    }
  };
  function clear(next: OwnerPhase, why?: OwnerAccessIssue) {
    epoch++;
    generation++;
    phase = next;
    issue = next === "unavailable" ? (why ?? "unverified") : undefined;
    binding = null;
    deadline = null;
    emit();
  }
  function time(): number | null {
    if (clockFailed) return null;
    let n: number;
    try {
      n = nowMs();
    } catch {
      clockFailed = true;
      if (!closed) clear("unavailable");
      return null;
    }
    if (!Number.isSafeInteger(n) || n < 0 || (lastMs !== null && n < lastMs)) {
      clockFailed = true;
      if (!closed) clear("unavailable");
      return null;
    }
    lastMs = n;
    return Math.floor(n / 1000);
  }
  function expire(): void {
    if (closed) return;
    const n = time();
    if (n !== null && deadline !== null && n >= deadline) clear("expired");
  }
  const api: OwnerProjection = {
    snapshot() {
      expire();
      return view();
    },
    subscribe(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      expire();
      return () => listeners.delete(listener);
    },
    refresh() {
      if (closed) return Promise.resolve(view());
      const before = epoch;
      const shouldExpire = deadline !== null;
      expire();
      // Expiry emits synchronously; a subscriber may revoke or close during that notification.
      if (closed || (epoch !== before && !(shouldExpire && phase === "expired" && epoch === before + 1)))
        return Promise.resolve(view());
      if (active) return active;
      if (refreshing || clockFailed) return Promise.resolve(view());
      refreshing = true;
      const ticket = ++epoch;
      phase = "checking";
      issue = undefined;
      emit();
      if (closed || ticket !== epoch) {
        refreshing = false;
        return Promise.resolve(view());
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = (async () => {
        try {
          const result = await Promise.race([
            Promise.resolve().then(() => {
              if (closed || ticket !== epoch) throw new Error("STALE");
              return reader();
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new EvidenceReadError("service_unavailable")), timeoutMs);
            }),
          ]);
          if (closed || ticket !== epoch) return view();
          const n = time();
          if (n === null || closed || ticket !== epoch) return view();
          // Preserve the old deadline during checking so an expired binding cannot be renewed silently.
          if (deadline !== null && n >= deadline) {
            clear("expired");
            return view();
          }
          const parsed = parseEvidence(result, n);
          if (closed || ticket !== epoch) return view();
          if (binding !== parsed.binding) generation++;
          binding = parsed.binding;
          deadline = parsed.deadline;
          phase = "current";
          issue = undefined;
          emit();
          return view();
        } catch (error) {
          if (!closed && ticket === epoch)
            clear("unavailable", error instanceof EvidenceReadError ? error.issue : "unverified");
          return view();
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      })();
      active = work;
      void work.finally(() => {
        if (active === work) {
          active = null;
          refreshing = false;
        }
      });
      return work;
    },
    invalidate(reason = "session_changed") {
      if (!closed) clear(reason === "revoked" ? "revoked" : "unknown");
      return view();
    },
    close() {
      if (closed) return;
      closed = true;
      clear("closed");
      listeners.clear();
    },
  };
  return api;
}
