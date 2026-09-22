import test from 'node:test';
import assert from 'node:assert/strict';
import { t45Decide, t45ConfidenceRank } from './head.ts';
import { T45_RANK_THRESHOLD, T45_RANK_MIN_HISTORY } from './config.ts';

assert.equal(T45_RANK_THRESHOLD, 0.72);

/** Build a prior-confidence history whose midrank for `confidence` is exact. */
function historyForRank(confidence: number, rank: number, n = 256): number[] {
  const below = Math.round(rank * n);
  const history: number[] = [];
  for (let i = 0; i < below; i++) history.push(confidence - 0.001 * (i + 1));
  while (history.length < n) history.push(confidence + 0.001 * (history.length - below + 1));
  return history;
}

test('rank exactly at 0.72 trades; immediately below abstains', () => {
  // probability 0.5 ± 0.1 → confidence 0.1; direction follows the sign.
  for (const p of [0.6, 0.4]) {
    const side = p >= 0.5 ? 1 : -1;
    const at = t45Decide(p, historyForRank(0.1, 0.72));
    assert.equal(at.confidenceRank, 0.72);
    assert.equal(at.activeWouldTrade, true);
    assert.equal(at.activePrediction, side);
    assert.equal(at.activeSleeve, 'Q375');

    const justBelow = t45Decide(p, historyForRank(0.1, 0.719));
    assert(justBelow.confidenceRank! < 0.72);
    assert.equal(justBelow.activeWouldTrade, false);
    assert.equal(justBelow.activePrediction, 0);
    assert.equal(justBelow.activeSleeve, 'NONE');
  }
});

test('rank above 0.72 trades', () => {
  const above = t45Decide(0.6, historyForRank(0.1, 0.85));
  assert(above.confidenceRank! > 0.72);
  assert.equal(above.activeWouldTrade, true);
});

test('missing rank history blocks eligibility — never trades', () => {
  for (const prior of [[], [0.1, 0.2, 0.3], new Array(T45_RANK_MIN_HISTORY - 1).fill(0.1)]) {
    const d = t45Decide(0.9, prior);
    assert.equal(d.confidenceRank, null);
    assert.equal(d.activeWouldTrade, false);
    assert.equal(d.activePrediction, 0);
  }
  // Non-finite entries do not count toward the minimum history.
  const dirty = new Array(300).fill(Number.NaN);
  assert.equal(t45ConfidenceRank(0.4, dirty).rank, null);
  assert.equal(t45Decide(0.9, dirty).activeWouldTrade, false);
});
