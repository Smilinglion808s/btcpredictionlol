# Answer: this project is the predictor only (no changes planned)

## Finding
- No app screen reads `public.bet_history`. A search of `src/` finds no reference to `bet_history`.
- The only mention of the betting project (ruxndqfjfdbtdbkheuge) in `src/` is `src/lib/v12/receiver-destination.ts`. That file holds the webhook address the predictor sends signals to.
- The single betting-related thing on the dashboard is the "U betting account" card in `src/components/v11-card.tsx`. It shows **aggregate counts** only (received, filled, skipped, won, lost, pending, unresolved). The betting receiver's signed status call supplies those counts. The adapter heartbeat stores them in `v12_predictor_runtime.status.u_execution`. They are not individual `bet_history` rows.
- Other `bet_history` references are receiver and executor code that runs on the betting project, not in this site: `services/v12-executor/*`, `supabase/functions/v12-shared/executor.js`, `supabase/functions/v12-shared/execution-status.ts`, and SQL docs in `docs/`.

## Conclusion
This is the predictor dashboard. The live betting dashboard that lists fills from `bet_history` is a different project and is not in this repository.

No edits or deployments.
