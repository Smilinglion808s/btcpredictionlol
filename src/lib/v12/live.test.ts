import test from 'node:test';
import assert from 'node:assert/strict';
import { intervalOpen, legsFromEvents, selectDecision, INTERVAL_MS } from './live.server.ts';

test('interval open floors to the 15-minute boundary', () => {
  const open = Date.parse('2026-09-18T02:15:00.000Z');
  assert.equal(intervalOpen(open), open);
  assert.equal(intervalOpen(open + 1), open);
  assert.equal(intervalOpen(open + INTERVAL_MS - 1), open);
  assert.equal(intervalOpen(open + INTERVAL_MS), open + INTERVAL_MS);
});

test('every leg is reported, waiting when no webhook exists', () => {
  const legs = legsFromEvents([]);
  assert.deepEqual(legs.map((l) => l.leg), ['V1', 'T45R2', 'U']);
  assert(legs.every((l) => l.status === 'WAITING' && l.prediction === null));
});

test('delivery status maps to dispatch state and never to a fill', () => {
  const row = (route: string, delivery: string, created: string) => ({
    route,
    candle_starts_at: '2026-09-18T02:15:00.000Z',
    decision_at: '2026-09-18T02:15:05.095Z',
    prediction: 'YES',
    delivery_status: delivery,
    acknowledged_at: delivery === 'ACKNOWLEDGED' ? '2026-09-18T02:15:11.215Z' : null,
    receiver_status: delivery === 'ACKNOWLEDGED' ? 'LIVE_ACCEPTED' : null,
    created_at: created,
  });
  const legs = legsFromEvents([
    row('V1', 'PENDING', '2026-09-18T02:15:10.011Z'),
    row('V1', 'ACKNOWLEDGED', '2026-09-18T02:15:11.000Z'),
    row('U', 'UNKNOWN', '2026-09-18T02:17:00.000Z'),
  ]);
  const byLeg = Object.fromEntries(legs.map((l) => [l.leg, l]));
  // Newest row per leg wins.
  assert.equal(byLeg.V1.status, 'ACKNOWLEDGED');
  assert.equal(byLeg.V1.receiverStatus, 'LIVE_ACCEPTED');
  assert.equal(byLeg.U.status, 'UNCONFIRMED');
  assert.equal(byLeg.T45R2.status, 'WAITING');
  // Acknowledgement is delivery only — no field here claims an executed bet.
  assert(!Object.keys(byLeg.V1).some((k) => /fill|filled/i.test(k)));
});

const ev = (route: string, prediction: string, created: string) => ({
  route,
  candle_starts_at: '2026-09-18T02:15:00.000Z',
  decision_at: '2026-09-18T02:15:05.095Z',
  prediction,
  delivery_status: 'ACKNOWLEDGED',
  acknowledged_at: '2026-09-18T02:15:11.215Z',
  receiver_status: 'LIVE_ACCEPTED',
  created_at: created,
});

test('V1 abstention does not become a V1 call; T45 R2 is selected instead', () => {
  const d = selectDecision({
    events: [],
    target: { run_mode: 'LIVE', final_side: 0, features: { input_valid: true } },
    fallback: { leg: 'T45R2', side: -1, reason: 'v1 abstained', run_mode: 'LIVE_SHADOW', evidence: { trigger_signed: true }, within_publication_ceiling: true },
  });
  assert.equal(d?.leg, 'T45R2');
  assert.equal(d?.side, 'DOWN');
});

test('the sender journal overrides the baseline for leg and direction (U)', () => {
  const d = selectDecision({
    events: [ev('U', 'YES', '2026-09-18T02:15:10.000Z')],
    target: { run_mode: 'LIVE', final_side: -1, features: { input_valid: true } },
    fallback: { leg: 'V1', side: -1, reason: null, run_mode: 'LIVE_SHADOW' },
  });
  assert.equal(d?.leg, 'U');
  assert.equal(d?.side, 'UP');
});

test('newest journal row wins when several legs exist', () => {
  const d = selectDecision({
    events: [ev('V1', 'YES', '2026-09-18T02:15:10.000Z'), ev('U', 'NO', '2026-09-18T02:15:12.000Z')],
    target: null,
    fallback: null,
  });
  assert.equal(d?.leg, 'U');
  assert.equal(d?.side, 'DOWN');
});

test('non-LIVE or invalid-input V1 is excluded and yields no decision', () => {
  assert.equal(
    selectDecision({
      events: [],
      target: { run_mode: 'RESEARCH', final_side: 1, features: { input_valid: true } },
      fallback: null,
    }),
    null,
  );
  assert.equal(
    selectDecision({
      events: [],
      target: { run_mode: 'LIVE', final_side: 1, features: { input_valid: false } },
      fallback: null,
    }),
    null,
  );
  // A research-mode T45 row is not the live fallback either.
  assert.equal(
    selectDecision({
      events: [],
      target: null,
      fallback: { leg: 'T45R2', side: 1, reason: null, run_mode: 'RESEARCH', evidence: { trigger_signed: true }, within_publication_ceiling: true },
    }),
    null,
  );
});

const t45ok = (side: number, run_mode = 'LIVE_SHADOW') => ({
  leg: 'T45R2', side, reason: null, run_mode,
  evidence: { trigger_signed: true }, within_publication_ceiling: true,
});

test('unsigned or out-of-ceiling T45 is not admitted as a call', () => {
  assert.equal(
    selectDecision({ events: [], target: null, fallback: { ...t45ok(1), evidence: {} } }),
    null,
  );
  assert.equal(
    selectDecision({ events: [], target: null, fallback: { ...t45ok(1), within_publication_ceiling: false } }),
    null,
  );
  assert.equal(selectDecision({ events: [], target: null, fallback: t45ok(0) }), null);
});

test('a U event overrides the V1 baseline for both leg and side', () => {
  const d = selectDecision({
    events: [ev('U', 'NO', '2026-09-18T02:15:09.000Z')],
    target: { run_mode: 'LIVE', final_side: 1, features: { input_valid: true } },
    fallback: t45ok(1),
  });
  assert.equal(d?.leg, 'U');
  assert.equal(d?.side, 'DOWN');
});
