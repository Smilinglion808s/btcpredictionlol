// Local PGlite check for public.v2_record_checkpoint (never run against production).
// Run: NODE_PATH=<dir with @electric-sql/pglite> node scripts/check-v2-record-rpc.mjs
import { PGlite } from "@electric-sql/pglite"; import fs from "fs"; import assert from "assert";
const db = new PGlite();
await db.exec("create role service_role; create role anon; create role authenticated;");
await db.exec(fs.readFileSync(new URL("../drizzle/migrations/0002_v2_final_r1_recording.sql", import.meta.url),"utf8").replaceAll("--> statement-breakpoint",""));
for (const f of ["0003_v2_record_checkpoint_atomic.sql","0004_v2_t45_requires_scored_t8.sql"])
  await db.exec(fs.readFileSync(new URL("../drizzle/migrations/"+f, import.meta.url),"utf8").replaceAll("--> statement-breakpoint",""));
const fn=(await db.query("select prosecdef, proconfig from pg_proc where proname='v2_record_checkpoint'")).rows[0];
assert.equal(fn.prosecdef,false); assert.deepEqual(fn.proconfig,['search_path=""']); console.log("security invoker + empty search_path: ok");
const call = async (p) => (await db.query("select public.v2_record_checkpoint($1::jsonb) r",[JSON.stringify(p)])).rows[0].r;
const open="2026-09-29T05:00:00.000Z";
const t8={candle_open:open,checkpoint:"T8",sleeve:"v2-direction8-r1",side:1,probability:0.61,eligible:true,features_ready:true,reason:null,decision_at:"2026-09-29T05:00:08.200Z",payload:{a:1},worker_id:"w",input_source:"s",label_source:"l",receipt_latency_ms:50};
// interrupted write: checkpoint persisted, intent missing
await db.query(`insert into v2_checkpoints(model_version,candle_open,checkpoint,sleeve,side,probability,eligible,features_ready,reason,decision_at,worker_id,payload,receipt_latency_ms)
 values('v2-final-r1',$1,'T8','v2-direction8-r1',1,0.61,true,true,null,'2026-09-29T05:00:08.200Z','w','{"a":1}',50)`,[open]);
let r=await call(t8); assert.equal(r.ok,true); assert.equal(r.duplicate,true); assert.equal(r.intent.sleeve,"v2-direction8-r1"); console.log("interrupted retry recovers intent: ok");
r=await call(t8); assert.equal(r.duplicate,true); assert.equal(r.intent.checkpoint_id,r.id); console.log("idempotent retry: ok");
r=await call({...t8,side:-1}); assert.equal(r.ok,false); assert.equal(r.error,"CONFLICTING_DUPLICATE"); console.log("conflicting duplicate: ok");
r=await call({...t8,payload:{a:2}}); assert.equal(r.error,"CONFLICTING_DUPLICATE"); console.log("conflicting payload: ok");
// T45 without persisted T8 abstention
const o2="2026-09-29T05:15:00.000Z";
const t45={...t8,candle_open:o2,checkpoint:"T45",sleeve:"v2-direction45-r1",decision_at:"2026-09-29T05:15:45.100Z"};
r=await call(t45); assert.equal(r.intent,null); assert.equal(r.intent_note,"T8_ABSTENTION_NOT_PERSISTED"); console.log("T45 needs T8 abstention: ok");
const o3="2026-09-29T05:30:00.000Z";
await call({...t8,candle_open:o3,eligible:false,side:0,probability:null,reason:"CHECKPOINT_LATE",features_ready:false,decision_at:"2026-09-29T05:30:10.000Z"});
r=await call({...t45,candle_open:o3,decision_at:"2026-09-29T05:30:45.100Z"}); assert.equal(r.intent,null); assert.equal(r.intent_note,"T8_ABSTENTION_NOT_PERSISTED"); console.log("failed T8 + eligible T45 -> no intent: ok");
const abst={...t8,eligible:false,side:0,probability:0.52,reason:null,features_ready:true,payload:{sleeve_name:"ABSTAIN"}};
const o4="2026-09-29T06:00:00.000Z";
await call({...abst,candle_open:o4,decision_at:"2026-09-29T06:00:09.200Z"}); // outside T8 window
r=await call({...t45,candle_open:o4,decision_at:"2026-09-29T06:00:45.100Z"}); assert.equal(r.intent,null); console.log("late T8 abstention -> no intent: ok");
const o5="2026-09-29T06:15:00.000Z";
await call({...abst,candle_open:o5,features_ready:false,reason:"FEED_STALE",decision_at:"2026-09-29T06:15:08.100Z"});
r=await call({...t45,candle_open:o5,decision_at:"2026-09-29T06:15:45.100Z"}); assert.equal(r.intent,null); console.log("unready T8 audit -> no intent: ok");
const o6="2026-09-29T06:30:00.000Z";
await db.exec("set role service_role");
await call({...abst,candle_open:o6,decision_at:"2026-09-29T06:30:08.100Z"});
r=await call({...t45,candle_open:o6,decision_at:"2026-09-29T06:30:45.100Z"}); assert.equal(r.intent.sleeve,"v2-direction45-r1"); console.log("scored T8 ABSTAIN + T45 -> intent (as service_role): ok");
await db.exec("reset role");
// late eligible rejected, fade blocked by higher priority
await assert.rejects(call({...t8,candle_open:"2026-09-29T05:45:00.000Z",decision_at:"2026-09-29T05:45:09.500Z"}),/ELIGIBLE_OUTSIDE_WINDOW/); console.log("late eligible rejected: ok");
r=await call({...t8,sleeve:"v2-fade8-r1",side:-1}); assert.equal(r.intent.sleeve,"v2-direction8-r1"); assert.equal(r.intent_note,"HIGHER_PRIORITY_ELIGIBLE"); console.log("returns persisted intent, not caller sleeve: ok");
const n=(await db.query("select count(*)::int n from v2_candle_intents")).rows[0].n; console.log("intents",n);
