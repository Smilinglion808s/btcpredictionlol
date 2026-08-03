# Prepare the display slot for V6

Model 3 (Selective Edge) has been removed from the stats page, engine and CSV exports. The grid slot it occupied is now free and will be filled by the new standalone model, **V6**.

Per your choice, no code is written until the V6 spec/package arrives. This plan records exactly what gets built the moment it lands.

## What will be built when the spec arrives

1. **V6 stats card** in the old Model 3 position on the Stats page, using the shared `ModelCard` component so it matches TD1-RC and a96 visually.
   - Header: title "V6", version tag as subtitle, Auto status pill.
   - Headline: overall win rate.
   - Counters: wins, losses, pushes, pending.
   - Current prediction for the pending candle (with timestamp), and a skip/abstain reason line when V6 stands down.
   - One "CSV" button in the card header (no separate Fits button).

2. **Live refresh** — the card polls its stats/pending server functions on the same cadence as the other cards and re-fetches on realtime inserts into V6's own predictions table.

3. **CSV export** — V6 gets its own standalone export: one row per V6 prediction with every field the engine records, downloadable from both the card button and the CSV Data section of the History page.

4. **Standalone wiring** — V6 stores to its own table, computes its own stats, and does not read or alter any other model's decisions. No outbound webhooks unless you ask for them (TD1-RC stays the only webhook source).

## Technical notes

- Card renders in `src/routes/_authenticated/stats.tsx` at the freed grid position; export buttons in `src/routes/_authenticated/history.tsx`.
- Engine lives in a new `src/lib/v6/` folder with `config.ts`, feature/scoring modules and `orchestrator.ts`, invoked from the shared per-candle shadow runner (same hook point Model 3 used) and resolved on candle close.
- A migration creates the V6 predictions table (plus a fits table if V6 retrains) with grants and RLS, once the spec defines the columns.

## Next step

Send the V6 package (spec/JSON/PDF). Implementation then covers migration, engine, card and CSV in one pass.
