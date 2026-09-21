import {it,expect} from 'vitest';
import {freshExecution} from './execution-status';
it('keeps confirmed zeros but never treats stale, missing or invalid reads as zero',()=>{
 const now=Date.parse('2026-09-21T01:00:00Z');
 const value={received:6,filled:0,won:0,lost:0,pending:0,skipped:6,unresolved:0,as_of:new Date(now).toISOString(),truncated:false};
 expect(freshExecution(value,now)).toEqual(value);
 expect(freshExecution(value,now+90001)).toBeNull();
 expect(freshExecution(value,now-1001)).toBeNull();
 expect(freshExecution(null,now)).toBeNull();
 expect(freshExecution({...value,filled:-1},now)).toBeNull();
 expect(freshExecution({...value,as_of:'invalid'},now)).toBeNull();
});
import {recordRuntime} from './runtime.server';
it('heartbeat stores receiver counts instead of worker-supplied counts',async()=>{
 let saved:any;
 const sb={from:()=>({upsert:async(row:any)=>{saved=row;return {error:null};}})};
 const actual={received:6,filled:0,skipped:6,as_of:new Date().toISOString()};
 await recordRuntime(sb,{mode:'shadow',execution_enabled:false,u_execution:{filled:999}},async()=>actual);
 expect(saved.status.u_execution).toEqual(actual);
 await recordRuntime(sb,{mode:'shadow',execution_enabled:false},async()=>null);
 expect(saved.status.u_execution).toBeNull();
});
