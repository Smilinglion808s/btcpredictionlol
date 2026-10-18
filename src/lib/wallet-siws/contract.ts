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
export function requireCondition(
  ok: unknown,
  code = "INVALID_DTO",
): asserts ok {
  if (!ok) throw new BoundaryError(code);
}
/** Reject accessors/prototypes/extras at server DTO boundaries. No blind spreads or token-bearing response retention. */
function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  requireCondition(
    value !== null &&
      typeof value === "object" &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null),
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
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= max &&
      (!regex || regex.test(value)),
  );
  return value;
}
const SAFE_TEXT = /^[\x20-\x7e]+$/;
const HEX32 = /^[a-f0-9]{32}$/;
const HEX64 = /^[a-f0-9]{64}$/;
export function isoTime(value: unknown): number {
  const s = text(value, 24, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const n = Date.parse(s);
  requireCondition(
    Number.isFinite(n) && new Date(n).toISOString() === s,
    "INVALID_TIME",
  );
  return n;
}
export function base58PublicKey(address: string): Uint8Array {
  requireCondition(
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address),
    "INVALID_ADDRESS",
  );
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
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value > 0 &&
      value <= 253402300799,
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
export function parseChallenge(
  raw: unknown,
  config: LoginConfig,
  now: number,
  allowExpired = false,
): ChallengeDTO {
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
    input.requestId === challengeId &&
      /^[A-Za-z0-9]{8,128}$/.test(input.nonce as string),
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
      Math.abs(server - now) <= LIMITS.clockSkewMs &&
        issued <= now + LIMITS.clockSkewMs,
      "STALE_CHALLENGE",
    );
  if (!allowExpired) requireCondition(now < expiry, "EXPIRED_CHALLENGE");
  const frozenInput = Object.freeze(input as unknown as SignInInput);
  requireCondition(
    new TextEncoder().encode(messagePreview(frozenInput)).length <=
      LIMITS.messageBytes,
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
export function parseSession(
  raw: unknown,
  config: LoginConfig,
  now: number,
): SessionDTO {
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
    dto.schema_version === 1 &&
      dto.owner_authenticated === true &&
      dto.real_execution_enabled === false,
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
export function parseAcknowledgment(
  raw: unknown,
  kind: "canceled" | "logged_out",
  now: number,
): void {
  const dto = record(raw, ["schema_version", "server_time", kind]);
  requireCondition(
    dto.schema_version === 1 &&
      dto[kind] === true &&
      Math.abs(unixTime(dto.server_time) - now) <= LIMITS.clockSkewMs,
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
