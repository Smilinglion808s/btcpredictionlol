# V1.2 execution engine with an operator release gate

This directory supplies the receiver executor bundle. It copies
the existing version-155 engine's durable intent, cancellation confirmation,
partial-fill accounting and ambiguous-response protections. Changes make the
execution route explicit: V1/U can submit maker orders only; T45R2 can submit
taker orders only. A rejected or partially filled maker cannot fall back to a
taker. Unknown cancellation state still requires reconciliation.

`route-policy.ts` binds the exact route identity, timing, original U value
check, percentage and shared Boise-day opening snapshot. Missing snapshots
block the budget; no flat-dollar fallback. The conservative U admission test
still includes its original fee allowance and penny reserve even when a
maker fill is assumed to have zero fees.

`live.ts` consumes only a durable LIVE_ACCEPTED receipt from record_v12_signal.
That RPC binds the release switch, activation time, existing daily_balance
snapshot and interval claim. The signed predictor adapter revalidates U against
current committed V1/T45 decisions. Execution rechecks activation and the bot
pause before submission and uses bet_history's shared unique claim, durable
order intent, current available cash and existing settlement reconciliation.

The existing `place-trade` function remains untouched. Deployment leaves the
V1.2 release switch in shadow. See docs/v12-activation.md for operator controls;
shadow pipeline evidence does not establish a real-money fill.
