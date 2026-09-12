import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const T = (n: number) => new Date(Date.UTC(2027, 0, 1, 0, 15 * n)).toISOString();
const results: string[] = [];
const ok = (n: string, c: boolean, extra = "") => results.push(`${c ? "PASS" : "FAIL"} ${n}${extra ? " " + extra : ""}`);

const saved = (await sb.from("v11_state").select("*").eq("state_key", "v11-shadow").maybeSingle()).data as any;
const cleanup = async () => {
  for (const t of ["v11_decisions", "v11_scores", "v11_context_rows"]) {
    await sb.from(t).delete().gte("target_ts", T(0));
  }
  await sb.from("v11_state").update({ last_processed_ts: saved.last_processed_ts, state_version: saved.state_version }).eq("state_key", "v11-shadow");
};
await cleanup();

const score = (ts: string) => ({ ticker: "TEST", head_date: null, run_mode: "RESEARCH", probability: null, confidence: null, rank: null, rank_history: 0, availability: null, admission_gate: null, valid: false, reason: "TEST" });
const dec = (ts: string, side = 0, leg: string | null = null) => ({ ticker: "TEST", event_key: `TEST|${ts}`, leg, side, reason: "TEST", probability: null, rank: null, admission_gate: null, head_date: null, v1_status: null, v1_reason: null, v1_final_side: null, v1_floor_open: null, v1_send_claim: "none", run_mode: "RESEARCH", evidence: { test: true } });

const call = async (ts: string, prev: string | null, ver: number | null, backfill = false, d = dec(ts)) => {
  const { data, error } = await sb.rpc("v11_commit_observation", {
    p_target_ts: ts, p_score: score(ts), p_decision: d,
    p_expected_prev_ts: prev, p_expected_state_version: ver, p_allow_backfill: backfill,
  });
  if (error) throw error;
  return data as any;
};

// context rows so predecessor checks see a chain
for (let i = 0; i < 4; i++) {
  await sb.from("v11_context_rows").insert({ target_ts: T(i), ticker: "TEST", feats: {}, label: null, settlement_ts: null });
}

const st0 = (await sb.from("v11_state").select("*").eq("state_key", "v11-shadow").maybeSingle()).data as any;

// 1. stale expected state rejected
const r1 = await call(T(0), "1999-01-01T00:00:00Z", st0.state_version, true);
ok("stale prior state rejected", r1.committed === false && r1.stale === true, JSON.stringify(r1.reason));

// 2. normal commit with backfill (target is far ahead of checkpoint => gap unless backfill)
const r2 = await call(T(0), st0.last_processed_ts, st0.state_version, true);
ok("backfill commit applies", r2.committed === true && r2.score_written && r2.decision_written);

// 3. gap: skipping T(1) -> commit T(3) without backfill
const st1 = (await sb.from("v11_state").select("*").eq("state_key", "v11-shadow").maybeSingle()).data as any;
const r3 = await call(T(3), st1.last_processed_ts, st1.state_version, false);
ok("skipped opportunity rejected", r3.committed === false && r3.gap === true, JSON.stringify(r3.first_missing_ts));

// 4. duplicate is a no-op, not a second pair
const r4 = await call(T(0), st1.last_processed_ts, st1.state_version, true);
const cnt = (await sb.from("v11_decisions").select("target_ts", { count: "exact", head: true }).eq("target_ts", T(0))).count;
ok("duplicate no-op, one canonical pair", r4.duplicate === true && cnt === 1);

// 5. partial crash: score present, decision missing -> repaired into one canonical pair
await sb.from("v11_decisions").delete().eq("target_ts", T(1));
await sb.from("v11_scores").delete().eq("target_ts", T(1));
await sb.from("v11_scores").insert({ target_ts: T(1), ...score(T(1)) });
const st2 = (await sb.from("v11_state").select("*").eq("state_key", "v11-shadow").maybeSingle()).data as any;
const r5 = await call(T(1), st2.last_processed_ts, st2.state_version, true);
const c5s = (await sb.from("v11_scores").select("target_ts", { count: "exact", head: true }).eq("target_ts", T(1))).count;
const c5d = (await sb.from("v11_decisions").select("target_ts", { count: "exact", head: true }).eq("target_ts", T(1))).count;
ok("partial pair repaired", r5.committed === true && c5s === 1 && c5d === 1, JSON.stringify(r5.repaired));

// 6. concurrent same target: exactly one commit, one pair
await sb.from("v11_decisions").delete().eq("target_ts", T(2));
await sb.from("v11_scores").delete().eq("target_ts", T(2));
const st3 = (await sb.from("v11_state").select("*").eq("state_key", "v11-shadow").maybeSingle()).data as any;
const rc = await Promise.all([0, 1, 2].map(() => call(T(2), st3.last_processed_ts, st3.state_version, true)));
const committed = rc.filter((r) => r.committed === true && r.duplicate !== true).length;
const c6 = (await sb.from("v11_decisions").select("target_ts", { count: "exact", head: true }).eq("target_ts", T(2))).count;
ok("concurrent commits serialise", committed === 1 && c6 === 1, JSON.stringify(rc.map((r) => [r.committed, r.duplicate, r.stale])));

// 7. out-of-order (older than checkpoint) rejected
const st4 = (await sb.from("v11_state").select("*").eq("state_key", "v11-shadow").maybeSingle()).data as any;
await sb.from("v11_decisions").delete().eq("target_ts", T(0));
await sb.from("v11_scores").delete().eq("target_ts", T(0));
const r7 = await call(T(0), st4.last_processed_ts, st4.state_version, false);
ok("out-of-order target rejected", r7.committed === false && r7.out_of_order === true);

// 8. checkpoint is monotonic
const st5 = (await sb.from("v11_state").select("*").eq("state_key", "v11-shadow").maybeSingle()).data as any;
ok("checkpoint monotonic", Date.parse(st5.last_processed_ts) >= Date.parse(st4.last_processed_ts) && st5.state_version > st0.state_version);

// 9. V1 exclusion is evaluated inside the transaction
await sb.from("v11_decisions").delete().eq("target_ts", T(3));
await sb.from("v11_scores").delete().eq("target_ts", T(3));
const st6 = (await sb.from("v11_state").select("*").eq("state_key", "v11-shadow").maybeSingle()).data as any;
const r9 = await call(T(3), st6.last_processed_ts, st6.state_version, true, dec(T(3), 1, "T45R2"));
ok("fallback call excluded when no V1 abstention row exists", r9.committed === false && r9.excluded === true, JSON.stringify({ c: r9.committed, e: r9.excluded }));

// 10-12. Cross-model run-mode mapping. V1 speaks 'LIVE'; V11 speaks
// 'LIVE_SHADOW'. A naive equality test blocks every real fallback, so prove the
// eligible pair passes and the invalid origin still fails.
const v1Row = async (ts: string, runMode: string) => {
  const { data, error } = await sb.from("c85_targets").insert({
    model_version: "lite-a-floor4-top10-r1",
    ticker: "TEST", target_open_utc: ts, deadline_utc: ts,
    run_mode: runMode, status: "SETTLED", final_side: 0, webhook_status: null,
    features: { input_valid: true, lite_a: { reason: "CONFIDENCE_ABSTAIN" }, daily_floor: { ordinary_floor_allows: true } },
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
};
const dropV1 = async (ts: string) => { await sb.from("c85_targets").delete().eq("target_open_utc", ts).eq("ticker", "TEST"); };

const liveDec = (ts: string, mode: string) => ({ ...dec(ts, 1, "T45R2"), run_mode: mode, publication_ceiling_ms: 60000 });

// eligible: V1 LIVE abstention + V11 LIVE_SHADOW fallback call
await sb.from("v11_decisions").delete().eq("target_ts", T(3));
await sb.from("v11_scores").delete().eq("target_ts", T(3));
await dropV1(T(3));
await v1Row(T(3), "LIVE");
const stA = (await sb.from("v11_state").select("*").eq("state_key", "v11-shadow").maybeSingle()).data as any;
const r10 = await call(T(3), stA.last_processed_ts, stA.state_version, true, liveDec(T(3), "LIVE_SHADOW"));
ok("eligible V1 LIVE + V11 LIVE_SHADOW fallback commits", r10.committed === true && !r10.excluded && r10.effective_run_mode === "LIVE_SHADOW", JSON.stringify({ mode: r10.effective_run_mode, off: r10.commit_offset_ms }));

// late commit: the transaction clock, not the caller's stamp, decides the mode
const P = "2026-01-02T00:00:00.000Z";
await sb.from("v11_decisions").delete().eq("target_ts", P);
await sb.from("v11_scores").delete().eq("target_ts", P);
await dropV1(P);
await v1Row(P, "LIVE");
const stL = (await sb.from("v11_state").select("*").eq("state_key", "v11-shadow").maybeSingle()).data as any;
const r10b = await call(P, stL.last_processed_ts, stL.state_version, true, liveDec(P, "LIVE_SHADOW"));
ok("late commit downgraded, never mislabelled LIVE_SHADOW", r10b.effective_run_mode === "RECOVERY" && r10b.within_publication_ceiling === false, JSON.stringify({ m: r10b.effective_run_mode, o: r10b.commit_offset_ms }));
await sb.from("v11_decisions").delete().eq("target_ts", P);
await sb.from("v11_scores").delete().eq("target_ts", P);
await dropV1(P);

// invalid pair: V1 RESEARCH origin cannot back a live-shadow fallback
await sb.from("v11_decisions").delete().eq("target_ts", T(2));
await sb.from("v11_scores").delete().eq("target_ts", T(2));
await dropV1(T(2));
await v1Row(T(2), "RESEARCH");
const stB = (await sb.from("v11_state").select("*").eq("state_key", "v11-shadow").maybeSingle()).data as any;
const r11 = await call(T(2), stB.last_processed_ts, stB.state_version, true, { ...liveDec(T(2), "LIVE_SHADOW"), publication_ceiling_ms: 2000000000 });
ok("V1 RESEARCH origin cannot back a LIVE_SHADOW fallback", r11.committed === false && r11.excluded === true, JSON.stringify(r11.reason));

await dropV1(T(2));
await dropV1(T(3));
await cleanup();
const stF = (await sb.from("v11_state").select("*").eq("state_key", "v11-shadow").maybeSingle()).data as any;
ok("shadow checkpoint restored", stF.last_processed_ts === saved.last_processed_ts);
const leftover = (await sb.from("v11_decisions").select("target_ts", { count: "exact", head: true }).gte("target_ts", T(0))).count;
ok("test rows removed", leftover === 0);
console.log(results.join("\n"));
console.log(results.every((r) => r.startsWith("PASS")) ? "ALL PASS" : "FAILURES");
