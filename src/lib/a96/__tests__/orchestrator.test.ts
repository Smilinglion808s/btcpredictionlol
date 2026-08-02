// Contract + orchestrator tests for the a96-r1 resolution & audit pipeline.
// The SQL RPC `resolve_a96_prediction` is simulated here with a JS mock that
// mirrors its documented behavior (idempotent by resolved_at, PUSH is a
// no-op on counters, updates the prediction's ORIGINAL fit_episode_id).
// Orchestrator tests use these mocks to prove the acceptance criteria.

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { runA96, resolveDueA96Predictions, __setA96PollForTests } from "../orchestrator";
import { authoritativeDirection, scoreDirection } from "../engine";

beforeAll(() => __setA96PollForTests({ attempts: 2, intervalMs: 1 }));
afterAll(() => __setA96PollForTests(null));

type Row = Record<string, any>;

interface FitEpisode {
  fit_episode_id: string;
  artifact_fit_id: string;
  is_active: boolean;
  comparable_resolved_count: number;
  layer_a_wins: number; layer_a_losses: number; layer_a_net: number;
  layer_b_wins: number; layer_b_losses: number; layer_b_net: number;
}

function makeDb() {
  const state = {
    fitEpisodes: new Map<string, FitEpisode>(), // by episode id
    activeEpisodeByArtifact: new Map<string, string>(), // artifact -> episode id
    predictions: new Map<string, Row>(), // a96_predictions
    aasShadow: new Map<string, Row>(),
    predRows: new Map<string, Row>(),
    fits: [] as Array<{ fit_id: string; active: boolean; fitted_at: string }>,
    candles: new Map<string, Row>(), // key = iso ts
    apiRuns: [] as Row[],
    rpcCalls: [] as Array<{ name: string; args: any }>,
    resolveDueCalledBeforeFitRead: [] as string[], // order log: 'resolveDue' or 'fitRead'
  };

  function candleKey(ts: string) { return new Date(ts).toISOString(); }

  // Simulate SQL RPC: resolve_a96_prediction
  function rpcResolve(args: any) {
    const row = state.predictions.get(args.p_prediction_id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.resolved_at) return { ok: false, reason: "already_resolved" };
    const ep = state.fitEpisodes.get(row.fit_episode_id);
    if (!ep) return { ok: false, reason: "missing_fit_episode" };
    const actual = authoritativeDirection(args.p_actual_open, args.p_actual_close);
    row.actual_open = args.p_actual_open;
    row.actual_close = args.p_actual_close;
    row.actual_high = args.p_actual_high;
    row.actual_low = args.p_actual_low;
    row.actual_volume = args.p_actual_volume;
    row.actual_direction = actual;
    row.resolved_at = new Date().toISOString();
    const aScore = scoreDirection(row.layer_a_direction, actual);
    const bScore = scoreDirection(row.layer_b_direction, actual);
    row.layer_a_result_score = aScore;
    row.layer_b_result_score = bScore;
    row.result_score = scoreDirection(row.final_prediction, actual);
    if (actual === "PUSH") return { ok: true, push: true };
    // Update the ORIGINAL fit episode (from row.fit_episode_id), not the currently active one.
    ep.comparable_resolved_count += 1;
    if (aScore > 0) { ep.layer_a_wins += 1; ep.layer_a_net += 1; }
    else if (aScore < 0) { ep.layer_a_losses += 1; ep.layer_a_net -= 1; }
    if (bScore > 0) { ep.layer_b_wins += 1; ep.layer_b_net += 1; }
    else if (bScore < 0) { ep.layer_b_losses += 1; ep.layer_b_net -= 1; }
    return { ok: true };
  }

  function rpcGetOrMint(args: any) {
    const artifact = args.p_artifact_fit_id;
    let epId = state.activeEpisodeByArtifact.get(artifact);
    if (!epId) {
      epId = `ep-${artifact}`;
      state.fitEpisodes.set(epId, {
        fit_episode_id: epId, artifact_fit_id: artifact, is_active: true,
        comparable_resolved_count: 0,
        layer_a_wins: 0, layer_a_losses: 0, layer_a_net: 0,
        layer_b_wins: 0, layer_b_losses: 0, layer_b_net: 0,
      });
      state.activeEpisodeByArtifact.set(artifact, epId);
    }
    state.resolveDueCalledBeforeFitRead.push("fitRead");
    return [state.fitEpisodes.get(epId)];
  }

  const sb: any = {
    from(table: string) {
      const filters: Array<[string, string, any]> = [];
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitN: number | null = null;
      let selectStr = "*";
      const api: any = {
        select(s: string) { selectStr = s; return api; },
        eq(k: string, v: any) { filters.push([k, "eq", v]); return api; },
        lt(k: string, v: any) { filters.push([k, "lt", v]); return api; },
        lte(k: string, v: any) { filters.push([k, "lte", v]); return api; },
        gte(k: string, v: any) { filters.push([k, "gte", v]); return api; },

        is(k: string, v: any) { filters.push([k, "is", v]); return api; },
        in(k: string, arr: any[]) { filters.push([k, "in", arr]); return api; },
        order(k: string, o: any) { orderCol = k; orderAsc = !!o?.ascending; return api; },
        limit(n: number) { limitN = n; return api; },
        async maybeSingle() {
          const rows = await api._exec();
          return { data: rows[0] ?? null, error: null };
        },
        async _exec() {
          let rows: Row[] = [];
          if (table === "model7_aas96_shadow") rows = Array.from(state.aasShadow.values());
          else if (table === "predictions") rows = Array.from(state.predRows.values());
          else if (table === "model7_aas96_fits") rows = state.fits.slice();
          else if (table === "a96_predictions") rows = Array.from(state.predictions.values());
          else if (table === "candles") rows = Array.from(state.candles.values());
          for (const [k, op, v] of filters) {
            rows = rows.filter((r) => {
              if (op === "eq") return r[k] === v;
              if (op === "is" && v === null) return r[k] == null;
              if (op === "in") return (v as any[]).includes(r[k]);
              if (op === "gte") return new Date(r[k]).getTime() >= new Date(v).getTime();
              if (op === "lt") return new Date(r[k]).getTime() < new Date(v).getTime();

              if (op === "lte") return new Date(r[k]).getTime() <= new Date(v).getTime();
              return true;
            });
          }
          if (orderCol) rows.sort((a, b) => {
            const av = a[orderCol!], bv = b[orderCol!];
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return orderAsc ? cmp : -cmp;
          });
          if (limitN != null) rows = rows.slice(0, limitN);
          return rows;
        },
        then(res: any, rej: any) { return api._exec().then((data: Row[]) => res({ data, error: null }), rej); },
        async upsert(row: Row, _opts: any) {
          if (table === "a96_predictions") {
            const existing = state.predictions.get(row.prediction_id) ?? {};
            state.predictions.set(row.prediction_id, { ...existing, ...row });
          }
          return { data: null, error: null };
        },
        async insert(row: Row) {
          if (table === "api_runs") state.apiRuns.push(row);
          return { data: null, error: null };
        },
        update(patch: Row) {
          return {
            eq(k: string, v: any) {
              if (table === "a96_predictions") {
                for (const [id, r] of state.predictions) {
                  if (r[k] === v) state.predictions.set(id, { ...r, ...patch });
                }
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
      return api;
    },
    async rpc(name: string, args: any) {
      state.rpcCalls.push({ name, args });
      if (name === "resolve_a96_prediction") {
        // Log ordering: any resolveDue-driven resolve happens as part of that pass
        state.resolveDueCalledBeforeFitRead.push("resolveDue");
        return { data: rpcResolve(args), error: null };
      }
      if (name === "get_or_mint_a96_fit_episode") return { data: rpcGetOrMint(args), error: null };
      return { data: null, error: null };
    },
  };

  return { sb, state };
}

function seedAasAndSourcePrediction(state: any, opts: {
  predictionId: string; targetTs: string; open: number;
  layerA: "GREEN" | "RED"; layerB: "GREEN" | "RED"; base: "A" | "B";
}) {
  state.aasShadow.set(opts.predictionId, {
    prediction_id: opts.predictionId,
    layer_a_final_direction: opts.layerA,
    layer_b_final_direction: opts.layerB,
    selector_pre_override_selected_layer: opts.base,
    eligibility_passed: true,
    // r2: default to an in-band Layer A probability so existing tests
    // exercise the directional path.
    layer_a_prob_mean: 0.52,
  });

  state.predRows.set(opts.predictionId, {
    id: opts.predictionId,
    candle_ts: opts.targetTs,
    btc_price_at_prediction: opts.open,
  });
}

function seedFit(state: any, fitId: string) {
  state.fits.length = 0;
  state.fits.push({ fit_id: fitId, active: true, fitted_at: new Date().toISOString() });
}

/**
 * r4: seed >= 200 contiguous confirmed candles ending at T-15m so the
 * MACD/ATR technical snapshot is available. Never overwrites candles the
 * test already seeded explicitly.
 */
function seedTechnicalHistory(state: any, targetTs: string, base = 200) {
  const last = new Date(targetTs).getTime() - 15 * 60 * 1000;
  for (let i = 0; i < 260; i++) {
    const ts = new Date(last - i * 15 * 60 * 1000).toISOString();
    if (state.candles.has(ts)) continue;
    const o = base + (i % 3);
    state.candles.set(ts, {
      id: `tech-${ts}`,
      candle_ts: ts, symbol: "BTC-USDT", timeframe: "15m",
      open: o, high: o + 2, low: o - 2, close: o + 0.5, volume: 100, confirm: true,
      fetch_source: "okx",
    });
  }
}


function seedCandle(state: any, ts: string, o: number, h: number, l: number, c: number) {
  state.candles.set(ts, {
    id: `cand-${ts}`,
    candle_ts: ts, symbol: "BTC-USDT", timeframe: "15m",
    open: o, high: h, low: l, close: c, volume: 100, confirm: true,
    fetch_source: "okx",
  });
}

describe("a96 resolution contract (SQL RPC mirror)", () => {
  it("re-running resolution does not increment counters twice (idempotent by resolved_at)", async () => {
    const { sb, state } = makeDb();
    seedFit(state, "fitX");
    const pid = "11111111-1111-1111-1111-111111111111";
    const targetTs = "2026-07-24T20:15:00.000Z";
    seedAasAndSourcePrediction(state, { predictionId: pid, targetTs, open: 100, layerA: "GREEN", layerB: "GREEN", base: "A" });
    // Prior candles for agreement branch pass-through — not needed here since we bypass runA96 and insert directly.
    state.predictions.set(pid, {
      prediction_id: pid, fit_episode_id: "ep-fitX",
      artifact_fit_id: "fitX", target_candle_ts: targetTs,
      layer_a_direction: "GREEN", layer_b_direction: "GREEN",
      final_prediction: "GREEN", resolved_at: null,
    });
    state.fitEpisodes.set("ep-fitX", {
      fit_episode_id: "ep-fitX", artifact_fit_id: "fitX", is_active: true,
      comparable_resolved_count: 0,
      layer_a_wins: 0, layer_a_losses: 0, layer_a_net: 0,
      layer_b_wins: 0, layer_b_losses: 0, layer_b_net: 0,
    });
    state.activeEpisodeByArtifact.set("fitX", "ep-fitX");
    seedCandle(state, targetTs, 100, 105, 99, 104); // GREEN
    // Make it "due"
    vi.useFakeTimers(); vi.setSystemTime(new Date(new Date(targetTs).getTime() + 20 * 60 * 1000));
    await resolveDueA96Predictions(sb);
    await resolveDueA96Predictions(sb); // re-run
    const ep = state.fitEpisodes.get("ep-fitX")!;
    expect(ep.comparable_resolved_count).toBe(1);
    expect(ep.layer_a_wins).toBe(1);
    expect(ep.layer_a_net).toBe(1);
    vi.useRealTimers();
  });

  it("PUSH does not increment resolved count, wins, losses, or nets", async () => {
    const { sb, state } = makeDb();
    seedFit(state, "fitP");
    const pid = "22222222-2222-2222-2222-222222222222";
    const targetTs = "2026-07-24T20:15:00.000Z";
    state.predictions.set(pid, {
      prediction_id: pid, fit_episode_id: "ep-fitP", artifact_fit_id: "fitP",
      target_candle_ts: targetTs,
      layer_a_direction: "GREEN", layer_b_direction: "GREEN",
      final_prediction: "GREEN", resolved_at: null,
    });
    state.fitEpisodes.set("ep-fitP", {
      fit_episode_id: "ep-fitP", artifact_fit_id: "fitP", is_active: true,
      comparable_resolved_count: 0,
      layer_a_wins: 0, layer_a_losses: 0, layer_a_net: 0,
      layer_b_wins: 0, layer_b_losses: 0, layer_b_net: 0,
    });
    state.activeEpisodeByArtifact.set("fitP", "ep-fitP");
    seedCandle(state, targetTs, 100, 102, 98, 100); // PUSH: open==close
    vi.useFakeTimers(); vi.setSystemTime(new Date(new Date(targetTs).getTime() + 20 * 60 * 1000));
    await resolveDueA96Predictions(sb);
    const ep = state.fitEpisodes.get("ep-fitP")!;
    expect(ep.comparable_resolved_count).toBe(0);
    expect(ep.layer_a_wins + ep.layer_a_losses + ep.layer_b_wins + ep.layer_b_losses).toBe(0);
    expect(ep.layer_a_net).toBe(0); expect(ep.layer_b_net).toBe(0);
    expect(state.predictions.get(pid)!.resolved_at).toBeTruthy();
    vi.useRealTimers();
  });

  it("a prediction updates its ORIGINAL fit episode after a newer fit activates", async () => {
    const { sb, state } = makeDb();
    // Old fit + episode holds the unresolved prediction.
    state.fitEpisodes.set("ep-old", {
      fit_episode_id: "ep-old", artifact_fit_id: "fitOld", is_active: false,
      comparable_resolved_count: 0,
      layer_a_wins: 0, layer_a_losses: 0, layer_a_net: 0,
      layer_b_wins: 0, layer_b_losses: 0, layer_b_net: 0,
    });
    // New active fit episode.
    state.fitEpisodes.set("ep-new", {
      fit_episode_id: "ep-new", artifact_fit_id: "fitNew", is_active: true,
      comparable_resolved_count: 0,
      layer_a_wins: 0, layer_a_losses: 0, layer_a_net: 0,
      layer_b_wins: 0, layer_b_losses: 0, layer_b_net: 0,
    });
    state.activeEpisodeByArtifact.set("fitNew", "ep-new");
    const pid = "33333333-3333-3333-3333-333333333333";
    const targetTs = "2026-07-24T20:15:00.000Z";
    state.predictions.set(pid, {
      prediction_id: pid, fit_episode_id: "ep-old", artifact_fit_id: "fitOld",
      target_candle_ts: targetTs,
      layer_a_direction: "GREEN", layer_b_direction: "GREEN",
      final_prediction: "GREEN", resolved_at: null,
    });
    seedCandle(state, targetTs, 100, 105, 99, 104); // GREEN win
    vi.useFakeTimers(); vi.setSystemTime(new Date(new Date(targetTs).getTime() + 20 * 60 * 1000));
    await resolveDueA96Predictions(sb);
    expect(state.fitEpisodes.get("ep-old")!.comparable_resolved_count).toBe(1);
    expect(state.fitEpisodes.get("ep-new")!.comparable_resolved_count).toBe(0);
    vi.useRealTimers();
  });

  it("resolution failure stamps error + last_resolution_attempt_at, next pass retries", async () => {
    const { sb, state } = makeDb();
    const pid = "44444444-4444-4444-4444-444444444444";
    const targetTs = "2026-07-24T20:15:00.000Z";
    state.predictions.set(pid, {
      prediction_id: pid, fit_episode_id: "ep-x", artifact_fit_id: "fitX",
      target_candle_ts: targetTs,
      layer_a_direction: "GREEN", layer_b_direction: "GREEN",
      final_prediction: "GREEN", resolved_at: null,
    });
    state.fitEpisodes.set("ep-x", {
      fit_episode_id: "ep-x", artifact_fit_id: "fitX", is_active: true,
      comparable_resolved_count: 0,
      layer_a_wins: 0, layer_a_losses: 0, layer_a_net: 0,
      layer_b_wins: 0, layer_b_losses: 0, layer_b_net: 0,
    });
    // No candle seeded → resolution fails
    vi.useFakeTimers(); vi.setSystemTime(new Date(new Date(targetTs).getTime() + 20 * 60 * 1000));
    const r1 = await resolveDueA96Predictions(sb);
    expect(r1.failed).toBe(1);
    const row = state.predictions.get(pid)!;
    expect(row.last_resolution_error).toBeTruthy();
    expect(row.last_resolution_attempt_at).toBeTruthy();
    // Seed the candle → retry succeeds on next pass.
    seedCandle(state, targetTs, 100, 105, 99, 104);
    const r2 = await resolveDueA96Predictions(sb);
    expect(r2.resolved).toBe(1);
    expect(state.predictions.get(pid)!.resolved_at).toBeTruthy();
    vi.useRealTimers();
  });
});

describe("a96 orchestrator ordering + audit persistence", () => {
  it("runA96 resolves due predictions before reading fit state", { timeout: 20000 }, async () => {
    const { sb, state } = makeDb();
    seedFit(state, "fitOrd");
    const pending = "55555555-5555-5555-5555-555555555555";
    const targetTs = "2026-07-24T20:15:00.000Z";
    state.predictions.set(pending, {
      prediction_id: pending, fit_episode_id: "ep-fitOrd", artifact_fit_id: "fitOrd",
      target_candle_ts: targetTs,
      layer_a_direction: "GREEN", layer_b_direction: "GREEN",
      final_prediction: "GREEN", resolved_at: null,
    });
    state.fitEpisodes.set("ep-fitOrd", {
      fit_episode_id: "ep-fitOrd", artifact_fit_id: "fitOrd", is_active: true,
      comparable_resolved_count: 0,
      layer_a_wins: 0, layer_a_losses: 0, layer_a_net: 0,
      layer_b_wins: 0, layer_b_losses: 0, layer_b_net: 0,
    });
    state.activeEpisodeByArtifact.set("fitOrd", "ep-fitOrd");
    seedCandle(state, targetTs, 100, 105, 99, 104);

    const newPid = "66666666-6666-6666-6666-666666666666";
    const newTargetTs = "2026-07-24T21:00:00.000Z";
    seedAasAndSourcePrediction(state, { predictionId: newPid, targetTs: newTargetTs, open: 200, layerA: "GREEN", layerB: "RED", base: "A" });

    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 }); vi.setSystemTime(new Date(new Date(newTargetTs).getTime() - 30_000));
    await runA96(sb, newPid);
    const order = state.resolveDueCalledBeforeFitRead;
    const firstFitRead = order.indexOf("fitRead");
    const anyResolve = order.indexOf("resolveDue");
    expect(anyResolve).toBeGreaterThanOrEqual(0);
    expect(anyResolve).toBeLessThan(firstFitRead);
    vi.useRealTimers();
  });

  it("persists prior_candles_snapshot on a DISAGREEMENT row (not just agreement)", async () => {
    const { sb, state } = makeDb();
    seedFit(state, "fitDis");
    const pid = "77777777-7777-7777-7777-777777777777";
    const targetTs = "2026-07-24T21:00:00.000Z";
    seedAasAndSourcePrediction(state, { predictionId: pid, targetTs, open: 200, layerA: "GREEN", layerB: "RED", base: "A" });
    // Seed 4 contiguous prior candles at 15m intervals; closes are pinned
    // near targetOpen (200) so the a96 candle-data-integrity guard passes.
    for (let i = 4; i >= 1; i--) {
      const ts = new Date(new Date(targetTs).getTime() - i * 900_000).toISOString();
      seedCandle(state, ts, 199, 201, 198, 200);
    }
    vi.useFakeTimers(); vi.setSystemTime(new Date(new Date(targetTs).getTime() - 30_000));
    await runA96(sb, pid);
    const row = state.predictions.get(pid)!;
    expect(Array.isArray(row.prior_candles_snapshot)).toBe(true);
    expect(row.prior_candles_snapshot.length).toBe(4);
    expect(row.feature_history_valid).toBe(true);
    // On disagreement branch the engine leaves feature_values null, but raw features still persist.
    expect(row.distance_from_4_candle_low_bps).not.toBeNull();
    expect(row.mean_2_candle_body_to_range).not.toBeNull();
    vi.useRealTimers();
  });

  it("persists prior_candles_snapshot on an AGREEMENT row", async () => {
    const { sb, state } = makeDb();
    seedFit(state, "fitAgr");
    const pid = "88888888-8888-8888-8888-888888888888";
    const targetTs = "2026-07-24T21:00:00.000Z";
    seedAasAndSourcePrediction(state, { predictionId: pid, targetTs, open: 200, layerA: "GREEN", layerB: "GREEN", base: "A" });
    for (let i = 4; i >= 1; i--) {
      const ts = new Date(new Date(targetTs).getTime() - i * 900_000).toISOString();
      seedCandle(state, ts, 199, 201, 198, 200);
    }
    vi.useFakeTimers(); vi.setSystemTime(new Date(new Date(targetTs).getTime() - 30_000));
    await runA96(sb, pid);
    const row = state.predictions.get(pid)!;
    expect(row.prior_candles_snapshot.length).toBe(4);
    expect(row.feature_history_valid).toBe(true);
    expect(row.distance_from_4_candle_low_bps).not.toBeNull();
    vi.useRealTimers();
  });
});

describe("a96 CSV export shape", () => {
  it("selects * so every new resolution/audit column is included", async () => {
    const src = await import("node:fs/promises").then((fs) => fs.readFile("src/lib/predictions.functions.ts", "utf8"));
    const exportBlock = src.slice(src.indexOf("exportA96Csv"));
    expect(exportBlock).toMatch(/\.from\("a96_predictions"\)[\s\S]*\.select\("\*"\)/);
  });
});

describe("a96 candle-data-integrity guard", () => {
  it("ABSTAINs and stamps candle_data_invalid_reason when prior candles are missing", { timeout: 20000 }, async () => {
    const { sb, state } = makeDb();
    seedFit(state, "fitMiss");
    const pid = "99999999-9999-9999-9999-999999999999";
    const targetTs = "2026-07-24T21:00:00.000Z";
    seedAasAndSourcePrediction(state, { predictionId: pid, targetTs, open: 200, layerA: "GREEN", layerB: "GREEN", base: "A" });
    // NO prior candles seeded. Retry-poll returns empty; guard must abstain.
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
    vi.setSystemTime(new Date(new Date(targetTs).getTime() - 30_000));
    await runA96(sb, pid);
    const row = state.predictions.get(pid)!;
    expect(row.candle_data_valid).toBe(false);
    expect(row.candle_data_invalid_reason).toMatch(/missing_prior_timestamps/);
    expect(row.final_prediction).toBe("ABSTAIN");
    expect(row.decision_reason).toMatch(/INVALID_CANDLE_DATA/);
    expect(row.candle_symbol).toBe("BTC-USDT");
    expect(row.candle_timeframe).toBe("15m");
    expect(row.candle_provider).toBe("okx");
    vi.useRealTimers();
  });

  it("ABSTAINs when target_open drifts beyond the tolerance from prev close", async () => {
    const { sb, state } = makeDb();
    seedFit(state, "fitDrift");
    const pid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const targetTs = "2026-07-24T21:00:00.000Z";
    // targetOpen 200, but the immediate prior candle closes at 180 (>1000 bps drift).
    seedAasAndSourcePrediction(state, { predictionId: pid, targetTs, open: 200, layerA: "GREEN", layerB: "GREEN", base: "A" });
    for (let i = 4; i >= 1; i--) {
      const ts = new Date(new Date(targetTs).getTime() - i * 900_000).toISOString();
      seedCandle(state, ts, 180, 182, 178, 180);
    }
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
    vi.setSystemTime(new Date(new Date(targetTs).getTime() - 30_000));
    await runA96(sb, pid);
    const row = state.predictions.get(pid)!;
    expect(row.candle_data_valid).toBe(false);
    expect(row.candle_data_invalid_reason).toMatch(/target_open_vs_prev_close/);
    expect(row.final_prediction).toBe("ABSTAIN");
    expect(row.target_open_difference_bps).toBeGreaterThan(30);
    vi.useRealTimers();
  });

  it("persists stream identity (symbol/timeframe/provider + row ids) on a valid AGREEMENT row", async () => {
    const { sb, state } = makeDb();
    seedFit(state, "fitOk");
    const pid = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const targetTs = "2026-07-24T21:00:00.000Z";
    seedAasAndSourcePrediction(state, { predictionId: pid, targetTs, open: 200, layerA: "GREEN", layerB: "GREEN", base: "A" });
    for (let i = 4; i >= 1; i--) {
      const ts = new Date(new Date(targetTs).getTime() - i * 900_000).toISOString();
      seedCandle(state, ts, 199, 201, 198, 200);
    }
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
    vi.setSystemTime(new Date(new Date(targetTs).getTime() - 30_000));
    await runA96(sb, pid);
    const row = state.predictions.get(pid)!;
    expect(row.candle_data_valid).toBe(true);
    expect(row.candle_symbol).toBe("BTC-USDT");
    expect(row.candle_provider).toBe("okx");
    expect(Array.isArray(row.prior_candle_row_ids)).toBe(true);
    expect(row.prior_candle_row_ids.length).toBe(4);
    expect(row.prospective_valid).toBe(true);
    vi.useRealTimers();
  });
});


describe("a96 exact-timestamp candle query + ingest-ordering contract", () => {
  it("queries exactly the four expected timestamps and never substitutes older confirmed rows", { timeout: 20000 }, async () => {
    const { sb, state } = makeDb();
    seedFit(state, "fitExact");
    const pid = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const targetTs = "2026-07-25T01:15:00.000Z";
    seedAasAndSourcePrediction(state, { predictionId: pid, targetTs, open: 200, layerA: "GREEN", layerB: "GREEN", base: "A" });
    // Seed OLDER confirmed candles (three days earlier). These MUST NOT be
    // substituted for the missing T-15m..T-60m timestamps.
    for (let i = 4; i >= 1; i--) {
      const ts = new Date(new Date(targetTs).getTime() - i * 900_000 - 3 * 24 * 60 * 60 * 1000).toISOString();
      seedCandle(state, ts, 199, 201, 198, 200);
    }
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
    vi.setSystemTime(new Date(new Date(targetTs).getTime() - 30_000));
    await runA96(sb, pid);
    const row = state.predictions.get(pid)!;
    expect(row.candle_data_valid).toBe(false);
    expect(row.decision_reason).toMatch(/ABSTAIN_INVALID_CANDLE_DATA/);
    expect(row.prior_candles_snapshot.length).toBe(0);
    expect(row.prior_candle_row_ids.length).toBe(0);
    expect(row.prospective_valid).toBe(false);
    expect(row.prospective_invalid_reason).toBe("FINALIZED_PRIOR_CANDLE_UNAVAILABLE");
    vi.useRealTimers();
  });

  it("candle_data_valid=false always implies prospective_valid=false", async () => {
    const { sb, state } = makeDb();
    seedFit(state, "fitInv");
    const pid = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const targetTs = "2026-07-25T02:00:00.000Z";
    seedAasAndSourcePrediction(state, { predictionId: pid, targetTs, open: 200, layerA: "GREEN", layerB: "GREEN", base: "A" });
    for (let i = 4; i >= 1; i--) {
      const ts = new Date(new Date(targetTs).getTime() - i * 900_000).toISOString();
      seedCandle(state, ts, 180, 182, 178, 180);
    }
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
    vi.setSystemTime(new Date(new Date(targetTs).getTime() - 30_000));
    await runA96(sb, pid);
    const row = state.predictions.get(pid)!;
    expect(row.candle_data_valid).toBe(false);
    expect(row.prospective_valid).toBe(false);
    vi.useRealTimers();
  });

  it("target_open_difference_bps is populated on every resolved row (even below threshold)", async () => {
    const { sb, state } = makeDb();
    seedFit(state, "fitDiff");
    const pid = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const targetTs = "2026-07-25T02:15:00.000Z";
    state.predictions.set(pid, {
      prediction_id: pid, fit_episode_id: "ep-fitDiff", artifact_fit_id: "fitDiff",
      target_candle_ts: targetTs,
      layer_a_direction: "GREEN", layer_b_direction: "GREEN",
      final_prediction: "GREEN", resolved_at: null,
      target_open: 63955.62,
      candle_provider: "okx",
    });
    state.fitEpisodes.set("ep-fitDiff", {
      fit_episode_id: "ep-fitDiff", artifact_fit_id: "fitDiff", is_active: true,
      comparable_resolved_count: 0,
      layer_a_wins: 0, layer_a_losses: 0, layer_a_net: 0,
      layer_b_wins: 0, layer_b_losses: 0, layer_b_net: 0,
    });
    state.activeEpisodeByArtifact.set("fitDiff", "ep-fitDiff");
    seedCandle(state, targetTs, 64021.70, 64100, 63900, 64050);
    vi.useFakeTimers(); vi.setSystemTime(new Date(new Date(targetTs).getTime() + 20 * 60 * 1000));
    await resolveDueA96Predictions(sb);
    const row = state.predictions.get(pid)!;
    expect(row.target_open_difference_bps).not.toBeNull();
    expect(typeof row.target_open_difference_bps).toBe("number");
    expect(row.target_open_difference_bps).toBeGreaterThan(9);
    expect(row.target_open_difference_bps).toBeLessThan(12);
    expect(row.resolution_data_invalid).toBe(false);
    vi.useRealTimers();
  });

  it("resolution demotes prospective_valid=false when actual_open drifts beyond tolerance", async () => {
    const { sb, state } = makeDb();
    seedFit(state, "fitBad");
    const pid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const targetTs = "2026-07-25T02:30:00.000Z";
    state.predictions.set(pid, {
      prediction_id: pid, fit_episode_id: "ep-fitBad", artifact_fit_id: "fitBad",
      target_candle_ts: targetTs,
      layer_a_direction: "GREEN", layer_b_direction: "GREEN",
      final_prediction: "GREEN", resolved_at: null,
      target_open: 60000, candle_provider: "okx",
      prospective_valid: true,
    });
    state.fitEpisodes.set("ep-fitBad", {
      fit_episode_id: "ep-fitBad", artifact_fit_id: "fitBad", is_active: true,
      comparable_resolved_count: 0,
      layer_a_wins: 0, layer_a_losses: 0, layer_a_net: 0,
      layer_b_wins: 0, layer_b_losses: 0, layer_b_net: 0,
    });
    seedCandle(state, targetTs, 63000, 63100, 62900, 63050);
    vi.useFakeTimers(); vi.setSystemTime(new Date(new Date(targetTs).getTime() + 20 * 60 * 1000));
    await resolveDueA96Predictions(sb);
    const row = state.predictions.get(pid)!;
    expect(row.resolution_data_invalid).toBe(true);
    expect(row.prospective_valid).toBe(false);
    expect(row.prospective_invalid_reason).toMatch(/actual_open_vs_target_open/);
    vi.useRealTimers();
  });
});
