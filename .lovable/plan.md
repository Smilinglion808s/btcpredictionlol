
# AAS96 + TD1 Governance Update

Three coordinated changes. No touches to a96-r1, Cleanup Veto v1.1.0, TD1 feature definitions, TD1 tree-training params, Layer A training, or Layer B expert-calculation math.

## 1. Selector B Confirmation V1 → Shadow only

**Files**
- `src/lib/model7/aas96/orchestrator.ts` — re-order decision pipeline:
  1. Layer A + Layer B
  2. Layer C selector → `preOverrideSelected` / `preOverrideDir`
  3. **Active baseline = Layer C** (`selectedLayer = preOverrideSelected`, `baselineDir = preOverrideDir`)
  4. Evaluate Selector B Confirmation V1 in shadow only; populate `selector_b_confirmation_v1_*` counterfactual fields.
  5. Cleanup Veto v1.1 runs on the Layer C baseline (unchanged rule, new upstream input).
  6. Publish.
- `selector_b_confirmation_v1_applied = false` on all new rows.
- New column `selector_b_confirmation_v1_mode` set to `SHADOW` for new rows; historical rows keep whatever value they had (or NULL).
- Rule (`selectorBConfirmationV1.ts`), version `1.0.0`, threshold `0.0001`, reason string: unchanged.

**Migration**
- Add column `selector_b_confirmation_v1_mode TEXT` on `model7_aas96_shadow` (nullable, no backfill).

**Resolution**
- Grading logic in `resolveAas96Row` already compares pre-override vs shadow-final and stores `selector_b_confirmation_v1_net_effect` (+2 / −2 / 0) — keep as-is; add explicit direction-change flag if missing.

**Stats UI (`src/routes/_authenticated/stats.tsx`, AAS96 card)**
- Rename block to “Selector B Confirmation V1 — Shadow”.
- Show evaluable, triggered, direction-change count, counterfactual W/L/net; add group-by-fit and group-by-day/week subpanels. Filter to `mode = SHADOW` OR `deployed_at >= <shadow cutover ts>` to prevent mixing.

**CSV**: no removals — every existing `selector_b_confirmation_v1_*` column continues to export, plus new `selector_b_confirmation_v1_mode`.

## 2. TD1 incumbent vs candidate promotion

**Schema (new migration)**
- Extend `model7_td1_fits` with: `status` (`training|pending_forward_review|active|rejected|superseded`), `trained_through_candle_ts`, `training_row_count`, `artifact_sha256`, `incumbent_fit_id`, `forward_review_started_at`, `forward_review_completed_at`, `forward_review_resolved_count`, `review_decision`, `review_reason`, `review_report jsonb`, `activated_at`, `rejected_at`.
- Partial unique index: `UNIQUE (base_variant) WHERE status='active'` — enforces single active fit.
- Extend `model7_td1_rc_shadow` with candidate/incumbent columns:
  - `td1_incumbent_fit_id`, `td1_incumbent_loss_probability`, `td1_incumbent_veto_fired`, `td1_incumbent_final_decision`
  - `td1_candidate_fit_id`, `td1_candidate_loss_probability`, `td1_candidate_veto_fired`, `td1_candidate_final_decision`
  - `td1_candidate_evaluable`, `td1_candidate_shadow_only`
  - Post-resolution: `td1_incumbent_would_win/lose/net_score`, `td1_candidate_would_win/lose/net_score`, `td1_candidate_net_effect_vs_incumbent`
  - Tree audit (both incumbent & candidate): `..._tree_leaf_id`, `..._tree_path`, `..._leaf_training_sample_count`, `..._leaf_training_loss_count`, `..._leaf_training_loss_rate`
- New RPC `promote_td1_candidate(p_candidate_fit_id, p_expected_incumbent_fit_id, p_report jsonb)` — verifies status, atomically supersedes active + promotes candidate.
- New RPC `reject_td1_candidate(p_candidate_fit_id, p_reason, p_report jsonb)`.

**Code**
- `src/lib/model7/td1/retrain.ts` — cadence unchanged; new fit persists as `pending_forward_review` with `incumbent_fit_id = <current active>`. Skip retrain when a candidate is already pending.
- `src/lib/model7/td1/decision.ts` — scorer returns leaf audit metadata (leaf id, path, training sample/loss counts).
- `src/lib/model7/td1/orchestrator.ts` — during pending review, score both incumbent and candidate on same feature snapshot; live decision = incumbent only; persist candidate shadow fields.
- New `src/lib/model7/td1/promotion.ts` — resolution-side updater that computes candidate/incumbent per-row net scores; when review window is met, evaluates promotion criteria (net > incumbent; net delta ≥ +3; YES-net delta ≥ −2; NO-net delta ≥ −2; candidate veto net effect > 0; leakage clean; artifact/feature-order integrity). On pass → calls promote RPC; on any mandatory fail → reject RPC.
- Review window: ≥96 resolved evaluable rows AND ≥12 candidate veto triggers, else continue until either condition or hard cap 192.

**Stats UI (TD1 card)**
- New “TD1 Fit Review” section: incumbent id, candidate id, forward resolved count, candidate trigger count, candidate/incumbent net + delta, YES/NO split, veto effect, review status, per-requirement pass/fail badges.

**Tests** — new `src/lib/model7/td1/__tests__/promotion.test.ts` covering the ~19 required assertions using in-memory fits and synthetic prediction rows (pure functions; no DB).

## 3. AAS96 Layer B history bound to original fit

**Schema (new migration)**
- New table `model7_aas96_layer_b_history_episodes`: `history_episode_id uuid PK`, `artifact_fit_id text UNIQUE NOT NULL`, `is_active bool`, `created_at`, `updated_at`, `resolved_count int`, `history_payload jsonb` (h32/h64/h96/h192 arrays).
- Partial unique index: `UNIQUE (is_active) WHERE is_active` — one active episode.
- Extend `model7_aas96_shadow`:
  - `artifact_fit_id_at_prediction text` (nullable; we already store `fit_id` — reuse if it already unambiguously identifies the artifact; add new column only if the existing one is ambiguous).
  - `layer_b_history_episode_id uuid`
  - `layer_b_history_applied_at timestamptz`, `layer_b_history_application_status text`, `layer_b_history_application_error text`
  - `history_episode_ownership_unverified bool default true` (historical rows) — new rows set false.
- New RPC `get_or_mint_aas96_layer_b_episode(p_artifact_fit_id text)` — advisory-locked, mirrors the existing a96 fit-episode pattern.
- New RPC `apply_aas96_layer_b_history(p_prediction_id, p_history_episode_id, p_actual_direction)` — verifies ownership + resolved + not already applied + valid direction, updates episode payload once, sets audit fields on the shadow row.

**Code**
- `src/lib/model7/aas96/fitStore.ts` — episode getter/persister; `updateActiveExpertHistory` becomes `updateEpisodeExpertHistory(episodeId, ...)`.
- `src/lib/model7/aas96/orchestrator.ts`:
  - Prediction path: after loading artifact, get_or_mint episode for `artifact.fitId`; use `episode.history_payload` for Layer B horizon scoring; persist `artifact_fit_id_at_prediction` and `layer_b_history_episode_id` on the row.
  - Resolution path: read the row’s stored `layer_b_history_episode_id`; call the atomic apply RPC; never look up the currently-active fit.
- Fit-boundary: when a new artifact activates (existing training/activation code path), call `get_or_mint` for the new fit → new episode. Do not migrate or backfill.

**Tests** — new `src/lib/model7/aas96/__tests__/layerBHistory.test.ts`: prediction under fit A + activate fit B + resolve; assert episode A updated, episode B untouched; idempotency; ownership mismatch rejected.

## Deliverables at end

- 3 migrations (Selector column, TD1 promotion schema + RPCs, AAS96 episode table + RPCs)
- New files: `td1/promotion.ts`, `td1/__tests__/promotion.test.ts`, `aas96/__tests__/layerBHistory.test.ts`
- Edited: aas96 `orchestrator.ts`, `fitStore.ts`; td1 `orchestrator.ts`, `retrain.ts`, `decision.ts`; stats page card sections; CSV exporters for AAS96 + TD1
- No historical rows modified; no active behavior change beyond the three items above.

Approve to implement.
