import type { Wallet } from '@wallet-standard/base';
import { StandardConnect, StandardEvents, type StandardConnectMethod } from '@wallet-standard/features';
import type { OwnerProjection, OwnerView, OwnerInvalidation } from './owner-evidence';
import { capturePublicWallet, samePublicAccounts, samePublicWallet, type PublicWalletData, type SolanaChain } from './wallet-public-data';
import { inspectWalletStandardProvider, type DiscoveredWalletProvider, type WalletStandardRegistry } from './wallet-standard-discovery';

export const PUBLIC_ACCOUNTS_PERMISSION_EXPLANATION = 'Request this wallet’s permission to expose public accounts, addresses, public keys, declared chains and capability metadata to this app. Wallet Standard Connect has no granular address-only scope; the wallet may remember permission. This step never requests a signature, transaction, RPC call or transfer and does not prove ownership. Cancel, timeout or local disconnect clears this app’s view but may not close the wallet prompt or revoke its permission.';
// Memory-only, same-module/same-provider-object quarantine. Not durable across reload/new objects.
const unresolvedPermissions = new WeakSet<Wallet>();
const quarantineListeners = new Set<() => void>();
export type WalletConnectionPhase = 'idle' | 'selected' | 'requesting' | 'connected' | 'rejected' | 'cancelled' | 'timed_out' | 'invalid' | 'closed';
export interface WalletSelectionView {
  readonly schema: 'wallet-selection-flow-v4';
  readonly generation: number;
  readonly discoveryStarted: boolean;
  readonly providers: readonly DiscoveredWalletProvider[];
  readonly selectedProviderId: string | null;
  readonly phase: WalletConnectionPhase;
  readonly notice: string;
  readonly permissionExplanation: typeof PUBLIC_ACCOUNTS_PERMISSION_EXPLANATION;
  readonly requestInProgress: boolean;
  readonly pendingPermissionRequest: boolean;
  readonly canRequestPermission: boolean;
  readonly owner: OwnerView;
  readonly wallet: PublicWalletData | null;
  readonly selectedAddress: string | null;
  readonly expectedChain: SolanaChain;
  readonly expectedChainSupport: 'not_observed' | 'declared' | 'not_declared';
  readonly ownershipVerified: false;
  readonly networkVerified: false;
  readonly signingAvailable: false;
  readonly sendingAvailable: false;
  readonly executionAvailable: false;
  readonly realMoneyEnabled: false;
}
export interface WalletSelectionOptions {
  readonly registry: WalletStandardRegistry | (() => WalletStandardRegistry);
  readonly owner: OwnerProjection;
  readonly expectedChain?: SolanaChain;
  readonly connectionTimeoutMs?: number;
}
export interface WalletSelectionController {
  startDiscovery(): WalletSelectionView;
  snapshot(): WalletSelectionView;
  subscribe(listener: () => void): () => void;
  selectProvider(id: string | null): WalletSelectionView;
  refreshOwnerEvidence(): Promise<WalletSelectionView>;
  /** Pass the original native click, not a copied/forged event. Gesture hygiene, not server authorization. */
  connectFromUserClick(event: { readonly type: string; readonly isTrusted: boolean }, permissionAccepted: boolean): Promise<WalletSelectionView>;
  selectAccount(address: string): WalletSelectionView;
  cancel(): WalletSelectionView;
  disconnectLocally(): WalletSelectionView;
  invalidateOwner(reason?: OwnerInvalidation): WalletSelectionView;
  close(): void;
}
export function createWalletSelectionController(options: WalletSelectionOptions): WalletSelectionController {
  const timeout = options.connectionTimeoutMs ?? 30_000, owner = options.owner, expectedChain = options.expectedChain ?? 'solana:mainnet';
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) throw new Error('INVALID_CONNECTION_TIMEOUT');
  if (!['solana:mainnet', 'solana:devnet', 'solana:testnet'].includes(expectedChain)) throw new Error('INVALID_EXPECTED_CHAIN');
  type Operation = { epoch: number; ownerGeneration: number; providerId: string; wallet: Wallet; revision: number; rechecking: boolean; off: (() => void) | null; timer: ReturnType<typeof setTimeout> | null; stop: () => void };
  let epoch = 0, generation = 0, serial = 0, closed = false, retiring = false, poisoned = false;
  let discoveryStarted = false, discoveryBusy = false, discoveryRevision = 0;
  let registry: WalletStandardRegistry | null = null;
  const registryOffs: (() => void)[] = [];
  let providers: readonly DiscoveredWalletProvider[] = Object.freeze([]), wallets = new Map<string, Wallet>();
  let selectedProviderId: string | null = null, selectedAddress: string | null = null;
  let phase: WalletConnectionPhase = 'idle', notice = 'NOT_STARTED';
  let publicWallet: PublicWalletData | null = null, operation: Operation | null = null;
  let ownerView: OwnerView = Object.freeze({ phase: 'unknown', generation: 0, validUntil: null }), reconcilingOwner = false;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of [...listeners]) { try { listener(); } catch { /* No raw application/provider errors. */ } } };
  function cleanup(off: (() => void) | null) {
    if (!off) return;
    try { off(); } catch { poisoned = true; if (!closed) { phase = 'invalid'; notice = 'CLEANUP_FAILED'; } }
  }
  function retire(next: WalletConnectionPhase, reason: string, clearSelection = false) {
    const old = operation;
    operation = null; epoch++; generation++; phase = closed ? 'closed' : next; notice = reason; publicWallet = null; selectedAddress = null;
    if (clearSelection) selectedProviderId = null;
    const before = retiring; retiring = true;
    try { if (old?.timer !== null && old?.timer !== undefined) clearTimeout(old.timer); old?.stop(); cleanup(old?.off ?? null); }
    finally { retiring = before; }
    emit();
  }
  function reconcileOwner(): OwnerView {
    if (reconcilingOwner) return Object.freeze({ phase: 'unavailable', generation: ownerView.generation, validUntil: null });
    reconcilingOwner = true;
    try {
      ownerView = owner.snapshot();
      if (operation && ((ownerView.phase !== 'current' && !(operation.rechecking && ownerView.phase === 'checking')) || ownerView.generation !== operation.ownerGeneration)) retire(selectedProviderId ? 'selected' : 'idle', 'OWNER_EVIDENCE_CHANGED');
    } catch {
      ownerView = Object.freeze({ phase: 'unavailable', generation: ownerView.generation + 1, validUntil: null });
      if (operation || publicWallet) retire('invalid', 'OWNER_EVIDENCE_UNAVAILABLE');
    } finally { reconcilingOwner = false; }
    return ownerView;
  }
  function active(op: Operation): boolean {
    if (closed || poisoned || retiring || operation !== op || epoch !== op.epoch || selectedProviderId !== op.providerId || wallets.get(op.providerId) !== op.wallet) return false;
    const view = reconcileOwner();
    return !closed && !poisoned && operation === op && epoch === op.epoch && (view.phase === 'current' || (op.rechecking && view.phase === 'checking')) && view.generation === op.ownerGeneration;
  }
  function snapshot(): WalletSelectionView {
    const currentOwner = reconcileOwner(), selected = selectedProviderId ? wallets.get(selectedProviderId) : undefined;
    const pendingPermissionRequest = !!selected && unresolvedPermissions.has(selected);
    const shownWallet = currentOwner.phase === 'current' ? publicWallet : null;
    const shownAddress = shownWallet ? selectedAddress : null;
    const selectedAccount = shownWallet?.accounts.find(account => account.address === shownAddress);
    const declared = !!shownWallet?.chains.includes(expectedChain) && (!selectedAccount || selectedAccount.chains.includes(expectedChain));
    return Object.freeze({ schema: 'wallet-selection-flow-v4', generation, discoveryStarted, providers, selectedProviderId, phase, notice,
      permissionExplanation: PUBLIC_ACCOUNTS_PERMISSION_EXPLANATION, requestInProgress: phase === 'requesting', pendingPermissionRequest,
      canRequestPermission: !closed && !retiring && !poisoned && !pendingPermissionRequest && phase !== 'requesting' && phase !== 'connected' && currentOwner.phase === 'current' && providers.some(p => p.id === selectedProviderId && p.eligible),
      owner: currentOwner, wallet: shownWallet, selectedAddress: shownAddress, expectedChain, expectedChainSupport: shownWallet ? declared ? 'declared' : 'not_declared' : 'not_observed',
      ownershipVerified: false, networkVerified: false, signingAvailable: false, sendingAvailable: false, executionAvailable: false, realMoneyEnabled: false });
  }
  function discoveryFailure() { providers = Object.freeze([]); wallets.clear(); retire('invalid', 'DISCOVERY_UNAVAILABLE', true); }
  function syncDiscovery() {
    if (closed || !registry) return;
    if (discoveryBusy) { discoveryFailure(); return; }
    discoveryBusy = true;
    const revision = discoveryRevision;
    const fence = () => { if (closed || revision !== discoveryRevision) throw new Error('DISCOVERY_CHANGED'); };
    try {
      const raw = registry.get(); fence();
      if (!Array.isArray(raw) || raw.length > 64 || Object.getPrototypeOf(raw) !== Array.prototype) throw new Error('INVALID_REGISTRY');
      const d = Object.getOwnPropertyDescriptors(raw); fence();
      if (Reflect.ownKeys(d).length !== raw.length + 1) throw new Error('INVALID_REGISTRY');
      const list: Wallet[] = [];
      for (let i = 0; i < raw.length; i++) { const item = d[String(i)]; if (!item || !Object.hasOwn(item, 'value') || !item.value || typeof item.value !== 'object') throw new Error('INVALID_REGISTRY'); list.push(item.value as Wallet); }
      const next = new Map<string, Wallet>(), views: DiscoveredWalletProvider[] = [];
      for (const wallet of new Set(list)) {
        const id = [...wallets].find(([, candidate]) => candidate === wallet)?.[0] ?? `wallet-${++serial}`;
        const view = inspectWalletStandardProvider(wallet, id, fence); fence(); next.set(id, wallet); views.push(view);
      }
      wallets = next; providers = Object.freeze(views);
      if (selectedProviderId && (!wallets.has(selectedProviderId) || !providers.some(p => p.id === selectedProviderId && p.eligible))) retire('idle', 'PROVIDER_UNAVAILABLE', true);
      else emit();
    } catch { if (!closed) discoveryFailure(); }
    finally { discoveryBusy = false; }
  }
  function requireActive(op: Operation) { if (!active(op)) throw new Error('STALE_REQUEST'); }
  function read(op: Operation, object: object, key: string): unknown { requireActive(op); const value: unknown = Reflect.get(object, key); requireActive(op); return value; }
  function feature(op: Operation, key: string): object {
    const features = read(op, op.wallet, 'features');
    if (!features || typeof features !== 'object') throw new Error('UNSUPPORTED_FEATURE');
    const result = read(op, features, key);
    if (!result || typeof result !== 'object' || read(op, result, 'version') !== '1.0.0') throw new Error('UNSUPPORTED_FEATURE');
    return result;
  }
  function onProviderChange(op: Operation, change: unknown) {
    if (!active(op)) return;
    if (phase === 'connected' || op.rechecking) { retire('selected', op.rechecking ? 'PUBLIC_FACTS_CHANGED_DURING_OWNER_RECHECK' : 'PUBLIC_FACTS_CHANGED_RECONNECT_REQUIRED'); return; }
    try {
      if (!change || typeof change !== 'object') throw new Error('INVALID_CHANGE');
      const keys = Reflect.ownKeys(change); requireActive(op);
      if (keys.length !== 1 || keys[0] !== 'accounts') throw new Error('PROVIDER_CHANGED');
      const accounts = read(op, change, 'accounts');
      if (!Array.isArray(accounts) || accounts.length > 16) throw new Error('INVALID_ACCOUNTS');
      if (!accounts.length) { retire('selected', 'ACCOUNTS_REVOKED'); return; }
      // Connect normally emits nonempty accounts before resolving. This is pending progress, not success.
      // Completion must match a fresh snapshot and cannot cross any later event/read race.
      op.revision++;
    } catch { if (active(op)) retire('invalid', 'PROVIDER_CHANGED_DURING_REQUEST'); }
  }
  let ownerOff: (() => void) | null = null;
  const onOwner = () => { if (!closed && !reconcilingOwner) { reconcileOwner(); emit(); } };
  const onQuarantine = () => { if (!closed) emit(); };
  const controller: WalletSelectionController = {
    snapshot,
    subscribe(listener) { if (closed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    startDiscovery() {
      if (closed || discoveryStarted || retiring) return snapshot();
      discoveryStarted = true; notice = 'DISCOVERING';
      try {
        registry = typeof options.registry === 'function' ? options.registry() : options.registry;
        if (closed) return snapshot();
        for (const event of ['register', 'unregister'] as const) {
          const off = registry.on(event, (...changed) => {
            if (closed) return;
            discoveryRevision++;
            if (event === 'unregister' && selectedProviderId && changed.includes(wallets.get(selectedProviderId)!)) retire('idle', 'PROVIDER_UNREGISTERED', true);
            syncDiscovery();
          });
          if (typeof off !== 'function') throw new Error('INVALID_SUBSCRIPTION');
          if (closed) { cleanup(off); return snapshot(); }
          registryOffs.push(off);
        }
        syncDiscovery();
        if (!closed && notice === 'DISCOVERING') notice = providers.length ? 'SELECT_A_WALLET' : 'NO_WALLETS_DISCOVERED';
      } catch { if (!closed) discoveryFailure(); }
      emit(); return snapshot();
    },
    selectProvider(id) {
      if (closed || retiring || poisoned) return snapshot();
      if (id !== null && !wallets.has(id)) { retire('invalid', 'UNKNOWN_PROVIDER', true); return snapshot(); }
      const expected = epoch + 1;
      retire(id ? 'selected' : 'idle', 'PROVIDER_SELECTION_CHANGED', true);
      if (epoch === expected && !closed && !poisoned && !retiring) { selectedProviderId = id; phase = id ? 'selected' : 'idle'; emit(); }
      return snapshot();
    },
    async refreshOwnerEvidence() {
      if (closed || retiring) return snapshot();
      const expected = epoch + 1;
      retire(selectedProviderId ? 'selected' : 'idle', 'CHECKING_OWNER_EVIDENCE');
      if (!closed && epoch === expected) await owner.refresh();
      if (!closed && epoch === expected) { notice = reconcileOwner().phase === 'current' ? 'OWNER_EVIDENCE_CURRENT' : 'OWNER_EVIDENCE_NOT_CURRENT'; emit(); }
      return snapshot();
    },
    async connectFromUserClick(event, permissionAccepted) {
      const before = snapshot();
      if (closed || retiring || poisoned || before.requestInProgress || before.phase === 'connected') return before;
      const clickEpoch = epoch;
      const explicitClick = !!event && event.type === 'click' && event.isTrusted === true && permissionAccepted === true;
      if (closed || epoch !== clickEpoch) return snapshot();
      if (!explicitClick) { retire(selectedProviderId ? 'selected' : 'idle', 'EXPLICIT_PERMISSION_CLICK_REQUIRED'); return snapshot(); }
      if (!before.canRequestPermission || selectedProviderId === null) {
        retire(selectedProviderId ? 'selected' : 'idle', before.pendingPermissionRequest ? 'EXISTING_WALLET_PROMPT_MAY_REMAIN' : 'OWNER_AND_PROVIDER_REQUIRED'); return snapshot();
      }
      const providerId = selectedProviderId, wallet = wallets.get(providerId)!, expected = epoch + 1;
      retire('requesting', 'REQUESTING_PUBLIC_ACCOUNTS_PERMISSION');
      if (epoch !== expected || closed || poisoned || selectedProviderId !== providerId || wallets.get(providerId) !== wallet) return snapshot();
      const currentOwner = reconcileOwner();
      if (epoch !== expected || closed || poisoned || selectedProviderId !== providerId || wallets.get(providerId) !== wallet) return snapshot();
      if (currentOwner.phase !== 'current') { retire('selected', 'OWNER_EVIDENCE_NOT_CURRENT'); return snapshot(); }
      let stop!: () => void;
      const stopped = new Promise<null>(resolve => { stop = () => resolve(null); });
      const op: Operation = { epoch, ownerGeneration: currentOwner.generation, providerId, wallet, revision: 0, rechecking: false, off: null, timer: null, stop };
      operation = op;
      try {
        const connectFeature = feature(op, StandardConnect), eventsFeature = feature(op, StandardEvents);
        const on = read(op, eventsFeature, 'on');
        if (typeof on !== 'function') throw new Error('INVALID_EVENTS');
        const off: unknown = Reflect.apply(on, eventsFeature, ['change', (change: unknown) => onProviderChange(op, change)]);
        if (typeof off !== 'function') throw new Error('INVALID_SUBSCRIPTION');
        if (!active(op)) { cleanup(off as () => void); return snapshot(); }
        op.off = off as () => void;
        const connect = read(op, connectFeature, 'connect');
        if (typeof connect !== 'function') throw new Error('INVALID_CONNECT');
        op.timer = setTimeout(() => { if (active(op)) retire('timed_out', 'PERMISSION_REQUEST_TIMED_OUT'); }, timeout);
        emit(); requireActive(op);
        if (unresolvedPermissions.has(wallet)) throw new Error('PENDING_PERMISSION');
        unresolvedPermissions.add(wallet);
        let returned: ReturnType<StandardConnectMethod>;
        try {
          // The only provider operation: synchronous in the explicit native click stack, before first await.
          returned = Reflect.apply(connect, connectFeature, [{ silent: false }]);
        } catch (error) { unresolvedPermissions.delete(wallet); throw error; }
        const providerResult = Promise.resolve(returned);
        const settled = () => { unresolvedPermissions.delete(wallet); for (const listener of [...quarantineListeners]) listener(); };
        void providerResult.then(settled, settled);
        const output: unknown = await Promise.race([providerResult, stopped]);
        if (!active(op)) return snapshot();
        if (!output || typeof output !== 'object') throw new Error('INVALID_RESULT');
        const proto = Object.getPrototypeOf(output); requireActive(op);
        if (proto !== Object.prototype && proto !== null) throw new Error('INVALID_RESULT');
        const d = Object.getOwnPropertyDescriptors(output); requireActive(op);
        if (Reflect.ownKeys(d).length !== 1 || !d.accounts || !Object.hasOwn(d.accounts, 'value')) throw new Error('INVALID_RESULT');
        // The provider prompt has settled. Its timer is distinct from the existing owner reader's timeout.
        if (op.timer !== null) clearTimeout(op.timer); op.timer = null;
        op.rechecking = true; notice = 'RECHECKING_OWNER_EVIDENCE'; emit(); requireActive(op);
        // No second wallet prompt: only the existing authenticated evidence read is rechecked.
        // Permit its own known checking transition, never revocation, expiry or a new session generation.
        await Promise.race([owner.refresh(), stopped]);
        if (!active(op)) return snapshot();
        const refreshedOwner = reconcileOwner();
        if (!active(op) || refreshedOwner.phase !== 'current' || refreshedOwner.generation !== op.ownerGeneration) {
          if (operation === op) retire('rejected', 'OWNER_RECHECK_NOT_CONFIRMED');
          return snapshot();
        }
        op.rechecking = false; requireActive(op);
        const revision = op.revision;
        const fence = () => { requireActive(op); if (op.revision !== revision) throw new Error('PUBLIC_DATA_CHANGED'); };
        const captured = capturePublicWallet(wallet, fence, { value: d.accounts.value }); fence();
        if (!captured.wallet.accounts.length || !captured.returnedAccounts || !samePublicAccounts(captured.wallet.accounts, captured.returnedAccounts)) throw new Error('STALE_RESULT');
        // Recheck after listener registration and all copying. No prepare/subscribe gap or getter drift is trusted.
        const fresh = capturePublicWallet(wallet, fence).wallet; fence();
        if (!samePublicWallet(captured.wallet, fresh) || read(op, feature(op, StandardEvents), 'on') !== on || read(op, feature(op, StandardConnect), 'connect') !== connect) throw new Error('PUBLIC_DATA_CHANGED');
        fence();
        if (op.timer !== null) clearTimeout(op.timer); op.timer = null;
        publicWallet = fresh; selectedAddress = fresh.accounts.length === 1 ? fresh.accounts[0].address : null;
        phase = 'connected'; notice = 'PUBLIC_ACCOUNTS_OBSERVED_NOT_OWNERSHIP_PROOF'; generation++; emit();
      } catch { if (active(op)) retire('rejected', 'PERMISSION_NOT_CONFIRMED'); }
      return snapshot();
    },
    selectAccount(address) {
      if (closed || retiring || phase !== 'connected') return snapshot();
      if (!publicWallet?.accounts.some(account => account.address === address)) { retire('invalid', 'ACCOUNT_SELECTION_INVALID'); return snapshot(); }
      selectedAddress = address; generation++; notice = 'ACCOUNT_SELECTION_CHANGED'; emit(); return snapshot();
    },
    cancel() { if (!closed && !retiring) retire(selectedProviderId ? 'cancelled' : 'idle', 'CANCELLED_LOCALLY_PROMPT_MAY_REMAIN'); return snapshot(); },
    disconnectLocally() { if (!closed && !retiring) retire(selectedProviderId ? 'selected' : 'idle', 'DISCONNECTED_LOCALLY_PERMISSION_MAY_REMAIN'); return snapshot(); },
    invalidateOwner(reason) { if (!closed) { owner.invalidate(reason); retire(selectedProviderId ? 'selected' : 'idle', 'OWNER_EVIDENCE_INVALIDATED'); } return snapshot(); },
    close() {
      if (closed) return;
      closed = true; retire('closed', 'ROUTE_CLOSED', true); providers = Object.freeze([]); wallets.clear();
      for (const off of registryOffs.splice(0)) cleanup(off);
      cleanup(ownerOff); ownerOff = null; quarantineListeners.delete(onQuarantine); owner.close(); ownerView = owner.snapshot(); listeners.clear();
    },
  };
  ownerOff = owner.subscribe(onOwner); quarantineListeners.add(onQuarantine);
  return Object.freeze(controller);
}
