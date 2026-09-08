# C85 artifact storage and continuation plan

## Decision on "where to store it"

Store the C85 continuation artifacts in three tiers, all inside the existing `services/c85-worker/` tree so the Railway worker can mount and resume from them without new credentials:

1. **Raw feed caches and parity reports**
   - Path: `services/c85-worker/evaluation-fixtures/cache/continuation/`
   - Contents: downloaded Binance/Kalshi archives, live-recovered slices, `LIVE_FEED_ARCHIVE_PARITY_R1.json`, and per-stage checkpoint JSONs.
   - Rationale: already used by the rebuild harness; keeps provenance next to the code that produced it.

2. **Stage outputs and fitted state**
   - Path: `services/c85-worker/evaluation-fixtures/cache/continuation/checkpoints/{stage}.json`
   - Contents: `cursor`, `rows`, `mode`, `updated_at`, `notes`, plus any serialized fitted objects required for restart-resume.
   - Rationale: the harness already writes these; separating by stage makes dependency-order restart cheap.

3. **Published model artifacts**
   - Path: `services/c85-worker/artifacts/models/C85_META/`
   - Contents: final `feature_order.json`, daily model JSONs (e.g. `2026-09-06.json`), and any exported coefficients/checksums.
   - Rationale: matches the existing C85_META layout and is what the Railway worker will load for live predictions.

## Is it good?

Yes, with two small hardening steps:

- Add a `.gitignore`/`README` note that `evaluation-fixtures/cache/continuation/` is machine-generated and should not be committed to git (it will be bundled for Railway via the kit, not via git history).
- Include SHA-256 checksums for every published model artifact so the worker can verify integrity on startup.

## What we will do now

1. Finish the running `LIVE_FEED_ARCHIVE_PARITY_R1.json` report and commit it to the cache path above.
2. Extend `continuation/stages.py` with the missing dependency-ordered stages: C42, Polymarket, C51, C54, C57, C61, C63, C67/C68/C69, C71, and the C85 heads.
3. Run the one-time historical rebuild through those stages, saving checkpoints after each.
4. Copy the final C85_META artifacts into `services/c85-worker/artifacts/models/C85_META/` with checksums.
5. Deploy the worker to Railway with the artifact bundle and prove restart-resume.
6. Begin live prediction logging at the next valid 15-minute boundary, with publication suppressed until operational verification is complete.

C85 betting remains suppressed and T45 execution stays unchanged throughout.
