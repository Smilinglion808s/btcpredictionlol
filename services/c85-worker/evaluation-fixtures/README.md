# Retrospective evaluation fixtures (not shipped, not live inputs)

This directory is for the historical parity fixtures from `C85_Lovable_Kit.zip`:

```
auxiliary_scores.parquet        head_validity.parquet      reference_predictions.parquet
auxiliary_training_dataset.parquet  meta55.parquet         replayed_predictions.parquet
direction60.parquet             policy_frame.parquet       replayed_state.parquet
golden_examples.json            upstream_packet.parquet
```

They exist **only** to reproduce the historical reference gate
(19,487 opportunities / 6,794 calls / 4,083 wins / 2,711 losses / raw +1,372 /
zero decision mismatches) and the feature-port parity tests in `tests/`.

They are deliberately kept out of git and out of the Docker build context
(`.gitignore`, `.dockerignore`) because:

- they are ~58 MB of retrospective data,
- the live worker must never read a saved matrix when scoring a boundary.

Live inference reads **only** `services/c85-worker/artifacts/`:

```
artifacts/feature_order.json
artifacts/models/C71_DIRECTION/*.json      198 daily direction heads
artifacts/models/C85_META/*.json           190 daily correctness heads
artifacts/models/auxiliary/YYYYMM_{LONG,RECENT}.pkl   36 monthly bundles
artifacts/fixtures/historical_seed_2026-09-01.json    warmup seed only
```

To run the parity tests locally, unpack the kit's `fixtures/` into this folder.
