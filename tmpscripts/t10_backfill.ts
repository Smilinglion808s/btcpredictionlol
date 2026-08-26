// T10 Bridge R1 — historical walk-forward backfill.
//
//   bun tmpscripts/t10_backfill.ts            # replay only (no writes)
//   bun tmpscripts/t10_backfill.ts --write    # + persist fits and BACKFILL rows
//
// Packets are Binance Global Spot 1s bars at offsets 0..9 (fetched here; the
// edge worker is geo-blocked). Technicals come from completed Binance 15m
// Spot/USD-M candles. Outcomes come only from confirmed OKX candles.

import { createClient } from "@supabase/supabase-js";
import {
  T10_BRIDGE_VARIANT,
  T10_BRIDGE_VERSION,
  T10_COLLECTOR_VERSION,
  T10_CONFIG_HASH,
  T10_FEATURE_ORDER_HASH,
  T10_FEATURE_SCHEMA,
  T10_FITS_TABLE,
  T10_IMPLEMENTATION_REVISION,
  T10_OUTCOME_SOURCE,
  T10_PREDICTIONS_TABLE,
  T10_REASONS,
  TF_MS,
  boiseDate,
  t10SourceIndex,
  utcDate,
} from "@/lib/t10/config";
import { buildT10PacketFeatures, t10PacketDiagnostics } from "@/lib/t10/features";
import {
  fitT10Head,
  t10BlockStart,
  t10Decide,
  t10FitCertified,
  t10Probability,
  t10RankChecksum,
  t10Score,
  t10Vector,
  type T10Head,
  type T10PriorProbability,
  type T10TrainingRow,
} from "@/lib/t10/head";
import { validateT10Packet, type T10SecondBar } from "@/lib/t10/packet";
import { buildT10Technicals, type T10Candle } from "@/lib/t10/technicals";
import { t10FitId } from "@/lib/t10/orchestrator.server";

type Row = Record<string, any>;
const WRITE = process.argv.includes("--write");
const CACHE = "/tmp/t10_packets.json";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

async function getJson(url: string, tries = 6): Promise<any> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
      if (res.status === 429 || res.status === 418) await Bun.sleep(3000 * (i + 1));
      else await Bun.sleep(500 * (i + 1));
    } catch (e) {
      last = String(e);
      await Bun.sleep(500 * (i + 1));
    }
  }
  throw new Error(`fetch failed ${url}: ${last}`);
}

function toCandle(k: Kline): T10Candle {
  return {
    ts: new Date(k[0]).toISOString(),
    open: +k[1],
    high: +k[2],
    low: +k[3],
    close: +k[4],
    volume: +k[5],
    quote_volume: +k[7],
    trade_count: +k[8],
    taker_buy_quote_volume: +k[10],
  };
}

async function fetch15m(base: string, fromMs: number, toMs: number): Promise<T10Candle[]> {
  const out: T10Candle[] = [];
  let cursor = fromMs;
  while (cursor < toMs) {
    const rows: Kline[] = await getJson(
      `${base}?symbol=BTCUSDT&interval=15m&startTime=${cursor}&endTime=${toMs}&limit=1000`,
    );
    if (!rows.length) break;
    out.push(...rows.map(toCandle));
    cursor = rows[rows.length - 1][0] + TF_MS;
    if (rows.length < 1000) break;
  }
  return out;
}

// ---------------------------------------------------------------- range
const { data: candleRange } = await sb
  .from("candles")
  .select("candle_ts")
  .eq("symbol", "BTC-USDT")
  .eq("timeframe", "15m")
  .eq("confirm", true)
  .order("candle_ts", { ascending: true })
  .limit(1);
const firstLabelMs = new Date(String(candleRange![0].candle_ts)).getTime();
// 40+ completed technical candles must exist before the first replayed target.
const startMs = firstLabelMs + 64 * TF_MS;
const endMs = Math.floor((Date.now() - TF_MS) / TF_MS) * TF_MS;
console.log("replay range", new Date(startMs).toISOString(), "→", new Date(endMs).toISOString());

// ---------------------------------------------------------------- outcomes
const outcomes = new Map<string, { open: number; high: number; low: number; close: number }>();
for (let off = 0; ; off += 1000) {
  const { data, error } = await sb
    .from("candles")
    .select("candle_ts, open, high, low, close")
    .eq("symbol", "BTC-USDT")
    .eq("timeframe", "15m")
    .eq("confirm", true)
    .order("candle_ts", { ascending: true })
    .range(off, off + 999);
  if (error) throw new Error(error.message);
  for (const r of data ?? [])
    outcomes.set(new Date(String(r.candle_ts)).toISOString(), {
      open: +r.open!,
      high: +r.high!,
      low: +r.low!,
      close: +r.close!,
    });
  if ((data ?? []).length < 1000) break;
}
console.log("okx outcomes:", outcomes.size);

// ---------------------------------------------------------------- 15m history
console.log("loading binance 15m history…");
const histFrom = startMs - 70 * TF_MS;
const [spotAll, futAll] = await Promise.all([
  fetch15m("https://api.binance.com/api/v3/klines", histFrom, endMs),
  fetch15m("https://fapi.binance.com/fapi/v1/klines", histFrom, endMs),
]);
const spotByTs = new Map(spotAll.map((c) => [Date.parse(c.ts), c]));
const futByTs = new Map(futAll.map((c) => [Date.parse(c.ts), c]));
console.log("spot 15m:", spotAll.length, "fut 15m:", futAll.length);

function priorCandles(map: Map<number, T10Candle>, targetMs: number, limit = 64): T10Candle[] {
  const out: T10Candle[] = [];
  for (let i = limit; i >= 1; i--) {
    const c = map.get(targetMs - i * TF_MS);
    if (c) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- packets
const targets: number[] = [];
for (let ms = startMs; ms <= endMs; ms += TF_MS) targets.push(ms);

const cache: Record<string, T10SecondBar[]> = (await Bun.file(CACHE).exists())
  ? JSON.parse(await Bun.file(CACHE).text())
  : {};
const missing = targets.filter((ms) => !cache[String(ms)]);
console.log("packets cached:", targets.length - missing.length, "to fetch:", missing.length);

let fetched = 0;
const CONC = 6;
async function worker(slice: number[]) {
  for (const ms of slice) {
    const rows: Kline[] = await getJson(
      `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1s&startTime=${ms}&endTime=${ms + 9999}&limit=10`,
    );
    cache[String(ms)] = rows.map((k) => ({
      offset_seconds: Math.round((k[0] - ms) / 1000),
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5],
      quote_volume: +k[7],
      trade_count: +k[8],
      taker_buy_quote_volume: +k[10],
      is_final: true,
    }));
    fetched++;
    if (fetched % 250 === 0) {
      console.log(`  packets ${fetched}/${missing.length}`);
      await Bun.write(CACHE, JSON.stringify(cache));
    }
  }
}
if (missing.length) {
  const slices: number[][] = Array.from({ length: CONC }, () => []);
  missing.forEach((ms, i) => slices[i % CONC].push(ms));
  await Promise.all(slices.map(worker));
  await Bun.write(CACHE, JSON.stringify(cache));
}

// ---------------------------------------------------------------- walk-forward
interface ReplayRow {
  targetTs: string;
  index: number;
  row: Row;
  result: string;
  raw: number;
  wouldTrade: boolean;
  direction: number;
}

function replay(): { rows: ReplayRow[]; fits: Map<number, T10Head>; hash: string } {
  const history: T10TrainingRow[] = [];
  const prior: T10PriorProbability[] = [];
  const fits = new Map<number, T10Head>();
  const uncertified = new Set<number>();
  const rows: ReplayRow[] = [];
  let h = 0x811c9dc5;
  const push = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  };

  for (const ms of targets) {
    const targetTs = new Date(ms).toISOString();
    const index = t10SourceIndex(targetTs);
    const outcome = outcomes.get(targetTs) ?? null;
    const actual = outcome
      ? outcome.close > outcome.open
        ? "GREEN"
        : outcome.close < outcome.open
          ? "RED"
          : "PUSH"
      : null;

    const base: Row = {
      target_ts: targetTs,
      model_version: T10_BRIDGE_VERSION,
      model_variant: T10_BRIDGE_VARIANT,
      feature_schema: T10_FEATURE_SCHEMA,
      config_hash: T10_CONFIG_HASH,
      feature_order_hash: T10_FEATURE_ORDER_HASH,
      implementation_revision: T10_IMPLEMENTATION_REVISION,
      run_mode: "BACKFILL",
      trigger_kind: "REPLAY",
      source_index: index,
      utc_date: utcDate(targetTs),
      boise_date: boiseDate(targetTs),
      activation_mode: "SHADOW_ONLY",
      activation_boundary_ts: null,
      outcome_source: T10_OUTCOME_SOURCE,
      decision_at: new Date(ms + 10_000).toISOString(),
      decision_offset_ms: 10_000,
      webhook_eligible: false,
      final_prediction: null,
    };

    const emit = (extra: Row, wouldTrade = false, direction = 0) => {
      const { result, raw } = t10Score(wouldTrade, direction as 1 | -1 | 0, actual);
      const resolution: Row = outcome
        ? {
            actual_open: outcome.open,
            actual_high: outcome.high,
            actual_low: outcome.low,
            actual_close: outcome.close,
            actual_direction: actual,
            result,
            raw_score: raw,
            resolved_at: new Date(ms + TF_MS).toISOString(),
            resolution_attempt_count: 1,
          }
        : { result: "PENDING", raw_score: 0 };
      const row = { ...base, ...extra, ...resolution };
      push(`${targetTs}|${row.policy_decision_reason}|${row.correctness_probability ?? "-"}|${result};`);
      rows.push({ targetTs, index, row, result, raw, wouldTrade, direction });
      return row;
    };

    const packet = validateT10Packet(targetTs, cache[String(ms)] ?? []);
    if (!packet.complete) {
      emit({
        packet_count: packet.count,
        packet_complete: false,
        packet_failure_reason: packet.reason,
        policy_decision_reason: T10_REASONS.PACKET_NOT_READY,
      });
      continue;
    }

    const pf = buildT10PacketFeatures(packet.bars);
    const baseDirection = pf.direction === 1 ? "GREEN" : pf.direction === -1 ? "RED" : null;
    const packetRow: Row = {
      packet_count: packet.count,
      packet_first_offset: packet.firstOffset,
      packet_last_offset: packet.lastOffset,
      packet_complete: true,
      packet_failure_reason: null,
      base_direction: baseDirection,
      ret10_bps: pf.ret10Bps,
      packet_features: { ...pf.values, ...t10PacketDiagnostics(packet.bars) },
    };

    const spot = priorCandles(spotByTs, ms);
    const fut = priorCandles(futByTs, ms);
    const tech = buildT10Technicals(targetTs, pf.direction, spot, fut);
    if (!tech.ready) {
      emit({
        ...packetRow,
        prior_technicals_ready: false,
        prior_technicals_reason: tech.reason,
        policy_decision_reason: T10_REASONS.PRIOR_TECHNICALS_NOT_READY,
      });
      continue;
    }

    const values = { ...pf.values, ...tech.values };
    const vector = pf.valid ? t10Vector(values) : null;
    const featureRow: Row = {
      ...packetRow,
      prior_technicals_ready: true,
      technical_features: tech.values,
      feature_vector: vector,
      feature_vector_hash: T10_FEATURE_ORDER_HASH,
      features_valid: vector != null,
    };
    if (!vector) {
      emit({ ...featureRow, policy_decision_reason: T10_REASONS.FEATURES_INVALID });
      continue;
    }

    // Certified block head, minted once per block from strictly prior rows.
    const blockStart = t10BlockStart(index);
    let head: T10Head | null = null;
    if (blockStart != null && !uncertified.has(blockStart)) {
      head = fits.get(blockStart) ?? null;
      if (!head) {
        const minted = fitT10Head(blockStart, history);
        if (minted && t10FitCertified(minted)) {
          fits.set(blockStart, minted);
          head = minted;
        } else uncertified.add(blockStart);
      }
    }
    const fitRow: Row = {
      ...featureRow,
      fit_id: blockStart == null ? null : t10FitId(blockStart),
      fit_block_start_index: blockStart,
      fit_certified: head != null,
      fit_source: "walk-forward",
    };

    const label: 0 | 1 =
      baseDirection != null && baseDirection === actual ? 1 : 0;
    const appendHistory = () => {
      if (actual && (baseDirection === "GREEN" || baseDirection === "RED"))
        history.push({ targetTs, index, vector, label });
    };

    if (!head) {
      emit({ ...fitRow, policy_decision_reason: T10_REASONS.FIT_NOT_CERTIFIED });
      appendHistory();
      continue;
    }

    const probability = t10Probability(head, vector);
    const decision = t10Decide(probability, pf.direction, prior);
    emit(
      {
        ...fitRow,
        correctness_probability: probability,
        long_rank: decision.longRank.rank,
        fast_rank: decision.fastRank.rank,
        long_rank_count: decision.longRank.historyCount,
        fast_rank_count: decision.fastRank.historyCount,
        long_window_start_ts: decision.longRank.windowStartTs,
        long_window_end_ts: decision.longRank.windowEndTs,
        fast_window_start_ts: decision.fastRank.windowStartTs,
        fast_window_end_ts: decision.fastRank.windowEndTs,
        rank_state_checksum: t10RankChecksum(prior),
        rank_certified: decision.rankCertified,
        policy_would_trade: decision.policyWouldTrade,
        policy_direction:
          decision.policyDirection === 1 ? "GREEN" : decision.policyDirection === -1 ? "RED" : null,
        policy_decision_reason: decision.reason,
      },
      decision.policyWouldTrade,
      decision.policyDirection,
    );
    prior.push({ targetTs, probability });
    appendHistory();
  }

  return { rows, fits, hash: h.toString(16).padStart(8, "0") };
}

console.log("replay pass 1…");
const t0 = Date.now();
const a = replay();
console.log("pass1:", a.hash, "fits:", a.fits.size, `${Date.now() - t0}ms`);
const b = replay();
console.log("pass2:", b.hash, "identical:", a.hash === b.hash);

function agg(rows: ReplayRow[]) {
  let wins = 0, losses = 0, pushes = 0, abst = 0, eq = 0, peak = 0, dd = 0, streak = 0, maxStreak = 0;
  for (const r of rows) {
    if (r.result === "WIN") { wins++; eq++; streak = 0; }
    else if (r.result === "LOSS") { losses++; eq--; streak++; maxStreak = Math.max(maxStreak, streak); }
    else if (r.result === "PUSH") pushes++;
    else abst++;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const dec = wins + losses;
  return {
    scheduled: rows.length,
    trades: wins + losses + pushes,
    wins, losses, pushes, abstains: abst,
    net: wins - losses,
    winRate: dec ? +((wins / dec) * 100).toFixed(2) : null,
    coverage: rows.length ? +(((wins + losses + pushes) / rows.length) * 100).toFixed(2) : null,
    maxDrawdown: dd,
    maxLossStreak: maxStreak,
  };
}

const report: Row = {
  identity: {
    model_version: T10_BRIDGE_VERSION,
    variant: T10_BRIDGE_VARIANT,
    feature_schema: T10_FEATURE_SCHEMA,
    config_hash: T10_CONFIG_HASH,
    feature_order_hash: T10_FEATURE_ORDER_HASH,
  },
  determinism: { pass1: a.hash, pass2: b.hash, identical: a.hash === b.hash },
  range: { from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString() },
  boundaries: a.rows.length,
  fits: a.fits.size,
  reasons: {} as Row,
  all: agg(a.rows),
  green: agg(a.rows.filter((r) => r.wouldTrade && r.direction === 1)),
  red: agg(a.rows.filter((r) => r.wouldTrade && r.direction === -1)),
  months: {} as Row,
};
for (const r of a.rows)
  report.reasons[String(r.row.policy_decision_reason)] =
    (report.reasons[String(r.row.policy_decision_reason)] ?? 0) + 1;
for (const m of [...new Set(a.rows.map((r) => r.targetTs.slice(0, 7)))].sort())
  report.months[m] = agg(a.rows.filter((r) => r.targetTs.startsWith(m)));

await Bun.write("/mnt/documents/t10_backfill_report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, months: report.months }, null, 2));

if (!WRITE) {
  console.log("dry run complete (no writes)");
  process.exit(0);
}

console.log("writing fits…");
for (const [blockStart, head] of [...a.fits.entries()].sort((x, y) => x[0] - y[0])) {
  const { error } = await sb.from(T10_FITS_TABLE).upsert(
    {
      fit_id: t10FitId(blockStart),
      model_version: T10_BRIDGE_VERSION,
      model_variant: T10_BRIDGE_VARIANT,
      config_hash: T10_CONFIG_HASH,
      feature_order_hash: T10_FEATURE_ORDER_HASH,
      fit_source: "walk-forward",
      block_index: head.blockIndex,
      block_start_index: head.blockStartIndex,
      training_row_count: head.trainingRowCount,
      training_start_index: head.trainingStartIndex,
      training_end_index: head.trainingEndIndex,
      training_start_ts: head.trainingStartTs,
      training_end_ts: head.trainingEndTs,
      window_fingerprint: head.trainingFingerprint,
      center: head.scaler.center,
      scale: head.scaler.scale,
      coefficients: head.coefficients,
      intercept: head.intercept,
      converged: head.converged,
      iterations: head.iterations,
      gradient_norm: head.gradientNorm,
      artifact_hash: head.trainingFingerprint,
      certified: true,
    } as never,
    { onConflict: "fit_id" },
  );
  if (error) throw new Error(`fit:${error.message}`);
}

console.log("writing BACKFILL predictions…");
// Never overwrite a real LIVE decision with a replayed one.
const live = new Set<string>();
for (let off = 0; ; off += 1000) {
  const { data, error } = await sb
    .from(T10_PREDICTIONS_TABLE)
    .select("target_ts, run_mode")
    .eq("model_version", T10_BRIDGE_VERSION)
    .neq("run_mode", "BACKFILL")
    .range(off, off + 999);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) live.add(new Date(String(r.target_ts)).toISOString());
  if ((data ?? []).length < 1000) break;
}
console.log("preserving live rows:", live.size);
const payload = a.rows.filter((r) => !live.has(r.targetTs)).map((r) => r.row);
for (let i = 0; i < payload.length; i += 96) {
  const chunk = payload.slice(i, i + 96);
  let ok = false;
  let last = "";
  for (let attempt = 0; attempt < 5 && !ok; attempt++) {
    const { error } = await sb
      .from(T10_PREDICTIONS_TABLE)
      .upsert(chunk as never, { onConflict: "model_version,target_ts" });
    if (!error) ok = true;
    else {
      last = error.message;
      await Bun.sleep(1000 * (attempt + 1));
    }
  }
  if (!ok) throw new Error(`prediction:${last}`);
  if (i % 960 === 0) console.log(`  ${i + chunk.length}/${payload.length}`);
}
console.log("done");
