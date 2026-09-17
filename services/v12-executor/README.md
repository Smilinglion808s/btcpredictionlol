# Prepared V1.2 execution engine

This directory is a tested code candidate, not a deployed receiver. It copies
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

The caller must supply the existing durable shared interval claim and an
authoritative day-opening snapshot. It must also revalidate current U
eligibility against V1/T45 before claiming. These dependencies are not invented
here. No network credentials, endpoint, cron, or financial activation is added.

The existing live `place-trade` function remains untouched. Do not treat this
directory as an activated trading system or the shadow pipeline as a fill test.
