# External direction / external rank — contract, wiring, release, continuation

Status date: 2026-09-09. C85 betting remains suppressed; T45 untouched; nothing published.

## 1. Label contract (corrected)

The previous code emitted `direction = 1 if p_up >= .5 else 0` from the c30/c70
head and that value was on a collision course with the leaf key
`external_direction`, which the C42 consumer reads as signed `{-1, +1}` with `0`
meaning "no call".

Authoritative producer chain, traced through recovered source:

```
long_context_model.predictions()          -> external_direction, external_rank
  -> t0_t5_coverage_bridge_audit_r1.py    -> continuous_coverage_ledger.csv
  -> t0_t5_fee_coverage_frontier_r1.py    -> fee_coverage_shadow_ledger.csv
  -> build_c42_maturation_consensus_r1.py -> C42 -> C85
```

`long_context_model.predictions()` (lines 287-291):

- `external_direction` = `+1` when the probability is finite and `>= .5`, `-1`
  when finite and `< .5`, `0` only when the probability is non-finite. There is
  no exact-`.5` abstention; `.5` is a green call.
- `external_rank` = strictly past-only rolling rank of `abs(p - .5)`,
  **lookback 2,880 rows, minimum 960, ties count half**.
- The retain gate (`0.25`) is applied downstream, not inside the pair.

This is a *different rank family* from c30/c70 `directional_past_rank`
(lookback 768, minimum 96, signed direction input). Both now live in
`src/experts/direction_contract.py`, separately named.

The c30/c70 head no longer emits a field called `direction`. It emits
`p_green` (its `p_t0_green` / `p_t5_green`), `class_index` (bookkeeping only)
and `signed_direction`, and its fit ids are now `c30_c70_direction_*`.

### Parity against the archived source ledger

`tests/test_direction_contract.py` recomputes the pair from the recorded
`external_probability_green` column of the archived continuous ledger
(19,780 rows, 2026-02-06T23:00Z .. 2026-08-31T23:45Z):

| check | result |
| --- | --- |
| direction mismatches | 0 |
| direction value counts | -1: 8,890 / +1: 7,955 / 0: 2,935 |
| rank finiteness mismatches | 0 |
| max absolute rank difference | 1.11e-16 |
| rows with probability exactly .5 | 0 |

Report: `docs/direction_contract_parity.json`.

Note on the below/at/above-.5 case: the archived window contains **no** exact
`.5` row, so the tie branch is proven by the unit tests against the source
expression, not by archived data. That is stated rather than glossed.

## 2. Rank state bug found and fixed

The first incremental implementation kept a deque of the last 2,880 *finite*
values. The original slices `values[index - lookback:index]` — the last 2,880
**rows**, NaNs included, filtered afterwards. On the archived ledger, which has
2,935 rows without a probability, the two disagreed on 12,797 / 19,780 rows
(64.7%, max difference 0.0168). `RollingRankState` now stores `(position,
value)` pairs, prunes by row position, and persists its position counter.

Consequence for callers, enforced by test: `observe` must be called for
**every** target in the series, including targets with no probability.

## 3. Leaf wiring

`LeafExperts` now takes a `LongContextLeafProducer` and computes
`external_direction` / `external_rank` itself; a value supplied on the packet
can no longer override the computed one. `allow_supplied` (default True for
archived replay and tests) must be set False in production so a pre-computed
number cannot masquerade as a live computation. The other seven keys remain
fail-closed and `UNPORTED`.

**Blocker, unchanged:** the probability source. The frozen head
`T0_LONG_CONTEXT_R1` (`ALL_HGB`, 324 features, retain 0.25, policy
`ALL_HGB::CONF_GLOBAL_Q25`) exists in recovery only as freeze metadata. No
fitted head and no long-context feature pickle were found. So the pair computes
correctly *from a probability* and produces nothing live today.

## 4. Release: gated, relocatable, hash-verified before unpickling

`tools/build_external_direction_release.py` is the publication step the refit
never had:

- re-checks each recorded metric against explicit tolerances (5e-3) plus the
  frozen `BINANCE_HYPERLIQUID` / `C=0.03` selection and the retained feature
  lists, and **rejects before copying any artifact** if a gate fails (tested);
- copies artifacts under the release root with **relative** paths;
- records SHA-256 per artifact, library versions and the input report hash.

`ExternalDirectionModel.load_release()` hashes every artifact **before**
`joblib.load`, rejects manifest paths that escape the root, and validates
stage/phase/source-set/C/feature-count/class-labels/window metadata and
non-overlapping, sorted scoring windows.

Published to: `/mnt/documents/.lovable/c85-cache/releases/external_direction_r1`
(6 artifacts + `manifest.json`). Verified by moving a build to an unrelated
clean path and scoring identically with the build location gone.

**Honest limits:**
- This is still the same mount. It is *not* proof of provider durability, and
  Railway cannot read it. A Railway volume or private bucket is still required.
- "Derived-matrix parity" compares the reconstructed artifact through the
  transcribed matrix, batch versus row. That is an assembly test. Independent
  parity against *recorded original scores* is still missing, because no
  recorded c30/c70 per-row probability ledger has been recovered.
- Source set and `C` were selected on May–June, so Feb–Apr / May–Jun
  reproduction is **not** unbiased out-of-sample evidence. Historical
  performance is not reinterpreted here.

## 5. Continuation authority — model-spec gap, not a decision

No frozen C85 implementation or export specification defining external-direction
updates after Jul–Aug has been found. What exists:

- `long_context_model.py`: a 17,280-row rolling training window with a refit
  every 96 targets, running to its research cutoff. This is the *long-context*
  head, not the c30/c70 head.
- The three c30/c70 phases (feb_apr / may_jun / jul_aug, scoring windows ending
  Sep 1) are fixed **experimental partitions** in the lab manager. Nothing in
  the recovered source states a recurring live cadence or an expiry rule.

Therefore: **no September refit is invented and no expiry is extended.** Scoring
a target past the last scheduled window raises `ExternalDirectionUnavailable`.
Also noted: a fit dated Sep 1 would normally require labels available *before*
its cutoff, so later September outcomes cannot be used to justify it.

This is the exact spec gap that needs an authority decision before any current
scoring.

## 6. Still unresolved (unchanged, restated so nothing reads as done)

Long-context head artifact; the other seven leaf producers; whole-chain current
readiness; atomic DB lease fencing; Railway durable artifact/checkpoint release
and restore; restart-resume proof on Railway; signed fresh logging; and the
T+5 publication-deadline conflict. C85 is not live.

## 7. Next dependency

Recover or re-fit the `T0_LONG_CONTEXT_R1` head. Searched recovery for it:
`long_context_output/` contains only descriptive CSVs, the robustness audit and
`T0_LONG_CONTEXT_R1_FREEZE.json` — **no fitted head artifact and no feature
frame pickle anywhere in the cache.**

What *is* present is the producing source: `build_long_context_features.py` and
`long_context_model.py` (three copies each, matching hashes). So the same route
already used for the c30/c70 head is available: rebuild the long-context feature
frame from saved sources, then execute the original fitting schedule causally
(17,280-row window, refit every 96 targets, `ALL_HGB`, 324 features, retain
0.25) and gate the result against the archived
`external_probability_green` column — which gives a genuine recorded-score
parity check, the one the c30/c70 head lacks.

That is the next bounded step. It requires a feature rebuild, so it is not
folded into this task.

If a fitted artifact does exist in your kits, the exact names to transfer are
the `ALL_HGB` head serialisation under
`T0_EXTERNAL_RESOURCE_HUNT_R1/external_research/long_context_output/` and the
long-context feature frame that `long_context_model.py` loads — supplying them
would skip the rebuild entirely.
