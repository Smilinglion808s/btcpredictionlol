/** Rebuilt v3: public data copying only, never an authority or wallet-operation adapter. */
export type SolanaChain = 'solana:mainnet' | 'solana:devnet' | 'solana:testnet';
export interface PublicAccountData {
  readonly address: string;
  readonly publicKey: readonly number[];
  readonly chains: readonly string[];
  readonly features: readonly string[];
}
export interface PublicFeatureData {
  readonly version: string;
  readonly supportedTransactionVersions?: readonly ('legacy' | 0 | 1)[];
}
export interface PublicWalletData {
  readonly standardVersion: '1.0.0';
  readonly name: string;
  readonly chains: readonly string[];
  readonly features: Readonly<Record<string, PublicFeatureData>>;
  readonly accounts: readonly PublicAccountData[];
}
export interface PublicWalletReader {
  readonly version: string;
  readonly name: string;
  readonly chains: readonly string[];
  readonly features: Readonly<Record<string, unknown>>;
  readonly accounts: readonly unknown[];
}
export type Fence = () => void;
const noFence: Fence = () => {};
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const TX = 'solana:signTransaction', SEND = 'solana:signAndSendTransaction';
const KNOWN = new Set(['standard:connect', 'standard:disconnect', 'standard:events', TX, SEND, 'solana:signMessage']);
function need(value: unknown): asserts value { if (!value) throw new Error('INVALID_PUBLIC_WALLET_DATA'); }
function checked<T>(fence: Fence, work: () => T): T { fence(); const result = work(); fence(); return result; }
function object(value: unknown): object { need(value !== null && typeof value === 'object' && !Array.isArray(value)); return value; }
function read(value: object, key: string, fence: Fence): unknown { return checked(fence, () => Reflect.get(value, key) as unknown); }
function array(value: unknown, max: number, fence: Fence): unknown[] {
  need(Array.isArray(value) && checked(fence, () => Object.getPrototypeOf(value)) === Array.prototype);
  const descriptors = checked(fence, () => Object.getOwnPropertyDescriptors(value)) as Record<string, PropertyDescriptor>;
  const length: unknown = descriptors.length?.value;
  need(Number.isSafeInteger(length) && typeof length === 'number' && length >= 0 && length <= max && Reflect.ownKeys(descriptors).length === length + 1);
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) { const d = descriptors[String(i)]; need(d && Object.hasOwn(d, 'value')); result.push(d.value); }
  return result;
}
function identifiers(value: unknown, max: number, fence: Fence): string[] {
  const result = array(value, max, fence);
  need(result.every(v => typeof v === 'string' && v.length <= 100 && /^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)) && new Set(result).size === result.length);
  return (result as string[]).sort();
}
function publicKey(value: unknown, fence: Fence): number[] {
  need(ArrayBuffer.isView(value) && checked(fence, () => Object.getPrototypeOf(value)) === Uint8Array.prototype);
  const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer')?.get;
  need(getter);
  const buffer: unknown = checked(fence, () => getter.call(value));
  need(buffer instanceof ArrayBuffer && checked(fence, () => Object.getPrototypeOf(buffer)) === ArrayBuffer.prototype);
  const descriptors = checked(fence, () => Object.getOwnPropertyDescriptors(value));
  need(Reflect.ownKeys(descriptors).length === 32);
  return Array.from({ length: 32 }, (_, i) => { const byte: unknown = descriptors[String(i)]?.value; need(typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255); return byte; });
}
function addressOf(bytes: readonly number[]): string {
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let result = '';
  while (number > 0n) { result = BASE58[Number(number % 58n)] + result; number /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = '1' + result; }
  return result;
}
function features(value: unknown, fence: Fence): { names: readonly string[]; data: PublicWalletData['features'] } {
  const input = object(value), proto = checked(fence, () => Object.getPrototypeOf(input));
  need(proto === Object.prototype || proto === null);
  const names = identifiers(checked(fence, () => Reflect.ownKeys(input)), 32, fence);
  const data: Record<string, PublicFeatureData> = Object.create(null);
  for (const name of names) {
    if (!KNOWN.has(name)) continue; // Do not read unknown feature payloads.
    const feature = object(read(input, name, fence)), version = read(feature, 'version', fence);
    need(typeof version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version));
    if (name === TX || name === SEND) {
      const versions = array(read(feature, 'supportedTransactionVersions', fence), 3, fence);
      need(versions.length > 0 && versions.every(v => v === 'legacy' || v === 0 || v === 1) && new Set(versions).size === versions.length);
      data[name] = Object.freeze({ version, supportedTransactionVersions: Object.freeze(versions as ('legacy' | 0 | 1)[]) });
    } else data[name] = Object.freeze({ version });
  }
  return { names, data: Object.freeze(data) };
}
function accounts(value: unknown, chains: readonly string[], featureNames: readonly string[], fence: Fence): readonly PublicAccountData[] {
  const result = array(value, 16, fence).map(raw => {
    const account = object(raw), address = read(account, 'address', fence);
    need(typeof address === 'string' && address.length >= 32 && address.length <= 44);
    const bytes = publicKey(read(account, 'publicKey', fence), fence);
    need(address === addressOf(bytes));
    const accountChains = identifiers(read(account, 'chains', fence), 16, fence), accountFeatures = identifiers(read(account, 'features', fence), 32, fence);
    need(accountChains.every(chain => chains.includes(chain)) && accountFeatures.every(feature => featureNames.includes(feature)));
    return Object.freeze({ address, publicKey: Object.freeze(bytes), chains: Object.freeze(accountChains), features: Object.freeze(accountFeatures.filter(name => KNOWN.has(name))) });
  });
  need(new Set(result.map(account => account.address)).size === result.length);
  return Object.freeze(result);
}
/** Getter-aware copying of documented PUBLIC properties. Provider getters remain trusted code.
 * A caller-supplied fence runs around every provider property read/descriptor operation.
 * The optional returned accounts are normalized with the same freshly captured wallet metadata.
 */
export function capturePublicWallet(wallet: PublicWalletReader, fence: Fence = noFence, returnedAccounts?: { readonly value: unknown }): { readonly wallet: PublicWalletData; readonly returnedAccounts: readonly PublicAccountData[] | null } {
  try {
    const input = object(wallet), version = read(input, 'version', fence), name = read(input, 'name', fence);
    need(version === '1.0.0' && typeof name === 'string' && name.length > 0 && name.length <= 100 && !unsafeName(name));
    const chains = identifiers(read(input, 'chains', fence), 16, fence), capturedFeatures = features(read(input, 'features', fence), fence);
    const capturedAccounts = accounts(read(input, 'accounts', fence), chains, capturedFeatures.names, fence);
    const returned = returnedAccounts ? accounts(returnedAccounts.value, chains, capturedFeatures.names, fence) : null;
    fence();
    return Object.freeze({ wallet: Object.freeze({ standardVersion: version, name, chains: Object.freeze(chains), features: capturedFeatures.data, accounts: capturedAccounts }), returnedAccounts: returned });
  } catch { throw new Error('INVALID_PUBLIC_WALLET_DATA'); }
}
export function samePublicAccounts(a: readonly PublicAccountData[], b: readonly PublicAccountData[]): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export function samePublicWallet(a: PublicWalletData, b: PublicWalletData): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function unsafeName(name: string): boolean { return Array.from(name).some(char => { const n = char.codePointAt(0)!; return n < 32 || (n >= 127 && n <= 159) || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069); }); }
