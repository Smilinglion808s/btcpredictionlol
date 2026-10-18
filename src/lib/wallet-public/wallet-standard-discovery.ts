import { getWallets, type Wallets } from '@wallet-standard/app';
import type { Wallet } from '@wallet-standard/base';
import { StandardConnect, StandardEvents } from '@wallet-standard/features';
export type WalletStandardRegistry = Pick<Wallets, 'get' | 'on'>;
/** Deferred official registration handshake, not a provider connection or account request. */
export function getWalletStandardRegistry(): WalletStandardRegistry {
  const registry = getWallets();
  return Object.freeze({ get: () => registry.get(), on: registry.on.bind(registry) });
}
export interface DiscoveredWalletProvider {
  readonly id: string;
  readonly name: string;
  readonly eligible: boolean;
  readonly reason: 'PUBLIC_ACCOUNTS_PERMISSION_AVAILABLE' | 'UNSUPPORTED_STANDARD' | 'UNSUPPORTED_FEATURES' | 'INVALID_PROVIDER_METADATA';
}
/** Display/feature-version metadata only. No account, icon, unknown feature or method reads. */
export function inspectWalletStandardProvider(wallet: Wallet, id: string, fence: () => void = () => {}): DiscoveredWalletProvider {
  const read = (object: object, key: string): unknown => { fence(); const value: unknown = Reflect.get(object, key); fence(); return value; };
  let name = 'Unavailable wallet';
  try {
    if (!wallet || typeof wallet !== 'object') throw new Error('INVALID');
    const rawName = read(wallet, 'name');
    if (typeof rawName !== 'string' || rawName.length < 1 || rawName.length > 100 || unsafeName(rawName)) throw new Error('INVALID');
    name = rawName;
    if (read(wallet, 'version') !== '1.0.0') return Object.freeze({ id, name, eligible: false, reason: 'UNSUPPORTED_STANDARD' });
    const features = read(wallet, 'features');
    if (!features || typeof features !== 'object') throw new Error('INVALID');
    for (const key of [StandardConnect, StandardEvents]) {
      const feature = read(features, key);
      if (!feature || typeof feature !== 'object' || read(feature, 'version') !== '1.0.0') return Object.freeze({ id, name, eligible: false, reason: 'UNSUPPORTED_FEATURES' });
    }
    return Object.freeze({ id, name, eligible: true, reason: 'PUBLIC_ACCOUNTS_PERMISSION_AVAILABLE' });
  } catch { return Object.freeze({ id, name, eligible: false, reason: 'INVALID_PROVIDER_METADATA' }); }
}

function unsafeName(name: string): boolean { return Array.from(name).some(char => { const n = char.codePointAt(0)!; return n < 32 || (n >= 127 && n <= 159) || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069); }); }
