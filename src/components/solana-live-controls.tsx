import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ControlClient,
  canCommand,
  observedLabel,
  ownerReady,
  sessionPendingStore,
  transportFresh,
  workerFresh,
  type ControlState,
} from "../lib/solana-live-control";
import { createOwnerControlRuntime } from "../lib/owner-control-runtime";
import { createBrowserOwnerControlAdapter } from "../lib/owner-control-browser";
import { createControlPoller, type ControlPoller } from "../lib/owner-control-polling";
import { AUTH_STORAGE_KEY } from "../lib/owner-auth/pinned-supabase-adapter";

function localControls() {
  const auth = createOwnerControlRuntime(createBrowserOwnerControlAdapter);
  try {
    return { auth, client: new ControlClient(
      auth.transport,
      Date.now,
      undefined,
      typeof window === "undefined"
        ? undefined
        : sessionPendingStore(window.sessionStorage),
    ) };
  } catch {
    return { auth, client: new ControlClient(auth.transport, Date.now, undefined, {
      read: () => {
        throw new Error("Browser request journal unavailable");
      },
      write: () => {
        throw new Error("Browser request journal unavailable");
      },
    }) };
  }
}
const count = (n: number | null | undefined) =>
  n == null ? "Unknown" : String(n);
const timestamp = (n: number | null | undefined) =>
  n == null
    ? "Not supplied"
    : Number.isNaN(new Date(n * 1000).getTime())
      ? "Invalid timestamp"
      : new Date(n * 1000).toISOString();

export function SolanaLiveControls({
  client: suppliedClient,
}: {
  client?: ControlClient;
}) {
  const [{ client, auth }] = useState(() => suppliedClient
    ? { client: suppliedClient, auth: undefined }
    : localControls());
  const state = useSyncExternalStore(
    client.subscribe,
    client.snapshot,
    client.snapshot,
  );
  const [now, setNow] = useState(Date.now);
  const pollerRef = useRef<ControlPoller | null>(null);
  useEffect(() => {
    client.activate();
    auth?.activate();
    const poller = createControlPoller({
      refresh: () => client.refresh(),
      healthy: () => client.snapshot().connection === "connected",
      visible: () => document.visibilityState === "visible",
    });
    pollerRef.current = poller;
    poller.start();
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 1000);
    const refreshOnReturn = () => {
      setNow(Date.now());
      poller.visibilityChanged();
    };
    const refreshOnSessionChange = (event: StorageEvent) => {
      // Inspect only the key, never raw session/token values in the event.
      if (event.key === AUTH_STORAGE_KEY || event.key === null) poller.refreshNow();
    };
    document.addEventListener("visibilitychange", refreshOnReturn);
    window.addEventListener("storage", refreshOnSessionChange);
    return () => {
      client.close();
      auth?.close();
      poller.close();
      if (pollerRef.current === poller) pollerRef.current = null;
      clearInterval(tick);
      document.removeEventListener("visibilitychange", refreshOnReturn);
      window.removeEventListener("storage", refreshOnSessionChange);
    };
  }, [client, auth]);
  return (
    <LiveControlPanel
      state={state}
      now={now}
      onCommand={(action) => void client.send(action)}
      onRefresh={() => pollerRef.current?.refreshNow()}
    />
  );
}

export function LiveControlPanel({
  state,
  now,
  onCommand,
  onRefresh,
}: {
  state: ControlState;
  now: number;
  onCommand: (action: "OFF" | "PAUSE_ENTRIES") => void;
  onRefresh: () => void;
}) {
  const s = state.status;
  const connected = transportFresh(state, now);
  const workerCurrent = workerFresh(state, now);
  return (
    <section
      className="live-control-panel mt-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 sm:p-5"
      aria-labelledby="live-control-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-500">
            Separate from PAPER
          </p>
          <h2 id="live-control-title" className="mt-1 text-xl font-semibold">
            Real-money controls
          </h2>
        </div>
        <span className="rounded-full border border-amber-500/50 px-3 py-1 text-xs font-semibold">
          LIVE unavailable · default OFF
        </span>
      </div>
      <p className="mt-3 text-sm">
        Preparation only. No wallet, signer or live execution adapter is
        connected. These controls do not start, stop or alter the paper session.
      </p>
      <p className="mt-2 text-sm">
        <a className="underline" href="/owner/login" referrerPolicy="no-referrer">Owner sign-in</a>
        {" · Signing in does not enable real-money execution."}
      </p>
      <div
        className="mt-4 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Real-money on and off controls"
      >
        <button
          type="button"
          disabled
          aria-describedby="live-on-blocker"
          className="rounded-lg border border-border px-5 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          ON unavailable
        </button>
        <button
          type="button"
          disabled={!canCommand(state, "OFF", now)}
          onClick={() => onCommand("OFF")}
          className="rounded-lg border border-red-500/50 px-5 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.sending === "OFF" ? "Requesting OFF…" : "Set OFF"}
        </button>
        <button
          type="button"
          disabled={!canCommand(state, "PAUSE_ENTRIES", now)}
          onClick={() => onCommand("PAUSE_ENTRIES")}
          className="rounded-lg border border-border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.sending === "PAUSE_ENTRIES"
            ? "Requesting pause…"
            : "Pause entries"}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg border border-border px-4 py-2 text-sm"
        >
          Refresh status
        </button>
      </div>
      <p id="live-on-blocker" className="mt-2 text-xs text-muted-foreground">
        ON remains locked in this candidate. Owner authorization, backend
        readiness, reconciled balances, current worker acknowledgement and a
        separately reviewed user-controlled financial boundary are still
        required.
      </p>
      <div
        className="mt-4 rounded-lg border border-border p-3"
        role="status"
        aria-live="polite"
      >
        <p className="font-semibold">Worker: {observedLabel(state, now)}</p>
        <p className="mt-1 text-sm">
          {state.message ??
            (state.connection === "loading"
              ? "Checking for an authenticated control backend…"
              : "No control request is pending in this browser.")}
        </p>
        {!connected && (
          <p className="mt-1 text-sm text-amber-500">
            {state.connection === "unauthorized"
              ? "Owner authentication is required. No client-side role grants permission."
              : "Control status is unavailable or stale. No successful change is implied."}
          </p>
        )}
        {state.journalError && (
          <p className="mt-2 text-sm text-amber-500">{state.journalError}</p>
        )}
        {state.pending && (
          <p className="mt-2 break-all font-mono text-xs">
            {state.pending.uncertain
              ? "Unconfirmed request"
              : "Accepted request, awaiting application"}
            : {state.pending.command.command_id}. No automatic retry.
          </p>
        )}
      </div>
      <p className="mt-4 text-xs text-amber-500">
        Any displayed counts are synthetic test fixtures, not wallet data. Real
        holdings and pending transactions are unknown; zero fixtures does not
        mean zero real exposure.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Requested mode</dt>
          <dd className="mt-1 font-mono">
            {s ? s.desired_mode.replaceAll("_", " ") : "Unknown"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            Control / applied version
          </dt>
          <dd className="mt-1 font-mono">
            {s
              ? `${s.version} / ${s.acknowledged_version ?? "unconfirmed"}`
              : "Unknown"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Owner session</dt>
          <dd className="mt-1">
            {ownerReady(state, now)
              ? "Verified by backend"
              : "Not verified / expired"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Worker heartbeat</dt>
          <dd className="mt-1">
            {workerCurrent ? "Current" : "Missing / stale"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            Fixture held positions
          </dt>
          <dd className="mt-1 font-mono">
            {count(s?.residual_holdings_count)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            Fixture pending outcomes
          </dt>
          <dd className="mt-1 font-mono">{count(s?.pending_outcomes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            Fixture unknown outcomes
          </dt>
          <dd className="mt-1 font-mono">{count(s?.unknown_outcomes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Safety halt</dt>
          <dd className="mt-1">
            {s
              ? s.halted
                ? `Latched · generation ${s.halt_generation}`
                : "Not latched"
              : "Unknown"}
          </dd>
        </div>
      </dl>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-red-500/30 p-3">
          <h3 className="font-semibold">OFF is not a sale</h3>
          <p className="mt-1 text-muted-foreground">
            Requests no new financial execution, including exits. Held assets
            remain held. Already submitted transactions cannot be recalled and
            may still complete. Read-only reconciliation should continue.
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <h3 className="font-semibold">Pause entries is different</h3>
          <p className="mt-1 text-muted-foreground">
            Blocks new exposure. Existing-position management may continue only
            through its independently authorized boundary. It does not order any
            sale.
          </p>
          <p className="mt-2 text-xs">
            Existing exit monitoring:{" "}
            {s?.existing_exit_monitoring_active && connected && workerCurrent
              ? "Reported active, not execution proof"
              : "Not verified active"}
            .
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
        <button
          type="button"
          disabled
          className="rounded border border-border px-3 py-2 text-sm opacity-50"
        >
          Liquidate holdings · not implemented
        </button>
        <p className="text-xs text-muted-foreground">
          A separate consequential action. OFF and pause never liquidate.
        </p>
      </div>
      <details className="mt-4 text-xs">
        <summary className="cursor-pointer font-semibold">
          Readiness and audit details
        </summary>
        <div className="mt-3 space-y-2">
          <p>
            Readiness: BLOCKED. The live execution adapter and deployed owner
            authorization are not included in this candidate.
          </p>
          {s?.readiness.blockers.length ? (
            <ul className="list-disc space-y-1 pl-4">
              {s.readiness.blockers.map((reason, index) => (
                <li key={`${index}-${reason}`}>{reason}</li>
              ))}
            </ul>
          ) : (
            <p>
              Backend readiness evidence is not available. No green readiness
              state is inferred.
            </p>
          )}
          {s?.halt_reasons.length ? (
            <p>Halt reasons: {s.halt_reasons.join("; ")}</p>
          ) : null}
          <p>
            Reconciliation:{" "}
            {s?.reconciliation_required !== false
              ? "Required / unverified"
              : "Backend reports complete"}{" "}
            · last successful: {timestamp(s?.reconciliation_as_of)}.
          </p>
          <p className="break-all">
            Policy: {s?.policy_hash ?? "Not configured"}
          </p>
          <p className="break-all">
            Runtime: {s?.runtime_identity ?? "Not configured"}
          </p>
          <p>Worker heartbeat: {timestamp(s?.worker_heartbeat_at)}.</p>
          <p>
            Refreshing and reopening this page never replays a control request.
            A request receipt means accepted, not applied. Only a current
            matching worker acknowledgement can confirm OFF or pause.
          </p>
        </div>
      </details>
    </section>
  );
}
