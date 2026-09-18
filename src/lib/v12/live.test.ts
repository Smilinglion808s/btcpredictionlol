import test from 'node:test';
import assert from 'node:assert/strict';
import { intervalOpen, legsFromEvents, INTERVAL_MS } from './live.server.ts';

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
