# V3 T45 dispatch patch — review artifact (NOT applied)

**Status:** prepared and tested elsewhere. It has **NOT** been applied, deployed or activated. `v3-t45-dispatch-20261008.patch` is a review file only. The runtime source under `services/` and `AGENTS.md` is unchanged.

## Baseline
- Patch baseline: `07d50caa6d9b423ee75e136e1fef425783ce4e05`.
- The later commit `3439746576bf9e55b3d6f39cadd7f62191a4f23c` changed only `.lovable/plan.md`, so the patch's target files are unchanged since the baseline.

## Purpose
- With reversal-risk enforcement active, the `t48-r1` policy dispatches the signed V3 signal from T45, once every enforced gate (the T45 risk gate and any enforced calibration gate) has passed.
- Receiver `entry_at` stays at T48 and `expires_at` stays at T49. The body stays `v3-signal/1`, and retries keep the same event ID and exact bytes.
- Risk-off, shadow mode and `asap-r1` keep their existing timing.
- Prediction models, features, thresholds, sizing, calibration mode and receiver code are unchanged.

## Verification (prior results, not run by this task)
The requesting assistant completed these offline checks before the handoff:
- 127 Python worker/model tests passed.
- 6 Node mocked-receiver timing tests passed.

These are earlier results. This Lovable task did not run them.

## Caveats
- The receiver's shared candle-interval claim can now happen earlier, so the priority between competing legs for the same interval may change.
- There is no guarantee of profit or of a fill, and no guarantee of meeting T49 under every latency.

## Activation
Applying the patch, deploying it and any operational rollout are separate steps controlled by a person. This artifact alone does not make V3 ready to switch on.
