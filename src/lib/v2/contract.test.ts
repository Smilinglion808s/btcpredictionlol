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

import { sanitizeStatus } from "./contract.ts";
test("eligible only inside [T+8,T+9)", () => {
  assert.equal(validateCheckpoint({ ...base, decision_at: new Date(open + 9000).toISOString() }, open + 9500).ok, false);
  assert.equal(validateCheckpoint({ ...base, decision_at: new Date(open + 7999).toISOString() }, open + 9500).ok, false);
});
test("eligible T45 only inside [T+45,T+46)", () => {
  const t45 = { ...base, checkpoint: "T45", sleeve: "v2-direction45-r1" };
  assert.equal(validateCheckpoint({ ...t45, decision_at: new Date(open + 45_200).toISOString() }, open + 46_000).ok, true);
  assert.equal(validateCheckpoint({ ...t45, decision_at: new Date(open + 46_000).toISOString() }, open + 47_000).ok, false);
});
test("late ineligible audit row with reason accepted", () =>
  assert.equal(validateCheckpoint({ ...base, eligible: false, side: 0, reason: "CHECKPOINT_LATE", decision_at: new Date(open + 12_000).toISOString() }, open + 12_500).ok, true));
test("heartbeat allowlist drops principal/secrets/raw exceptions", () => {
  const s = sanitizeStatus({ mode: "shadow", prediction_ready: true, feed_age_ms: 120.4, principal_cents: 5000, cash: 1,
    secret: "x", errors: ["05:00:01Z score T8: ValueError", "bad {\"raw\": 1} traceback\n"], last_checkpoint: { sleeve: "nope", eligible: false } });
  assert.deepEqual(Object.keys(s).sort(), ["errors", "execution", "feed_age_ms", "last_checkpoint", "mode", "prediction_ready"]);
  assert.deepEqual(s.errors, ["05:00:01Z score T8: ValueError"]);
  assert.equal(s.execution, "OFF");
});

import { deriveSleeveStatus } from "./contract.ts";
const row = (o: any) => ({ checkpoint: "T8", sleeve: "v2-direction8-r1", side: 0, eligible: false, features_ready: true, reason: null, sleeve_name: "ABSTAIN", ...o });
const txt = (r: any) => Object.fromEntries(Object.entries(r).map(([k, v]: any) => [k, v.text]));
test("status: D8 call skips Fade8 and D45", () =>
  assert.deepEqual(txt(deriveSleeveStatus([row({ eligible: true, side: 1, sleeve_name: "Direction8" })], 10_000)),
    { "v2-direction8-r1": "call UP", "v2-fade8-r1": "skipped · earlier call", "v2-direction45-r1": "skipped · earlier call" }));
test("status: Fade8 call -> D8 abstained, D45 skipped", () =>
  assert.deepEqual(txt(deriveSleeveStatus([row({ sleeve: "v2-fade8-r1", eligible: true, side: -1, sleeve_name: "Fade8" })], 10_000)),
    { "v2-direction8-r1": "abstained", "v2-fade8-r1": "call DOWN", "v2-direction45-r1": "skipped · earlier call" }));
test("status: scored T8 ABSTAIN -> no calls, D45 waits then reads its record", () => {
  assert.deepEqual(txt(deriveSleeveStatus([row({})], 20_000)),
    { "v2-direction8-r1": "no call", "v2-fade8-r1": "no call", "v2-direction45-r1": "waiting for 45s" });
  assert.equal(deriveSleeveStatus([row({}), row({ checkpoint: "T45", sleeve: "v2-direction45-r1", eligible: true, side: 1, sleeve_name: "Direction45" })], 50_000)["v2-direction45-r1"].text, "call UP");
});
test("status: failed T8 blocks D45", () => {
  const r = deriveSleeveStatus([row({ features_ready: false, reason: "CHECKPOINT_LATE" })], 50_000);
  assert.equal(r["v2-direction8-r1"].text, "failed · CHECKPOINT_LATE");
  assert.equal(r["v2-direction45-r1"].text, "blocked · 8s not scored");
});
test("status: never fabricates before T8", () =>
  assert.equal(deriveSleeveStatus([], 3_000)["v2-fade8-r1"].text, "waiting for 8s"));
