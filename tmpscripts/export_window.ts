import { createClient } from "@supabase/supabase-js";
import { loadCanonicalCandles } from "../src/lib/b4x4es1/data.server";
import { buildFeatureRows } from "../src/lib/b4x4es1/features";
import { eligibleFeatureRows } from "../src/lib/b4x4es1/replay";
import { trainingWindowFor } from "../src/lib/b4x4es1/priceHead";
import { trainingWindowFingerprint } from "../src/lib/b4x4es1/fitArtifacts";
import { writeFileSync } from "fs";

const url = process.env["SUPABASE_URL"]!;
const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
const supabase = createClient(url, key, {
  auth: { persistSession: false },
  global: {
    fetch: (input: any, init: any) => {
      const h = new Headers(init?.headers);
      if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
      h.set("apikey", key);
      return fetch(input, { ...init, headers: h });
    },
  },
});

const candles = await loadCanonicalCandles(supabase);
const eligible = eligibleFeatureRows(buildFeatureRows(candles));
const pool: Array<{ targetTs: string; vector: number[]; label: number; index: number }> = [];
eligible.forEach((fr, i) => {
  if (fr.actualDirection === "GREEN" || fr.actualDirection === "RED") {
    pool.push({ targetTs: fr.targetTs, vector: fr.vector, label: fr.actualDirection === "GREEN" ? 1 : 0, index: i });
  }
});
console.log("candles", candles.length, "eligible", eligible.length, "pool", pool.length);

const boundaries = Number(process.argv[2] ?? 2112);
const out: any = { boundaries: [] };
for (const b of Array.from({length: 15}, (_, k) => 768 + 96 * k)) {
  const { start, end } = trainingWindowFor(b);
  const rows = pool.slice(start, end);
  if (rows.length !== Math.min(b, 1536)) {
    console.log("boundary", b, "rows", rows.length, "-> SKIP");
    continue;
  }
  out.boundaries.push({
    boundary: b,
    fingerprint: trainingWindowFingerprint(rows),
    rows,
  });
  console.log("boundary", b, "rows", rows.length, "fp", trainingWindowFingerprint(rows));
}
writeFileSync("/tmp/es1/window.json", JSON.stringify(out));
