# Remove a96 and AAS96

Rip the a96 / AAS96 chain out of the live system. All stored rows stay in the database, and the all-models Universal CSV keeps its historical a96 and AAS96 columns.

## What changes

- a96 and AAS96 stop running on every 15-minute cycle: no new predictions, no new shadow rows, no resolution passes.
- The per-model "a96 CSV" and "AAS96 CSV" download buttons are removed from the CSV Data page.
- a96 outbound webhook code is deleted (already disabled today).
- Stats page is unaffected — neither model has a card there anymore.
- Universal CSV is unchanged in shape: a96 and AAS96 columns keep populating from the existing stored rows, so past history stays intact.

## Technical detail

Remove from the run path:
- `src/lib/model7/shadow.ts`: drop the `runAas96Shadow` and `runA96` invocations (~lines 534-540) and the `resolveAas96Row` / `resolveA96` resolution calls (~lines 786-790).
- Delete `src/lib/a96/` (config, engine, features, orchestrator, types, tests) and `src/lib/model7/aas96/`.

Remove from the UI and server functions:
- `src/routes/_authenticated/history.tsx`: drop the a96 and AAS96 export buttons, their `useServerFn` bindings and imports, and update the descriptive copy.
- `src/lib/predictions.functions.ts`: delete `getAas96ShadowStats`, `getAas96ShadowPending`, `getAas96VetoStats`, `exportAas96Shadow`, `getA96Stats`, `getA96Pending`, `resetA96VisualStats`, `exportA96Csv` and any other a96-only helpers.

Remove webhook code:
- `src/lib/webhooks.server.ts`: delete `buildA96WebhookPayload`, the a96 SKIP payload builder, the a96 policy/model constants, and any dispatch branch that references them.

Keep untouched:
- `src/lib/universal_export/*` — still reads `a96_predictions` and `model7_aas96_shadow` rows and emits the same columns.
- The universal-CSV row loaders in `src/lib/predictions.functions.ts` that page those two tables.
- All database tables, RPCs (`resolve_a96_prediction`, `get_or_mint_a96_fit_episode`, `apply_aas96_layer_b_history`, etc.), and stored rows.

Verification: typecheck, run the existing test suite (a96 tests are deleted with the module), confirm a 15m run completes with no a96/AAS96 work and that the Universal CSV export still produces populated a96/AAS96 columns for historical candles.
