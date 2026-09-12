// Version 1.1 — offline backfill / fit driver (research use).
//
// Runs the SAME TypeScript feature + head code that serves at T+45, in bulk,
// so materialised vectors and daily heads are byte-identical to the serving
// path. Writes only v11_* tables. Never sends anything.
//
//   bun run scripts/v11/backfill.ts vectors <fromIso> <toIso>
//   bun run scripts/v11/backfill.ts fit <utcDate> [moreDates...]
//   bun run scripts/v11/backfill.ts fit-range <startDate> <endDate>

import { createClient } from "@supabase/supabase-js";
import { V11_T45_BASE_ORDER, V11_VOL_SOURCE } from "@/lib/v11/config";
import { buildV11Vector, computeV11Vol } from "@/lib/v11/features";
import { fitV11Head, v11HeadCertified, v11FitCutoff } from "@/lib/v11/head";
import { readTrainingRows, writeHead } from "@/lib/v11/store.server";

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function pageAll<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  size = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += size) {
    const rows = await fetchPage(i, i + size - 1);
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

async function vectors(fromIso: string, toIso: string) {
  const ctx = await pageAll(async (a, b) => {
    const { data, error } = await sb
      .from("v11_context_rows")
      .select("target_ts, input_valid, label, settlement_ts, feats")
      .gte("target_ts", fromIso)
      .lt("target_ts", toIso)
      .order("target_ts", { ascending: true })
      .range(a, b);
    if (error) throw error;
    return data ?? [];
  });

  const t45rows = await pageAll(async (a, b) => {
    const { data, error } = await sb
      .from("t45_features")
      .select(["target_ts", ...V11_T45_BASE_ORDER].join(", "))
      .eq("feature_version", "t45-features-r1")
      .gte("target_ts", fromIso)
      .lt("target_ts", toIso)
      .order("target_ts", { ascending: true })
      .range(a, b);
    if (error) throw error;
    return (data ?? []) as Record<string, unknown>[];
  });
  const t45 = new Map<string, Record<string, number>>();
  for (const r of t45rows) {
    const rec: Record<string, number> = {};
    for (const n of V11_T45_BASE_ORDER) rec[n] = Number(r[n]);
    t45.set(new Date(r.target_ts as string).toISOString(), rec);
  }

  const volClock: number[] = [];
  const batch: Record<string, unknown>[] = [];
  let valid = 0;
  for (const row of ctx as Record<string, unknown>[]) {
    const ts = new Date(row.target_ts as string).toISOString();
    const feats = (row.feats ?? {}) as Record<string, number>;
    const current = Number(feats[V11_VOL_SOURCE]);
    const vol = computeV11Vol(volClock, current);
    volClock.push(current);
    if (volClock.length > 200) volClock.splice(0, volClock.length - 200);

    const built = row.input_valid
      ? buildV11Vector({ direction60: feats, t45: t45.get(ts) ?? null }, vol.vol)
      : { vector: null, valid: false, missing: ["v1_input_invalid"], vol: vol.vol };
    if (built.valid) valid++;
    batch.push({
      target_ts: ts,
      vector: built.vector,
      vol: built.vol,
      valid: built.valid,
      missing: built.missing,
      label: row.label ?? null,
      settlement_ts: row.settlement_ts ?? null,
    });
    if (batch.length >= 500) await flush(batch);
  }
  await flush(batch);
  console.log(JSON.stringify({ considered: ctx.length, valid }));
}

async function flush(batch: Record<string, unknown>[]) {
  if (batch.length === 0) return;
  const { error } = await sb
    .from("v11_vectors")
    .upsert(batch, { onConflict: "target_ts" });
  if (error) throw error;
  batch.length = 0;
}

async function fit(dates: string[]) {
  for (const d of dates) {
    const cutoff = Date.parse(v11FitCutoff(d));
    const from = new Date(cutoff - 90 * 86_400_000).toISOString();
    const rows = await readTrainingRows(sb, from, new Date(cutoff).toISOString());
    const t0 = Date.now();
    const head = fitV11Head(d, rows);
    if (!head) {
      console.log(JSON.stringify({ fit_date: d, ok: false, rows: rows.length }));
      continue;
    }
    const certified = v11HeadCertified(head);
    if (certified) await writeHead(sb, head);
    console.log(
      JSON.stringify({
        fit_date: d,
        ok: certified,
        rows: head.trainingRowCount,
        iterations: head.iterations,
        grad: head.gradientNorm,
        fingerprint: head.trainingFingerprint,
        ms: Date.now() - t0,
      }),
    );
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "vectors") await vectors(args[0], args[1]);
else if (cmd === "fit") await fit(args);
else if (cmd === "fit-range") {
  const out: string[] = [];
  for (let t = Date.parse(`${args[0]}T00:00:00Z`); t <= Date.parse(`${args[1]}T00:00:00Z`); t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  await fit(out);
} else {
  console.error("usage: vectors <from> <to> | fit <dates...> | fit-range <a> <b>");
  process.exit(1);
}
