import {describe,it,expect} from 'vitest';
import {runReads,runDisplay,sol,duration,type RunResult} from './run-view';
const bind={auth:'session-a',runtime:'runtime-a'};
const result=(time=1000,runtime='runtime-a')=>({availability:'available',reason:null,run:{runtime_session_id:runtime,observed_at_ms:time,entries_until_ms:2000,state:'ON'}} as unknown as RunResult);
describe('read-only run display isolation',()=>{
 it('ignores out-of-order responses',()=>{const t=runReads();t.bind(bind);const a=t.begin(),b=t.begin();expect(t.accept(b,result(1100),bind)).toBe(true);expect(t.accept(a,result(1000),bind)).toBe(false);});
 it('ignores old timestamp even from newer request',()=>{const t=runReads();t.bind(bind);expect(t.accept(t.begin(),result(1100),bind)).toBe(true);expect(t.accept(t.begin(),result(1000),bind)).toBe(false);});
 it('clears on logout and rejects late old session',()=>{const t=runReads();t.bind(bind);const a=t.begin();t.bind(null);expect(t.accept(a,result(),null)).toBe(false);t.bind({...bind,auth:'session-b'});expect(t.accept(a,result(),{...bind,auth:'session-b'})).toBe(false);});
 it('rejects wrong runtime without mutating controls',()=>{const t=runReads();t.bind(bind);expect(t.accept(t.begin(),result(1000,'other'),bind)).toBe(false);});
 it('falls back when status or run is stale or clocks reverse',()=>{expect(runDisplay(result(),1200,1,200,false)).toBe(null);expect(runDisplay(result(),7000,1,200,true)).toBe(null);expect(runDisplay(result(),1200,1,6002,true)).toBe(null);expect(runDisplay(result(),900,1,200,true)).toBe(null);expect(runDisplay(result(),1200,200,1,true)).toBe(null);});
 it('shows expiry at zero instead of optimistic ON',()=>{const d=runDisplay(result(),2001,1,200,true);expect(d?.expired).toBe(true);expect(d?.remaining).toBe(0);});
 it('unavailable result clears displayed run',()=>{expect(runDisplay({availability:'unavailable',run:null,reason:'LOGIN_REQUIRED'},1200,1,200,true)).toBe(null);});
 it('formats exact atomic amounts without Number precision loss',()=>{expect(sol('200000001')).toBe('0.200000001 SOL');expect(sol(null)).toBe('Not configured');expect(duration(86400000)).toBe('24h 0m 0s');});
});
