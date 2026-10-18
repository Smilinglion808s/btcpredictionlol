import {
  base58PublicKey,
  BoundaryError,
  LIMITS,
  messagePreview,
  requireCondition,
  type ChallengeDTO,
  type SignInInput,
  type VerifyRequest,
} from "./contract";
/** Structural projection of official Wallet Standard SIWS interfaces. No discovery or global provider is installed. */
export interface StandardWalletCandidate {
  readonly name: unknown;
  readonly version: unknown;
  readonly features: unknown;
}
export type Fence = () => void;
export interface WalletChoice {
  readonly id: string;
  readonly name: string;
  readonly compatible: boolean;
}
export interface SiwsAdapter {
  readonly choice: WalletChoice;
  signIn(input: SignInInput, fence: Fence): Promise<unknown>;
  observeAccounts(
    listener: (accounts: unknown) => void,
    fence: Fence,
    capabilitiesChanged: () => void,
  ): () => void;
}
const read = (object: object, key: string, fence: Fence): unknown => {
  fence();
  const value = Reflect.get(object, key);
  fence();
  return value;
};
const object = (value: unknown): value is object =>
  value !== null && typeof value === "object";
export function inspectWallet(
  wallet: StandardWalletCandidate,
  id: string,
  fence: Fence,
): WalletChoice {
  let name = "Unavailable wallet";
  try {
    const n = read(wallet, "name", fence);
    requireCondition(
      typeof n === "string" &&
        n.length > 0 &&
        n.length <= 64 &&
        /^[\x20-\x7e]+$/.test(n),
    );
    name = n;
    requireCondition(read(wallet, "version", fence) === "1.0.0");
    const features = read(wallet, "features", fence);
    requireCondition(object(features));
    const signIn = read(features, "solana:signIn", fence);
    const events = read(features, "standard:events", fence);
    requireCondition(object(signIn) && object(events));
    const version = read(signIn, "version", fence);
    requireCondition(
      (version === "1.0.0" || version === "1.1.0") &&
        read(events, "version", fence) === "1.0.0",
    );
    return Object.freeze({ id, name, compatible: true });
  } catch {
    fence();
    return Object.freeze({ id, name, compatible: false });
  }
}
export function createSiwsAdapter(
  wallet: StandardWalletCandidate,
  choice: WalletChoice,
): SiwsAdapter {
  return Object.freeze({
    choice,
    async signIn(input: SignInInput, fence: Fence): Promise<unknown> {
      // Read ONLY solana:signIn. No generic signMessage, connect, signing/send transaction features, or RPC.
      const features = read(wallet, "features", fence);
      requireCondition(object(features));
      const feature = read(features, "solana:signIn", fence);
      requireCondition(object(feature));
      const version = read(feature, "version", fence);
      requireCondition(version === "1.0.0" || version === "1.1.0");
      const method = read(feature, "signIn", fence);
      requireCondition(typeof method === "function");
      fence();
      return Reflect.apply(method, feature, [input]);
    },
    observeAccounts(
      listener: (accounts: unknown) => void,
      fence: Fence,
      capabilitiesChanged: () => void,
    ): () => void {
      const features = read(wallet, "features", fence);
      requireCondition(object(features));
      const feature = read(features, "standard:events", fence);
      requireCondition(object(feature));
      requireCondition(read(feature, "version", fence) === "1.0.0");
      const on = read(feature, "on", fence);
      requireCondition(typeof on === "function");
      fence();
      const off: unknown = Reflect.apply(on, feature, [
        "change",
        (change: unknown) => {
          if (object(change) && "features" in change) {
            capabilitiesChanged();
            return;
          }
          if (object(change) && "accounts" in change) {
            try {
              listener(Reflect.get(change, "accounts"));
            } catch {
              listener(null);
            }
          }
        },
      ]);
      try {
        fence();
      } catch (error) {
        if (typeof off === "function") {
          try {
            Reflect.apply(off, undefined, []);
          } catch {
            /* Listener cleanup only. */
          }
        }
        throw error;
      }
      requireCondition(typeof off === "function");
      return () => {
        try {
          Reflect.apply(off, undefined, []);
        } catch {
          /* Local listener removal only. */
        }
      };
    },
  });
}
export function accountEventAddress(accounts: unknown): string | null {
  if (!Array.isArray(accounts) || accounts.length !== 1) return null;
  try {
    const account = accounts[0];
    if (!object(account)) return null;
    const address = Reflect.get(account, "address");
    if (typeof address !== "string") return null;
    return equalBytes(
      copyBytes(Reflect.get(account, "publicKey"), 32, 32),
      base58PublicKey(address),
    )
      ? address
      : null;
  } catch {
    return null;
  }
}
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayTag = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)!.get!;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)!.get!;
function copyBytes(raw: unknown, min: number, max: number): Uint8Array {
  // Intrinsic brand/length checks allow genuine cross-realm Uint8Arrays, reject proxies,
  // and never evaluate provider-defined getters or iterators on the byte view.
  requireCondition(
    ArrayBuffer.isView(raw) &&
      Reflect.apply(typedArrayTag, raw, []) === "Uint8Array",
    "INVALID_BYTES",
  );
  const length: number = Reflect.apply(typedArrayByteLength, raw, []);
  requireCondition(length >= min && length <= max, "INVALID_BYTES");
  return new Uint8Array(raw as Uint8Array);
}
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
/** Bounds/snapshots provider data. This is NOT signature verification or authorization. Server must verify every byte. */
export function snapshotProof(
  raw: unknown,
  challenge: ChallengeDTO,
  fence: Fence,
): VerifyRequest {
  requireCondition(Array.isArray(raw) && raw.length === 1, "INVALID_PROOF");
  fence();
  const output: unknown = raw[0];
  requireCondition(object(output));
  const account = read(output, "account", fence);
  requireCondition(object(account));
  const address = read(account, "address", fence);
  requireCondition(typeof address === "string", "ACCOUNT_MISMATCH");
  const publicKey = copyBytes(read(account, "publicKey", fence), 32, 32);
  requireCondition(
    equalBytes(publicKey, base58PublicKey(address as string)),
    "ACCOUNT_MISMATCH",
  );
  const signatureType = read(output, "signatureType", fence);
  requireCondition(
    signatureType === undefined || signatureType === "ed25519",
    "INVALID_PROOF",
  );
  requireCondition(
    read(output, "signedMessageFormat", fence) === undefined,
    "UNSUPPORTED_MESSAGE_FORMAT",
  );
  const signedMessage = copyBytes(
    read(output, "signedMessage", fence),
    1,
    LIMITS.messageBytes,
  );
  const signature = copyBytes(read(output, "signature", fence), 64, 64);
  requireCondition(
    equalBytes(
      signedMessage,
      new TextEncoder().encode(
        messagePreview(challenge.sign_in_input, address),
      ),
    ),
    "MESSAGE_MISMATCH",
  );
  fence();
  return Object.freeze({
    challenge_id: challenge.challenge_id,
    account: Object.freeze({
      address: address as string,
      public_key_base64: toBase64(publicKey),
    }),
    signed_message_base64: toBase64(signedMessage),
    signature_base64: toBase64(signature),
    signature_type: "ed25519",
  });
}
export function isRejected(error: unknown): boolean {
  try {
    return object(error) && Reflect.get(error, "code") === 4001;
  } catch {
    return false;
  }
}
export function safeError(error: unknown): string {
  return error instanceof BoundaryError ? error.code : "UNEXPECTED_OUTCOME";
}
