// Production-vintage replay of B4x4-ES1 Balanced Precision Stack R1.
// Read-only: pulls candles + Binance OB boundary features from production and
// reports balanced / primary / rescue / combined performance.
import { createClient } from "@supabase/supabase-js";
import { buildTechnicalRows, type RawCandle } from "../src/lib/v6/technical";
import {
  decidePrecisionStack,
  scoreLeg,
  upperWickPercentile,
  type Direction,
  type Outcome,
} from "../src/lib/b4x4es1/precisionStack";
import {
  fitTechnicalModel,
  technicalTrainEndFor,
  type TechnicalFeatureRow,
  type TechnicalModel,
} from "../src/lib/b4x4es1/precisionTechnical";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function pageAll<T>(table: string, cols: string, order: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).order(order).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type ObRow = Record<string, any>;

function venueDirection(final: number | null, mean60: number | null): { mode: string; direction: Direction | null } {
  if (final === null || !Number.isFinite(final) || final === 0) return { mode: "NONE", direction: null };
  const followDir: Direction = final > 0 ? "GREEN" : "RED";
  const agree = mean60 !== null && Number.isFinite(mean60) && Math.sign(mean60) === Math.sign(final);
  return agree
    ? { mode: "FADE", direction: followDir === "GREEN" ? "RED" : "GREEN" }
    : { mode: "FOLLOW", direction: followDir };
}

function boiseDay(ts: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Boise", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}

function tally(entries: { trade: boolean; score: number; push: boolean }[]) {
  let trades = 0, wins = 0, losses = 0, pushes = 0, net = 0, eq = 0, peak = 0, dd = 0, streak = 0, maxStreak = 0;
  for (const e of entries) {
    if (!e.trade) continue;
    trades++;
    if (e.push) pushes++;
    else if (e.score > 0) wins++;
    else losses++;
    net += e.score;
    eq += e.score;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    if (e.score < 0) { streak++; maxStreak = Math.max(maxStreak, streak); } else if (e.score > 0) streak = 0;
  }
  return { trades, wins, losses, pushes, net, winRate: trades - pushes > 0 ? +(wins / (trades - pushes) * 100).toFixed(1) : 0, maxDrawdown: dd, maxLossStreak: maxStreak };
}

async function main() {
  const candles = await pageAll<RawCandle & { candle_ts: string }>("candles", "candle_ts,open,high,low,close,volume", "candle_ts");
  const tech = buildTechnicalRows(candles);
  const techByTs = new Map<string, TechnicalFeatureRow>();
  candles.forEach((c, i) => techByTs.set(new Date(c.candle_ts).toISOString(), tech[i]));
  const candleByTs = new Map(candles.map((c) => [new Date(c.candle_ts).toISOString(), c]));

  const obCols = "target_ts,market_kind,ready,final_imbalance_10bps,mean_imbalance_10bps_60s,sign_change_count_60s,normalized_ofi_5s,resync_continuous";
  const ob = await pageAll<ObRow>("b4x4_es1_binance_ob_boundary_features", obCols, "target_ts");
  const spot = new Map<string, ObRow>();
  const perp = new Map<string, ObRow>();
  for (const r of ob) {
    const ts = new Date(r.target_ts).toISOString();
    (r.market_kind === "SPOT" ? spot : perp).set(ts, r);
  }

  const priorWickShares: { ts: string; share: number }[] = [];
  const wickByTs = new Map<string, number>();
  for (const c of candles) {
    const rng = c.high - c.low;
    const share = rng > 0 ? (c.high - Math.max(c.open, c.close)) / rng : 0;
    const ts = new Date(c.candle_ts).toISOString();
    priorWickShares.push({ ts, share });
    wickByTs.set(ts, share);
  }
  const wickIndex = new Map(priorWickShares.map((w, i) => [w.ts, i]));

  type Opp = {
    targetTs: string; priorTs: string; actual: Outcome;
    inputs: any; techRow: TechnicalFeatureRow; wickPct: number | null; trendAge: number | null;
  };
  const opps: Opp[] = [];
  const timestamps = [...spot.keys()].filter((ts) => perp.has(ts)).sort();
  for (const ts of timestamps) {
    const s = spot.get(ts)!, p = perp.get(ts)!;
    if (!s.ready || !p.ready) continue;
    const candle = candleByTs.get(ts);
    const priorTs = new Date(new Date(ts).getTime() - 15 * 60000).toISOString();
    const techRow = techByTs.get(priorTs);
    if (!candle || !techRow) continue;
    const actual: Outcome = candle.close > candle.open ? "GREEN" : candle.close < candle.open ? "RED" : "PUSH";
    const sd = venueDirection(s.final_imbalance_10bps, s.mean_imbalance_10bps_60s);
    const pd = venueDirection(p.final_imbalance_10bps, p.mean_imbalance_10bps_60s);
    const idx = wickIndex.get(priorTs)!;
    const hist = priorWickShares.slice(Math.max(0, idx - 96), idx).map((w) => w.share);
    const wickPct = upperWickPercentile(hist, wickByTs.get(priorTs)!);
    const trendAgeRaw = techRow["trend_age_candles"];
    const row: TechnicalFeatureRow = { ...techRow, boundary_contiguous: s.resync_continuous && p.resync_continuous ? 1 : 0 };
    opps.push({
      targetTs: ts,
      priorTs,
      actual,
      inputs: {
        spotAdaptiveDirection: sd.direction,
        perpAdaptiveDirection: pd.direction,
        perpSignChangeCount60s: p.sign_change_count_60s,
        spotNormalizedOfi5s: s.normalized_ofi_5s,
      },
      techRow: row,
      wickPct,
      trendAge: typeof trendAgeRaw === "number" ? trendAgeRaw : null,
    });
  }

  // Walk-forward technical fits, refit per 16-opportunity block.
  const models = new Map<number, TechnicalModel | null>();
  const results: any[] = [];
  opps.forEach((o, i) => {
    const trainEnd = technicalTrainEndFor(i);
    const blockStart = Math.floor(i / 16) * 16;
    if (!models.has(blockStart)) {
      let model: TechnicalModel | null = null;
      if (trainEnd !== null) {
        const train = opps.slice(0, trainEnd).filter((t) => t.actual !== "PUSH");
        model = fitTechnicalModel(train.map((t) => t.techRow), train.map((t) => (t.actual === "GREEN" ? 1 : 0)));
      }
      models.set(blockStart, model);
    }
    const model = models.get(blockStart)!;
    const pGreen = model ? model.predictGreenProbability(o.techRow) : null;
    const d = decidePrecisionStack({
      ...o.inputs,
      technicalDirection: pGreen === null ? null : pGreen >= 0.5 ? "GREEN" : "RED",
      technicalConfidence: pGreen === null ? null : Math.abs(pGreen - 0.5),
      priorTrendAgeCandles: o.trendAge,
      upperWickPercentile96: o.wickPct,
    });
    results.push({ o, d });
  });

  const legs = ["balanced", "primary", "rescue", "combined"] as const;
  const report: Record<string, any> = { universe: { opportunities: opps.length, first: opps[0]?.targetTs, last: opps[opps.length - 1]?.targetTs } };
  for (const leg of legs) {
    report[leg] = tally(results.map(({ o, d }) => ({ trade: d[leg].wouldTrade, push: o.actual === "PUSH", score: scoreLeg(d[leg], o.actual) })));
    report[leg].coveragePct = +((report[leg].trades / opps.length) * 100).toFixed(1);
  }
  const days: Record<string, any> = {};
  for (const { o, d } of results) {
    const day = boiseDay(o.targetTs);
    days[day] ??= { trades: 0, net: 0 };
    if (d.combined.wouldTrade) { days[day].trades++; days[day].net += scoreLeg(d.combined, o.actual); }
  }
  report.combined_by_boise_day = days;

  // Oracle-window slice for cross-check.
  const win = results.filter(({ o }) => o.targetTs >= "2026-08-16T08:30:00.000Z" && o.targetTs <= "2026-08-18T19:45:00.000Z");
  report.oracle_window = { rows: win.length };
  for (const leg of legs) {
    report.oracle_window[leg] = tally(win.map(({ o, d }) => ({ trade: d[leg].wouldTrade, push: o.actual === "PUSH", score: scoreLeg(d[leg], o.actual) })));
  }
  console.log(JSON.stringify(report, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
