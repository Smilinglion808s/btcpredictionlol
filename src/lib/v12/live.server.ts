// Lightweight, current-interval-only V1.2 status.
//
// Read path only. This is deliberately NOT the historical aggregate in
// stats.server.ts: it reads at most four small rows for the interval that is
// open right now (plus the one before it, so a rollover never shows a blank
// card), so the dashboard can poll it every second without touching the heavy
// history scan.
//
// It never reports a fill. The three receivers are external; everything here
// is decision / dispatch / receiver-acknowledgement state only.

import { createClient } from '@supabase/supabase-js';
import { ROUTES, type Route } from './contract';

export const INTERVAL_MS = 900_000;

export function intervalOpen(nowMs: number): number {
  return Math.floor(nowMs / INTERVAL_MS) * INTERVAL_MS;
}

type EventRow = {
  route: string;
  candle_starts_at: string;
  decision_at: string;
  prediction: string;
  delivery_status: string;
  acknowledged_at: string | null;
  receiver_status: string | null;
  created_at: string;
};

export type V12LegLive = {
  leg: Route;
  endpoint: string;
  execution: string;
  percent: number;
  /** DECIDED once a webhook exists for this interval, otherwise WAITING. */
  status: 'WAITING' | 'DISPATCHED' | 'ACKNOWLEDGED' | 'UNCONFIRMED';
  prediction: string | null;
  decisionAt: string | null;
  sentAt: string | null;
  acknowledgedAt: string | null;
  receiverStatus: string | null;
};

export type V12Live = {
  now: string;
  intervalOpen: string;
  intervalClose: string;
  /** True when the rows below describe the interval that is open right now. */
  isCurrentInterval: boolean;
  decision: {
    side: 'UP' | 'DOWN' | null;
    leg: string | null;
    reason: string | null;
    runMode: string | null;
    committed: boolean;
  } | null;
  legs: V12LegLive[];
  worker: {
    state: 'CONNECTED' | 'WAITING' | 'OFFLINE';
    receivedAt: string | null;
    stage: string | null;
    lastDispatchLeg: string | null;
    lastDispatchAt: string | null;
  };
  /** Any webhook still awaiting a receiver acknowledgement right now. */
  pending: boolean;
};

function client() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function legsFromEvents(rows: EventRow[]): V12LegLive[] {
  return (Object.keys(ROUTES) as Route[]).map((leg) => {
    const policy = ROUTES[leg];
    const row = rows
      .filter((r) => r.route === leg)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    const status: V12LegLive['status'] = !row
      ? 'WAITING'
      : row.delivery_status === 'ACKNOWLEDGED'
        ? 'ACKNOWLEDGED'
        : row.delivery_status === 'UNKNOWN'
          ? 'UNCONFIRMED'
          : 'DISPATCHED';
    return {
      leg,
      endpoint: policy.endpoint,
      execution: policy.execution,
      percent: policy.percent,
      status,
      prediction: row?.prediction ?? null,
      decisionAt: row?.decision_at ?? null,
      sentAt: row?.created_at ?? null,
      acknowledgedAt: row?.acknowledged_at ?? null,
      receiverStatus: row?.receiver_status ?? null,
    };
  });
}

export type DecisionSource = {
  /** Webhook rows for the interval being shown (any leg). */
  events: EventRow[];
  /** c85_targets row for that interval, if any. */
  target: { run_mode?: string | null; final_side?: number | null; features?: any } | null;
  /** v11_decisions row for that interval, if any. */
  fallback: { leg?: string | null; side?: number | null; reason?: string | null; run_mode?: string | null } | null;
};

/**
 * Which leg and direction to show for an interval.
 *
 * Precedence:
 *  1. The authoritative sender journal. If a webhook went out, that row IS the
 *     decision — its route is the leg and its prediction is the direction.
 *  2. Otherwise a committed V1 call only: run_mode LIVE, valid inputs and a
 *     non-zero side. A V1 abstention (side 0) is NOT a V1 call.
 *  3. Otherwise the T45 R2 fallback, from the same sender provenance
 *     (LIVE_SHADOW, leg T45R2, non-zero side).
 *  4. Otherwise nothing — never tag an abstained interval as a V1 call.
 */
export function selectDecision(src: DecisionSource): V12Live['decision'] {
  const dir = (side: number | null | undefined) =>
    side === 1 ? ('UP' as const) : side === -1 ? ('DOWN' as const) : null;

  const newest = [...src.events].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )[0];
  if (newest) {
    return {
      side: newest.prediction === 'YES' ? 'UP' : newest.prediction === 'NO' ? 'DOWN' : null,
      leg: newest.route,
      reason: src.fallback?.reason ?? null,
      runMode: src.target?.run_mode ?? src.fallback?.run_mode ?? null,
      committed: true,
    };
  }

  const t = src.target;
  const tSide = dir(t?.final_side);
  if (t && t.run_mode === 'LIVE' && t.features?.input_valid === true && tSide) {
    return { side: tSide, leg: 'V1', reason: src.fallback?.reason ?? null, runMode: 'LIVE', committed: true };
  }

  const f = src.fallback;
  const fSide = dir(f?.side);
  if (f && f.run_mode === 'LIVE_SHADOW' && f.leg === 'T45R2' && fSide) {
    return { side: fSide, leg: 'T45R2', reason: f.reason ?? null, runMode: f.run_mode, committed: true };
  }

  return null;
}

export async function buildV12Live(nowMs: number = Date.now()): Promise<V12Live> {
  const sb = client();
  const open = intervalOpen(nowMs);
  const openIso = new Date(open).toISOString();
  const prevIso = new Date(open - INTERVAL_MS).toISOString();

  const [events, runtime, target, fallback] = await Promise.all([
    sb
      .from('v12_prediction_events')
      .select(
        'route,candle_starts_at,decision_at,prediction,delivery_status,acknowledged_at,receiver_status,created_at',
      )
      .in('candle_starts_at', [openIso, prevIso])
      .order('created_at', { ascending: false })
      .limit(20),
    sb
      .from('v12_predictor_runtime')
      .select('received_at,status')
      .eq('worker_id', 'v12-shadow-worker')
      .maybeSingle(),
    sb
      .from('c85_targets')
      .select('target_open_utc,run_mode,final_side,features')
      .eq('model_version', 'lite-a-floor4-top10-r1')
      .in('target_open_utc', [openIso, prevIso])
      .order('target_open_utc', { ascending: false })
      .limit(2),
    sb
      .from('v11_decisions')
      .select('target_ts,leg,side,reason,run_mode')
      .in('target_ts', [openIso, prevIso])
      .order('target_ts', { ascending: false })
      .limit(2),
  ]);

  for (const r of [events, runtime, target, fallback]) if (r.error) throw new Error('V12_LIVE_UNAVAILABLE');

  const all = (events.data ?? []) as EventRow[];
  const currentEvents = all.filter(
    (r) => Date.parse(r.candle_starts_at) === open,
  );
  // Show the previous interval ONLY when the current one has produced nothing
  // yet, and say so explicitly via isCurrentInterval.
  const targetRow =
    (target.data ?? []).find((r: any) => Date.parse(r.target_open_utc) === open) ?? null;
  const fallbackRow =
    (fallback.data ?? []).find((r: any) => Date.parse(r.target_ts) === open) ?? null;
  const hasCurrent = currentEvents.length > 0 || !!targetRow || !!fallbackRow;

  const shownOpen = hasCurrent ? open : open - INTERVAL_MS;
  const shownIso = new Date(shownOpen).toISOString();
  const rows = hasCurrent
    ? currentEvents
    : all.filter((r) => Date.parse(r.candle_starts_at) === shownOpen);
  const shownTarget =
    (target.data ?? []).find((r: any) => Date.parse(r.target_open_utc) === shownOpen) ?? null;
  const shownFallback =
    (fallback.data ?? []).find((r: any) => Date.parse(r.target_ts) === shownOpen) ?? null;

  const side = shownTarget?.final_side ?? shownFallback?.side ?? null;
  const decision = shownTarget || shownFallback
    ? {
        side: side === 1 ? ('UP' as const) : side === -1 ? ('DOWN' as const) : null,
        leg: shownTarget ? 'V1' : (shownFallback?.leg ?? null),
        reason: shownFallback?.reason ?? null,
        runMode: shownTarget?.run_mode ?? shownFallback?.run_mode ?? null,
        committed: shownTarget?.run_mode === 'LIVE',
      }
    : null;

  const r = runtime.data as { received_at: string; status: Record<string, any> } | null;
  const status = r?.status ?? {};
  const recent = !!r && nowMs - Date.parse(r.received_at) < 120_000;
  const connected =
    recent && status.stage !== undefined && nowMs - Date.parse(status.last_context_at ?? '') < 90_000;

  const legs = legsFromEvents(rows);

  return {
    now: new Date(nowMs).toISOString(),
    intervalOpen: shownIso,
    intervalClose: new Date(shownOpen + INTERVAL_MS).toISOString(),
    isCurrentInterval: shownOpen === open,
    decision,
    legs,
    worker: {
      state: connected ? 'CONNECTED' : recent ? 'WAITING' : 'OFFLINE',
      receivedAt: r?.received_at ?? null,
      stage: typeof status.stage === 'string' ? status.stage : null,
      lastDispatchLeg: typeof status.last_dispatch_leg === 'string' ? status.last_dispatch_leg : null,
      lastDispatchAt: typeof status.last_dispatch_at === 'string' ? status.last_dispatch_at : null,
    },
    pending: legs.some((l) => l.status === 'DISPATCHED' || l.status === 'UNCONFIRMED'),
  };
}
