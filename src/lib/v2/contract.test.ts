import test from "node:test";
import assert from "node:assert/strict";
import { selectIntent, v2StakeCents, validateCheckpoint, V2_EXECUTION } from "./contract.ts";

const open = Date.UTC(2026, 8, 29, 5, 0, 0);
const base = { candle_open: new Date(open).toISOString(), checkpoint: "T8", sleeve: "v2-direction8-r1", side: 1,
  probability: 0.6, eligible: true, features_ready: true, reason: null, decision_at: new Date(open + 8500).toISOString(), payload: {} };

test("execution is a literal OFF", () => assert.equal(V2_EXECUTION, "OFF"));
test("valid checkpoint", () => assert.equal(validateCheckpoint(base, open + 9000).ok, true));
test("rejects previous interval", () => assert.equal(validateCheckpoint(base, open + 900_000).ok, false));
test("rejects sleeve/checkpoint mismatch", () =>
  assert.equal(validateCheckpoint({ ...base, sleeve: "v2-direction45-r1" }, open + 9000).ok, false));
test("rejects eligible without features", () =>
  assert.equal(validateCheckpoint({ ...base, features_ready: false }, open + 9000).ok, false));
test("priority D8 > F8 > D45", () => {
  assert.equal(selectIntent([{ sleeve: "v2-fade8-r1", eligible: true, side: -1 }, { sleeve: "v2-direction8-r1", eligible: true, side: 1 }]), "v2-direction8-r1");
  assert.equal(selectIntent([{ sleeve: "v2-direction45-r1", eligible: true, side: 1 }, { sleeve: "v2-fade8-r1", eligible: true, side: -1 }]), "v2-fade8-r1");
  assert.equal(selectIntent([{ sleeve: "v2-direction8-r1", eligible: false, side: null }]), null);
});
test("stake 4% floor cents, $200 cap", () => {
  assert.equal(v2StakeCents(12_345), 493);
  assert.equal(v2StakeCents(10_000_000), 20_000);
  assert.equal(v2StakeCents(0), null);
});
