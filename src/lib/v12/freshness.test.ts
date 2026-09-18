import test from 'node:test';
import assert from 'node:assert/strict';
import { freshness, INTERVAL_MS } from './freshness.ts';

const open = Math.floor(Date.parse('2026-09-18T02:15:00.000Z') / INTERVAL_MS) * INTERVAL_MS;

test('a fresh read inside the interval is usable and reads live', () => {
  const t = open + 60_000;
  const f = freshness({ serverNow: t, intervalOpen: open, clientAt: t, tick: t, error: false });
  assert.equal(f.usable, true);
  assert.equal(f.stale, false);
  assert.equal(f.label, 'live');
});

test('a stalled poll ages and stops being usable after ten seconds', () => {
  const t = open + 60_000;
  const f = freshness({ serverNow: t, intervalOpen: open, clientAt: t, tick: t + 25_000, error: false });
  assert.equal(f.ageSec, 25);
  assert.equal(f.usable, false);
  assert.match(f.label, /stale/);
});

test('a failed fetch across the rollover cannot keep the old call marked current', () => {
  const t = open + 840_000; // 14 minutes in
  const f = freshness({ serverNow: t, intervalOpen: open, clientAt: t, tick: t + 120_000, error: false });
  assert.equal(f.rolledOver, true);
  assert.equal(f.usable, false);
  assert.equal(f.shownOpen, open + INTERVAL_MS);
  assert.equal(f.label, 'new interval — updating');
});

test('a skewed client clock does not fake staleness (server offset applied)', () => {
  const t = open + 60_000;
  const f = freshness({ serverNow: t, intervalOpen: open, clientAt: t - 300_000, tick: t - 300_000, error: false });
  assert.equal(f.ageSec, 0);
  assert.equal(f.usable, true);
});

test('before the first reply the state is connecting, not stale', () => {
  const f = freshness({ serverNow: null, intervalOpen: null, clientAt: null, tick: open, error: false });
  assert.equal(f.connecting, true);
  assert.equal(f.usable, false);
  assert.equal(f.label, 'connecting');
});

test('an errored read is a connection issue and is never usable', () => {
  const t = open + 60_000;
  const f = freshness({ serverNow: t, intervalOpen: open, clientAt: t, tick: t, error: true });
  assert.equal(f.usable, false);
  assert.equal(f.label, 'connection issue');
});
