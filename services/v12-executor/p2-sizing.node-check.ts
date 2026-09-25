import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateP2, type P2Outcome, type P2Model} from './p2-sizing.ts';

const noon = Date.parse('2026-09-24T18:00:00Z');
const sample = (wins = 3): P2Outcome[] => Array.from({length: 5}, (_, i) => ({
  signalId: String(i), model: 'v12-v1-r1', entryAtMs: noon - (6-i)*900_000,
  knownAtMs: noon - (5-i)*900_000, won: i < wins,
}));
const run = (extra: Partial<Parameters<typeof evaluateP2>[0]> = {}) => evaluateP2({
  atMs: noon, openingCents: 40_000, model: 'v12-v1-r1', outcomes: sample(),
  mode: 'on', enabledAtMs: noon-1, ...extra,
});

test('default, off, and shadow modes keep real budget at baseline', () => {
  for (const mode of [undefined, 'off', 'shadow'] as const) {
    const x = run({mode});
    assert.equal(x.budgetCents, 1600); assert.equal(x.candidateBudgetCents, 3200);
  }
});
test('all three legs use 4/5/10 or 8/10/20 percent', () => {
  for (const [model, base] of [['v12-v1-r1', 1600], ['v12-t45r2-r1', 2000], ['v12-original-u-r1', 4000]] as const) {
    assert.equal(run({model}).budgetCents, base*2);
    assert.equal(run({model, mode:'off'}).budgetCents, base);
  }
});
test('noon inclusive; 18:00 exclusive; DST follows Boise', () => {
  for (const [time, yes] of [
    ['2026-09-24T17:59:59.999Z', false], ['2026-09-24T18:00:00Z', true],
    ['2026-09-24T23:59:59.999Z', true], ['2026-09-25T00:00:00Z', false],
    ['2026-12-01T18:59:59.999Z', false], ['2026-12-01T19:00:00Z', true],
    ['2026-12-02T01:00:00Z', false], ['2026-03-08T18:00:00Z', true],
    ['2026-11-01T19:00:00Z', true],
  ] as const) {
    const atMs = Date.parse(time);
    const outcomes = sample().map(o => ({...o, entryAtMs:o.entryAtMs + atMs-noon, knownAtMs:o.knownAtMs + atMs-noon}));
    assert.equal(run({atMs, outcomes, enabledAtMs:atMs-1}).eligible, yes, time);
  }
});
test('history requires exactly five distinct known calls', () => {
  assert.equal(run({outcomes:sample().slice(0,4)}).multiplier, 1);
  assert.equal(run({outcomes:[...sample().slice(0,4),sample()[0]]}).multiplier, 1);
  assert.equal(run({outcomes:[...sample(),sample()[0]]}).historyCount, 5);
});
test('last five span models and midnight', () => {
  const outcomes = sample().map((o,i) => ({...o, model:(i%2?'v12-t45r2-r1':'v12-original-u-r1') as P2Model,
    entryAtMs:o.entryAtMs-86_400_000,knownAtMs:o.knownAtMs-86_400_000}));
  assert.equal(run({outcomes}).multiplier, 2);
});
test('three wins qualifies, four and five do not', () => {
  for(let w=0;w<=5;w++) assert.equal(run({outcomes:sample(w)}).multiplier,w<=3?2:1);
});
test('future knowledge is excluded and same-time settlement is usable', () => {
  const four=sample().slice(0,4);
  const future={...sample()[4], knownAtMs:noon+1};
  assert.equal(run({outcomes:[...four,future]}).historyCount,4);
  assert.equal(run({outcomes:[...four,{...future,knownAtMs:noon}]}).historyCount,5);
});
test('settlement order controls the window, not entry order', () => {
  const older = {signalId:'old-delayed',model:'v12-v1-r1' as const,entryAtMs:noon-9_000_000,knownAtMs:noon,won:false};
  const out=run({outcomes:[...sample(4),older]});
  assert.equal(out.historyIds[0],'old-delayed'); assert.equal(out.historyWins,3);
  assert.equal(out.multiplier,2);
});
test('invalid/conflicting history falls back to normal sizing', () => {
  assert.equal(run({outcomes:[...sample(),{...sample()[0],won:!sample()[0].won}]}).reason,'INVALID_HISTORY');
  assert.equal(run({outcomes:[...sample(),{...sample()[0],knownAtMs:NaN}]}).multiplier,1);
});
test('old model records do not enter this model history', () => {
  const old = {...sample()[4],model:'v11-r1' as P2Model};
  assert.equal(run({outcomes:[...sample().slice(0,4),old]}).historyCount,4);
});
test('on mode requires an activation timestamp at or before this entry', () => {
  assert.equal(run({enabledAtMs:null}).multiplier,1);
  assert.equal(run({enabledAtMs:noon+1}).multiplier,1);
  assert.equal(run({enabledAtMs:noon}).multiplier,2);
});
test('multiply daily rate before flooring cents; no dollar cap', () => {
  const x=run({openingCents:40_013});
  assert.equal(x.baseBudgetCents,1600); assert.equal(x.budgetCents,3201);
  assert.equal(run({openingCents:1_000_000_00,model:'v12-original-u-r1'}).budgetCents,20_000_000);
  assert.equal(run({openingCents:0}).budgetCents,0);
});
test('reject unsafe amounts and invalid input times', () => {
  for(const openingCents of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>run({openingCents}));
  assert.throws(()=>run({atMs:NaN})); assert.throws(()=>run({model:'unknown' as P2Model}));
});
test('all 5,088 archived entries match the frozen P2 trigger', () => {
  const fixture=JSON.parse(readFileSync(new URL('../../docs/v12-p2/p2-archive-fixture.json',import.meta.url),'utf8'));
  const outcomes:P2Outcome[]=fixture.rows.map((r:any,i:number)=>({signalId:String(i).padStart(6,'0'),
    model:fixture.models[r[2]],entryAtMs:r[0],knownAtMs:r[1],won:r[3]===1}));
  const settlements=outcomes.slice().sort((a,b)=>a.knownAtMs-b.knownAtMs||a.entryAtMs-b.entryAtMs||a.signalId.localeCompare(b.signalId));
  let j=0,boosted=0,wins=0; const history:P2Outcome[]=[];
  for(let i=0;i<fixture.rows.length;i++) {
    const r=fixture.rows[i];
    while(j<settlements.length&&settlements[j].knownAtMs<=r[0])history.push(settlements[j++]);
    const actual=run({atMs:r[0],enabledAtMs:r[0]-1,model:fixture.models[r[2]],outcomes:history.slice(-5)});
    assert.equal(actual.multiplier===2,r[4]===1,'archive row '+i);
    if(actual.multiplier===2){boosted++;wins+=r[3];}
  }
  assert.equal(fixture.rows.length,5088); assert.equal(boosted,723); assert.equal(wins,494);
});
