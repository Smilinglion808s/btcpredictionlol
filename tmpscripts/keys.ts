import { buildTechnicalRows } from "../src/lib/v6/technical";
import oracle from "../src/lib/b4x4es1/__tests__/precision-oracle-224.json";
const candles = Array.from({length: 200}, (_,i)=>({candle_ts:new Date(i*9e5).toISOString(),open:100+i,high:101+i,low:99+i,close:100.5+i,volume:10+i}));
const rows = buildTechnicalRows(candles);
const keys = new Set(Object.keys(rows[rows.length-1]));
const want: string[] = (oracle as any).balanced_router.technical_features;
console.log("missing:", want.filter(k=>!keys.has(k)));
console.log("have:", want.filter(k=>keys.has(k)).length, "of", want.length);
