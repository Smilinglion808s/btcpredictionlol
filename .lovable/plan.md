Make **A2 Conflict (SKIP on override conflicts)** the active model, mirroring the earlier B2→B4.2 swap. No changes to A2's scoring, filters, or B4.2's tracking logic.

## 1. Webhook source swap (`src/lib/webhooks.server.ts` + `src/lib/model7/shadow.ts`)
- Add `A2_CONFLICT_MODEL_ID` + `A2_CONFLICT_DECISION_POLICY_VERSION` constants and a `buildA2ConflictWebhookPayload` builder in `webhooks.server.ts` (shape mirrors `buildB4_2WebhookPayload`, sourced from the A2_Conflict shadow row + prediction row; SKIP → `"NO CLEAR EDGE"`).
- In `shadow.ts`:
  - Remove the `deliverWebhook("prediction.created", buildB4_2WebhookPayload(...))` block in the B4.2 path (lines ~512–517), plus its api_runs log.
  - In the A2 policies loop, after the `A2_Conflict` row is inserted, emit `deliverWebhook("prediction.created", buildA2ConflictWebhookPayload(...))` guarded by try/catch + api_runs log, exactly once per prediction.
- Keep B4.2 scoring, state machine, and DB writes untouched — only its webhook emission is removed.

## 2. New server functions for A2 Conflict (`src/lib/predictions.functions.ts`)
- Add `getVariantA2ConflictLatest` and `listVariantA2ConflictRecent` — copies of the existing `getVariantB4_2Latest` / `listVariantB4_2Recent` with `.eq("variant", "A2_Conflict")`.
- Leave B4.2 functions in place (still used by the shadow grid slot).

## 3. Home page hero (`src/routes/_authenticated/index.tsx`)
- Swap imports/queries from `getVariantB4_2Latest` / `listVariantB4_2Recent` to the new A2 Conflict versions.
- Update query keys (`a2c-latest`, `a2c-recent`) and realtime invalidation keys accordingly.
- Copy/labels: "Model 7 Variant B4.2" → "Model 7 Variant A2 Conflict" wherever surfaced.

## 4. Stats page hero (`src/routes/_authenticated/stats.tsx`)
- `b2Hero` (currently `m7Q.data?.B4_2`) → source from `m7Q.data?.A2_Conflict`; rename variable and hero labels to "A2 Conflict (SKIP on override conflicts)".
- `b2RecentFn` currently uses `listVariantB4_2Recent` for the hero's recent trades — switch to `listVariantA2ConflictRecent`.
- Move B4.2 back into the shadow grid group (its slot before A2 promotion), and remove A2_Conflict from the A2 grid trio (it becomes hero-only). A2_MidBand and A2_Combined remain in the A2 grid.
- CSV export buttons unchanged (all variants still downloadable).

## 5. Notes / no-ops
- No DB schema changes; A2_Conflict rows and columns already exist.
- No changes to A2 filter logic, B4.2 state machine, resolver grading, or pre-warm cache.
- No new pg_cron jobs.

## Technical detail
Only one `prediction.created` webhook is emitted per candle after this change — from the A2_Conflict row. If A2 inputs are unusable (fail-closed → decision null), no webhook is sent for that candle, matching current fail-closed behavior. Since A2_Conflict is a strict subset of Variant A trades (only converts YES→SKIP on `upstream_no_clear_edge` conflicts), the bot will receive fewer or equal signals per day vs. B4.2.
