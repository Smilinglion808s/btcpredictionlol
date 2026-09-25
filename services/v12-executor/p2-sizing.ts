/** P2 calculator only. No credentials, network access, or order submission. */
export const P2_VERSION = 'v12-p2-afternoon-r1';
export const P2_MODEL_IDS = ['v12-v1-r1', 'v12-t45r2-r1', 'v12-original-u-r1'] as const;
export type P2Model = typeof P2_MODEL_IDS[number];
export type P2Mode = 'off' | 'shadow' | 'on';
export type P2Outcome = Readonly<{
  signalId: string;
  model: P2Model;
  entryAtMs: number;
  knownAtMs: number;
  won: boolean;
}>;
const PERCENT: Record<P2Model, number> = {
  'v12-v1-r1': 4, 'v12-t45r2-r1': 5, 'v12-original-u-r1': 10,
};
const hourFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Boise', hour: '2-digit', hourCycle: 'h23',
});

export function evaluateP2(input: Readonly<{
  atMs: number;
  openingCents: number;
  model: P2Model;
  outcomes: readonly P2Outcome[];
  mode?: P2Mode;
  enabledAtMs?: number | null;
}>) {
  const {atMs, openingCents, model} = input;
  const mode = input.mode ?? 'off';
  if (!Number.isSafeInteger(atMs) || !Number.isFinite(new Date(atMs).getTime())) throw Error('INVALID_ENTRY_TIME');
  if (!Number.isSafeInteger(openingCents) || openingCents < 0) throw Error('INVALID_DAY_OPENING');
  if (!P2_MODEL_IDS.includes(model)) throw Error('INVALID_P2_MODEL');
  if (!['off', 'shadow', 'on'].includes(mode)) throw Error('INVALID_P2_MODE');
  const basePercent = PERCENT[model];
  const calculate = (multiplier: number) => Number(BigInt(openingCents) * BigInt(basePercent * multiplier) / 100n);
  const seen = new Map<string, P2Outcome>();
  let invalid = false;
  for (const row of input.outcomes) {
    if (!P2_MODEL_IDS.includes(row.model)) continue;
    if (!row.signalId || !Number.isSafeInteger(row.entryAtMs) || !Number.isSafeInteger(row.knownAtMs) ||
        row.knownAtMs < row.entryAtMs || typeof row.won !== 'boolean') {
      invalid = true; continue;
    }
    if (row.knownAtMs > atMs) continue;
    const existing = seen.get(row.signalId);
    if (existing && (existing.model !== row.model || existing.won !== row.won ||
        existing.entryAtMs !== row.entryAtMs || existing.knownAtMs !== row.knownAtMs)) {
      invalid = true; continue;
    }
    seen.set(row.signalId, row);
  }
  const lastFive = [...seen.values()].sort((a, b) =>
    b.knownAtMs - a.knownAtMs || b.entryAtMs - a.entryAtMs ||
    (a.signalId === b.signalId ? 0 : a.signalId < b.signalId ? 1 : -1)).slice(0, 5);
  const hour = Number(hourFormat.formatToParts(atMs).find(p => p.type === 'hour')!.value);
  const inWindow = hour >= 12 && hour < 18;
  const wins = lastFive.filter(row => row.won).length;
  const eligible = !invalid && inWindow && lastFive.length === 5 && wins <= 3;
  const authorized = mode === 'on' && Number.isSafeInteger(input.enabledAtMs) && input.enabledAtMs! <= atMs;
  const candidateMultiplier = eligible ? 2 : 1;
  const multiplier = eligible && authorized ? 2 : 1;
  const reason = invalid ? 'INVALID_HISTORY' : !inWindow ? 'OUTSIDE_BOISE_WINDOW' :
    lastFive.length < 5 ? 'HISTORY_WARMUP' : wins > 3 ? 'FOUR_OR_FIVE_WINS' :
    !authorized ? mode === 'on' ? 'NOT_YET_ENABLED' : 'P2_' + mode.toUpperCase() : 'P2_BOOST';
  return {
    version: P2_VERSION, mode, evaluatedAtMs: atMs, hour, inWindow, eligible, reason,
    historyCount: lastFive.length, historyWins: wins,
    historyIds: lastFive.map(row => row.signalId), basePercent,
    multiplier, candidateMultiplier, effectivePercent: basePercent * multiplier,
    baseBudgetCents: calculate(1), budgetCents: calculate(multiplier),
    candidateBudgetCents: calculate(candidateMultiplier),
  };
}
