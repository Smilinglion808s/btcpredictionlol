import { fetchKalshiResolution } from "@/lib/kalshi.server";
for (const ts of ["2026-09-10T07:00:00.000Z", "2026-09-03T07:00:00.000Z"]) {
  try { console.log(ts, JSON.stringify(await fetchKalshiResolution(ts))); }
  catch (e) { console.log(ts, "ERR", (e as Error).message); }
}
