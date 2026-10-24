/** Request-bound proxy timing. No browser/backend wall-clock comparison. */
export type AgeProof=Readonly<{sampleAgeMs:number;receivedMono:number;authRemainingMs?:number;runRemainingMs?:number|null}>;
export const READ_ID="X-Control-Read-Id";
export function newReadId(){return crypto.randomUUID().replaceAll("-","");}
function numberHeader(h:Headers,name:string,max:number){const raw=h.get(name);if(raw===null||!/^(0|[1-9][0-9]{0,8})$/.test(raw))throw Error("Invalid timing");const n=Number(raw);if(n>max)throw Error("Invalid timing");return n;}
export function readAgeProof(h:Headers,id:string,started:number,ended:number,kind:"status"|"run"):AgeProof{
 if(!/^[a-f0-9]{32}$/.test(id)||h.get(READ_ID)!==id||!Number.isFinite(started)||!Number.isFinite(ended)||started<0||ended<started)throw Error("Invalid timing");
 const rtt=Math.ceil(ended-started),sampleAgeMs=numberHeader(h,"X-Control-Sample-Age-Ms",5000)+rtt;
 if(sampleAgeMs>5000)throw Error("Stale timing");
 if(kind==="status"){const authRemainingMs=numberHeader(h,"X-Control-Auth-Remaining-Ms",600000)-rtt;if(authRemainingMs<=0)throw Error("Expired timing");return Object.freeze({sampleAgeMs,receivedMono:ended,authRemainingMs});}
 const raw=h.get("X-Control-Run-Remaining-Ms");const runRemainingMs=raw==="none"?null:Math.max(0,numberHeader(h,"X-Control-Run-Remaining-Ms",86400000)-rtt);
 return Object.freeze({sampleAgeMs,receivedMono:ended,runRemainingMs});
}
export function ageFresh(t:AgeProof,mono:number){const elapsed=mono-t.receivedMono;return Number.isFinite(elapsed)&&elapsed>=0&&t.sampleAgeMs+elapsed<=5000;}