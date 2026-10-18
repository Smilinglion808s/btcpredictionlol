/** Local candidate boundary. All successful DTOs must come from a reviewed server transport. */
export const PUBLIC_ORIGIN = "https://btcpredictionlol.lovable.app";
export const PUBLIC_URI = "https://btcpredictionlol.lovable.app/";
export const STATEMENT =
  "Sign in to owner controls. This message does not authorize transactions, transfers, or trading.";
export const LIMITS = Object.freeze({
  challengeMs: 120_000,
  sessionMs: 600_000,
  clockSkewMs: 30_000,
  messageBytes: 2048,
});
export interface LoginConfig {
  readonly origin: string;
  readonly uri: string;
  readonly statement: typeof STATEMENT;
  readonly chainId: "solana:mainnet";
}
/** Deliberately not configured, even after user approval. Deployment binding is a separate reviewed change. */
export const DEFAULT_LOGIN_CONFIG: LoginConfig | null = null;
export interface SignInInput {
  readonly domain: string;
  readonly statement: string;
  readonly uri: string;
  readonly version: "1";
  readonly chainId: "solana:mainnet";
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expirationTime: string;
  readonly requestId: string;
}
export interface ChallengeDTO {
  readonly schema_version: 1;
  readonly server_time: number;
  readonly challenge_id: string;
  readonly expires_at: number;
  readonly csrf_token: string;
  readonly sign_in_input: SignInInput;
}
export interface VerifyRequest {
  readonly challenge_id: string;
  readonly account: {
    readonly address: string;
    readonly public_key_base64: string;
  };
  readonly signed_message_base64: string;
  readonly signature_base64: string;
  readonly signature_type: "ed25519";
}
export interface SessionDTO {
  readonly schema_version: 1;
  readonly server_time: number;
  readonly wallet_address: string;
  readonly session_id: string;
  readonly issued_at: number;
  readonly expires_at: number;
  readonly csrf_token: string;
  readonly owner_authenticated: true;
  readonly real_execution_enabled: false;
}
export interface BackendPort {
  createChallenge(): Promise<unknown>; // POST /api/wallet-auth/challenge body {}
  verifyProof(proof: VerifyRequest, csrfToken: string): Promise<unknown>; // POST /verify + X-CSRF-Token
  readSession(): Promise<unknown>; // GET /session; never renews expiry
  cancelChallenge(challengeId: string, csrfToken: string): Promise<unknown>; // POST /cancel body {challenge_id}
  logout(csrfToken: string): Promise<unknown>; // POST /logout body {}; revokes all owner's sessions/challenges
}
export class BoundaryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
/** Sanitized transport evidence only. It never carries response text, proof, or credentials. */
export class WalletAuthRemoteError extends BoundaryError {
  constructor(
    code: string,
    readonly httpStatus: number | null,
    readonly outcome: "denied" | "unavailable" | "uncertain",
  ) {
    super(code);
    this.name = "WalletAuthRemoteError";
  }
}
export function requireCondition(ok: unknown, code = "INVALID_DTO"): asserts ok {
  if (!ok) throw new BoundaryError(code);
}
/** Reject accessors/prototypes/extras at server DTO boundaries. No blind spreads or token-bearing response retention. */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireCondition(
    value !== null &&
      typeof value === "object" &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
  );
  const names = Object.getOwnPropertyNames(value);
  requireCondition(
    names.length === keys.length &&
      keys.every((key) => names.includes(key)) &&
      Object.getOwnPropertySymbols(value).length === 0,
  );
  const out: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    requireCondition(d && "value" in d);
    out[key] = d.value;
  }
  return out;
}
function text(value: unknown, max: number, regex?: RegExp): string {
  requireCondition(
    typeof value === "string" && value.length > 0 && value.length <= max && (!regex || regex.test(value)),
  );
  return value;
}
const SAFE_TEXT = /^[\x20-\x7e]+$/;
const HEX32 = /^[a-f0-9]{32}$/;
const HEX64 = /^[a-f0-9]{64}$/;
export function isoTime(value: unknown): number {
  const s = text(value, 24, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const n = Date.parse(s);
  requireCondition(Number.isFinite(n) && new Date(n).toISOString() === s, "INVALID_TIME");
  return n;
}
export function base58PublicKey(address: string): Uint8Array {
  requireCondition(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address), "INVALID_ADDRESS");
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of address) n = n * 58n + BigInt(alphabet.indexOf(c));
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.push(Number(n & 255n));
    n >>= 8n;
  }
  for (const c of address) {
    if (c !== "1") break;
    bytes.push(0);
  }
  requireCondition(bytes.length === 32, "INVALID_ADDRESS");
  return Uint8Array.from(bytes.reverse());
}
export function validateConfig(config: LoginConfig): LoginConfig {
  const dto = record(config, ["origin", "uri", "statement", "chainId"]);
  requireCondition(
    text(dto.origin, 256, SAFE_TEXT) === PUBLIC_ORIGIN &&
      text(dto.uri, 256, SAFE_TEXT) === PUBLIC_URI &&
      dto.statement === STATEMENT &&
      dto.chainId === "solana:mainnet",
    "INVALID_CONFIG",
  );
  return Object.freeze({
    origin: PUBLIC_ORIGIN,
    uri: PUBLIC_URI,
    statement: STATEMENT,
    chainId: "solana:mainnet",
  });
}
/** API envelope timestamps are integer Unix seconds; SIWS message times remain ISO UTC. */
export function unixTime(value: unknown): number {
  requireCondition(
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 253402300799,
    "INVALID_TIME",
  );
  return value * 1000;
}
export function messagePreview(
  input: SignInInput,
  address = "[Your wallet will insert and display its selected address]",
): string {
  return `${input.domain} wants you to sign in with your Solana account:\n${address}\n\n${input.statement}\n\nURI: ${input.uri}\nVersion: ${input.version}\nChain ID: ${input.chainId}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expirationTime}\nRequest ID: ${input.requestId}`;
}
export function parseChallenge(raw: unknown, config: LoginConfig, now: number, allowExpired = false): ChallengeDTO {
  validateConfig(config);
  const dto = record(raw, [
    "schema_version",
    "server_time",
    "challenge_id",
    "expires_at",
    "csrf_token",
    "sign_in_input",
  ]);
  requireCondition(dto.schema_version === 1);
  const server = unixTime(dto.server_time);
  const expiry = unixTime(dto.expires_at);
  const challengeId = text(dto.challenge_id, 32, HEX32);
  const csrf = text(dto.csrf_token, 64, HEX64);
  const input = record(dto.sign_in_input, [
    "domain",
    "statement",
    "uri",
    "version",
    "chainId",
    "nonce",
    "issuedAt",
    "expirationTime",
    "requestId",
  ]);
  for (const key of [
    "domain",
    "statement",
    "uri",
    "version",
    "chainId",
    "nonce",
    "issuedAt",
    "expirationTime",
    "requestId",
  ])
    text(input[key], key === "uri" ? 256 : 256, SAFE_TEXT);
  requireCondition(
    input.domain === new URL(config.origin).host &&
      input.uri === config.uri &&
      input.statement === config.statement &&
      input.version === "1" &&
      input.chainId === config.chainId,
    "CHALLENGE_MISMATCH",
  );
  const issued = isoTime(input.issuedAt);
  const inputExpiry = isoTime(input.expirationTime);
  requireCondition(
    input.requestId === challengeId && /^[A-Za-z0-9]{8,128}$/.test(input.nonce as string),
    "CHALLENGE_MISMATCH",
  );
  requireCondition(
    expiry === inputExpiry &&
      expiry > issued &&
      expiry - issued <= LIMITS.challengeMs &&
      server >= issued &&
      server < expiry,
    "INVALID_TIME",
  );
  if (!allowExpired)
    requireCondition(
      Math.abs(server - now) <= LIMITS.clockSkewMs && issued <= now + LIMITS.clockSkewMs,
      "STALE_CHALLENGE",
    );
  if (!allowExpired) requireCondition(now < expiry, "EXPIRED_CHALLENGE");
  const frozenInput = Object.freeze(input as unknown as SignInInput);
  requireCondition(
    new TextEncoder().encode(messagePreview(frozenInput)).length <= LIMITS.messageBytes,
    "MESSAGE_TOO_LONG",
  );
  return Object.freeze({
    schema_version: 1,
    server_time: dto.server_time as number,
    challenge_id: challengeId,
    expires_at: dto.expires_at as number,
    csrf_token: csrf,
    sign_in_input: frozenInput,
  });
}
export function parseSession(raw: unknown, config: LoginConfig, now: number): SessionDTO {
  validateConfig(config);
  const dto = record(raw, [
    "schema_version",
    "server_time",
    "wallet_address",
    "session_id",
    "issued_at",
    "expires_at",
    "csrf_token",
    "owner_authenticated",
    "real_execution_enabled",
  ]);
  requireCondition(
    dto.schema_version === 1 && dto.owner_authenticated === true && dto.real_execution_enabled === false,
    "INVALID_SESSION",
  );
  base58PublicKey(text(dto.wallet_address, 44));
  text(dto.session_id, 32, HEX32);
  text(dto.csrf_token, 64, HEX64);
  const server = unixTime(dto.server_time);
  const issued = unixTime(dto.issued_at);
  const expiry = unixTime(dto.expires_at);
  requireCondition(
    Math.abs(server - now) <= LIMITS.clockSkewMs &&
      issued <= server &&
      expiry > server &&
      expiry > now &&
      expiry > issued &&
      expiry - issued <= LIMITS.sessionMs,
    "EXPIRED_SESSION",
  );
  return Object.freeze(dto as unknown as SessionDTO);
}
export function parseAcknowledgment(raw: unknown, kind: "canceled" | "logged_out", now: number): void {
  const dto = record(raw, ["schema_version", "server_time", kind]);
  requireCondition(
    dto.schema_version === 1 && dto[kind] === true && Math.abs(unixTime(dto.server_time) - now) <= LIMITS.clockSkewMs,
    "INVALID_ACKNOWLEDGMENT",
  );
}
export function sameSession(a: SessionDTO, b: SessionDTO): boolean {
  return (
    a.session_id === b.session_id &&
    a.wallet_address === b.wallet_address &&
    a.issued_at === b.issued_at &&
    a.expires_at === b.expires_at
  );
}

/** Read-only local assembly evidence. This contract never grants execution authority. */
export const READINESS_PATH = "/api/control/readiness";
export const CAPABILITIES = [
  "sign",
  "broadcast",
  "simulate",
  "enqueue",
  "reserve",
  "retry",
  "release",
  "issue_grant",
] as const;
export const COMPONENTS = [
  { id: "owner_auth", state: "VERIFIED_LOCAL", revision: "wallet-siws-offonly-v1" },
  { id: "control_state", state: "OBSERVED_LOCAL", revision: "control-status-v1" },
  { id: "market_data", state: "UNCONFIGURED", revision: null },
  { id: "execution_worker", state: "UNCONFIGURED", revision: null },
  { id: "signer", state: "UNCONFIGURED", revision: null },
  { id: "live_risk", state: "UNCONFIGURED", revision: null },
  { id: "automation_authority", state: "UNCONFIGURED", revision: null },
] as const;
export const REQUIRED_BLOCKERS = [
  "EXECUTION_HARD_OFF",
  "MARKET_DATA_UNCONFIGURED",
  "LIVE_WORKER_UNCONFIGURED",
  "SIGNER_UNCONFIGURED",
  "LIVE_RISK_UNCONFIGURED",
  "AUTOMATION_AUTHORITY_UNCONFIGURED",
] as const;
const CONDITIONAL_BLOCKERS = {
  HALT_LATCHED: "halted",
  RECONCILIATION_REQUIRED: "reconciliation_required",
  WORKER_STALE_OR_ABSENT: "worker_stale",
  WORKER_ACK_PENDING: "pending_ack",
} as const;
export interface ReadinessDTO {
  readonly schema_version: 1;
  readonly stage: "UNPROVISIONED_OBSERVE";
  readonly execution: "OFF";
  readonly checked_at: number;
  readonly session_expires_at: number;
  readonly capabilities: Readonly<Record<(typeof CAPABILITIES)[number], false>>;
  readonly control: {
    readonly version: number;
    readonly acknowledged_version: number | null;
    readonly worker_epoch: number;
    readonly fence: number;
    readonly halted: boolean;
    readonly reconciliation_required: boolean;
    readonly reconciliation_as_of: number | null;
    readonly worker_stale: boolean;
    readonly pending_ack: boolean;
  };
  readonly components: typeof COMPONENTS;
  readonly blockers: readonly string[];
  readonly provenance: {
    readonly scope: "LOCAL_ASSEMBLY_ONLY";
    readonly chain_data: false;
    readonly revision: "owner-readiness-v1";
  };
}
export class ReadinessError extends Error {
  constructor(readonly kind: "invalid" | "auth" | "unavailable") {
    super(kind);
  }
}
function readinessRequireValid(ok: unknown): asserts ok {
  if (!ok) throw new ReadinessError("invalid");
}
function readinessRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  readinessRequireValid(
    value !== null &&
      typeof value === "object" &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
  );
  const names = Reflect.ownKeys(value);
  readinessRequireValid(names.length === keys.length && keys.every((key) => names.includes(key)));
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    readinessRequireValid(descriptor && "value" in descriptor);
    result[key] = descriptor.value;
  }
  return result;
}
function readinessArray(value: unknown, min: number, max = min): unknown[] {
  readinessRequireValid(
    Array.isArray(value) &&
      value.length >= min &&
      value.length <= max &&
      Object.getPrototypeOf(value) === Array.prototype &&
      Reflect.ownKeys(value).length === value.length + 1,
  );
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    readinessRequireValid(descriptor && "value" in descriptor);
    result.push(descriptor.value);
  }
  return result;
}
function readinessInteger(value: unknown, minimum = 0): number {
  readinessRequireValid(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum);
  return value;
}
function readinessBoolean(value: unknown): boolean {
  readinessRequireValid(typeof value === "boolean");
  return value;
}
export function parseReadiness(value: unknown, now = Date.now()): ReadinessDTO {
  const dto = readinessRecord(value, [
    "schema_version",
    "stage",
    "execution",
    "checked_at",
    "session_expires_at",
    "capabilities",
    "control",
    "components",
    "blockers",
    "provenance",
  ]);
  readinessRequireValid(dto.schema_version === 1 && dto.stage === "UNPROVISIONED_OBSERVE" && dto.execution === "OFF");
  const checked = readinessInteger(dto.checked_at),
    expiry = readinessInteger(dto.session_expires_at);
  readinessRequireValid(
    Number.isFinite(now) &&
      Math.abs(checked * 1000 - now) <= 30_000 &&
      expiry > checked &&
      expiry - checked <= 600 &&
      expiry * 1000 > now,
  );
  const caps = readinessRecord(dto.capabilities, CAPABILITIES);
  readinessRequireValid(CAPABILITIES.every((key) => caps[key] === false));
  const raw = readinessRecord(dto.control, [
    "version",
    "acknowledged_version",
    "worker_epoch",
    "fence",
    "halted",
    "reconciliation_required",
    "reconciliation_as_of",
    "worker_stale",
    "pending_ack",
  ]);
  const control = Object.freeze({
    version: readinessInteger(raw.version),
    acknowledged_version: raw.acknowledged_version === null ? null : readinessInteger(raw.acknowledged_version),
    worker_epoch: readinessInteger(raw.worker_epoch),
    fence: readinessInteger(raw.fence),
    halted: readinessBoolean(raw.halted),
    reconciliation_required: readinessBoolean(raw.reconciliation_required),
    reconciliation_as_of: raw.reconciliation_as_of === null ? null : readinessInteger(raw.reconciliation_as_of),
    worker_stale: readinessBoolean(raw.worker_stale),
    pending_ack: readinessBoolean(raw.pending_ack),
  });
  readinessRequireValid(
    (control.acknowledged_version === null || control.acknowledged_version <= control.version) &&
      control.pending_ack === (control.acknowledged_version !== control.version) &&
      (control.reconciliation_as_of === null || control.reconciliation_as_of <= checked),
  );
  readinessArray(dto.components, COMPONENTS.length).forEach((value, index) => {
    const component = readinessRecord(value, ["id", "state", "revision"]),
      expected = COMPONENTS[index];
    readinessRequireValid(
      component.id === expected.id && component.state === expected.state && component.revision === expected.revision,
    );
  });
  const blockers = readinessArray(dto.blockers, REQUIRED_BLOCKERS.length, REQUIRED_BLOCKERS.length + 4);
  const expected: string[] = [
    ...REQUIRED_BLOCKERS,
    ...Object.entries(CONDITIONAL_BLOCKERS)
      .filter(([, flag]) => control[flag])
      .map(([code]) => code),
  ];
  readinessRequireValid(
    blockers.length === expected.length &&
      new Set(blockers).size === blockers.length &&
      blockers.every((code) => typeof code === "string" && expected.includes(code)),
  );
  const provenance = readinessRecord(dto.provenance, ["scope", "chain_data", "revision"]);
  readinessRequireValid(
    provenance.scope === "LOCAL_ASSEMBLY_ONLY" &&
      provenance.chain_data === false &&
      provenance.revision === "owner-readiness-v1",
  );
  return Object.freeze({
    schema_version: 1,
    stage: "UNPROVISIONED_OBSERVE",
    execution: "OFF",
    checked_at: checked,
    session_expires_at: expiry,
    capabilities: Object.freeze(
      Object.fromEntries(CAPABILITIES.map((key) => [key, false])),
    ) as ReadinessDTO["capabilities"],
    control,
    components: Object.freeze(
      COMPONENTS.map((component) => Object.freeze({ ...component })),
    ) as unknown as typeof COMPONENTS,
    blockers: Object.freeze([...blockers]) as readonly string[],
    provenance: Object.freeze({
      scope: "LOCAL_ASSEMBLY_ONLY",
      chain_data: false,
      revision: "owner-readiness-v1",
    }),
  });
}
