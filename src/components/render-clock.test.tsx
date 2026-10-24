import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {StandardBackendControls} from './standard-backend-controls';
import {StandardRunStatus} from './standard-run-status';
import {fresh,type View,type Status} from '../lib/standard-control/contract';
import type {createClient} from '../lib/standard-control/client';
import type {WalletLoginController} from '../lib/wallet-siws/controller';
const mock=vi.hoisted(()=>({mode:'controls',calls:0,view:null as unknown,client:null as unknown,data:null as unknown,oldClock:{wall:1800000000000,mono:1000}}));
vi.mock('react',async()=>{const real=await vi.importActual<typeof import('react')>('react');return {...real,useEffect:()=>{},useSyncExternalStore:()=>mock.view,useState:(initial:unknown)=>{const call=mock.calls++;let value=initial;if(mock.mode==='controls'&&call===0)value=mock.client;else if(initial&&typeof initial==='object'&&'mono' in initial)value=mock.oldClock;else if(initial===null)value=mock.data;return [value,()=>{}];}};});
vi.mock('../lib/wallet-siws/wallet-login-header',()=>({WalletSessionStatus:()=>null}));
const wall=1800000000000;
function view(received=1200):View{return {connection:'ready',receivedMono:received,timing:{sampleAgeMs:0,receivedMono:received,authRemainingMs:60000},status:{mode:'OFF',on_permitted:true,entry_enabled:false,positions:[],activity:[],activity_total:0,activity_truncated:false,blockers:[],errors:[],pending_orders:0,runtime_session_id:'runtime',auth_session_id:'auth',sampled_at_ms:wall,auth_expires_at_ms:wall+60000,valid_for_ms:5000,version:1,dataset:'offline_synthetic'} as unknown as Status,error:null,pending:[],busy:false,journalError:false};}
function renderControls(){mock.mode='controls';mock.calls=0;return renderToStaticMarkup(<StandardBackendControls controller={{} as WalletLoginController}/>);}
function renderRun(){mock.mode='run';mock.calls=0;const Component=StandardRunStatus as React.ComponentType<React.ComponentProps<typeof StandardRunStatus>&{clock?:{wall:number;mono:number}}>;
 return renderToStaticMarkup(<Component client={mock.client as ReturnType<typeof createClient>} view={mock.view as View} clock={mock.oldClock}/>);}
beforeEach(()=>{mock.oldClock={wall,mono:1000};mock.view=view();mock.client={snapshot:()=>mock.view,subscribe:()=>()=>{},refresh:async()=>{},command:async()=>{}};mock.data={binding:{auth:'auth',runtime:'runtime'},received:1200,result:{availability:'available',timing:{sampleAgeMs:0,receivedMono:1200,runRemainingMs:60000},run:{state:'ON',runtime_session_id:'runtime',run_id:'dummy',observed_at_ms:wall,entries_until_ms:wall+60000,policy:{},actual_balance:null,exit_permission:true}}};vi.spyOn(Date,'now').mockReturnValue(wall);vi.spyOn(performance,'now').mockReturnValue(1200);});
afterEach(()=>vi.restoreAllMocks());
describe('render-time clocks, not last timer tick',()=>{
 it('status response between ticks does not temporarily disable ready ON',()=>{expect(fresh(mock.view as View,wall,1000)).toBe(false);const html=renderControls();expect(html).toContain('Backend mode: OFF');expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Request ON/);});
 it('repeated status responses remain ready without waiting for a timer',()=>{for(const received of [1200,3200,5200]){mock.oldClock={wall,mono:received-200};mock.view=view(received);vi.mocked(performance.now).mockReturnValue(received);expect(renderControls()).toContain('Backend mode: OFF');}});
 it('child-only sidecar response samples its own render time',()=>{const html=renderRun();expect(html).toContain('0h 1m 0s left in entry window');expect(html).not.toContain('Run status unavailable');});
 it('genuine monotonic rollback still disables ON and hides sidecar',()=>{vi.mocked(performance.now).mockReturnValue(1199);expect(renderControls()).toMatch(/<button[^>]*\sdisabled=""[^>]*>Request ON/);expect(renderRun()).toContain('Run status unavailable');});
 it('status older than five seconds still disables ON and hides sidecar',()=>{vi.mocked(performance.now).mockReturnValue(6201);expect(renderControls()).toMatch(/<button[^>]*\sdisabled=""[^>]*>Request ON/);expect(renderRun()).toContain('Run status unavailable');});
 it('sidecar age expires independently while status stays fresh',()=>{mock.view=view(6201);vi.mocked(performance.now).mockReturnValue(6201);expect(renderControls()).toContain('Backend mode: OFF');expect(renderRun()).toContain('Run status unavailable');});
});