// External parity fixture — B4x4-20260810.
//
// The engine is replayed against a FROZEN external CSV fixture (never against
// itself). State is built from the pinned source epoch, chronologically,
// carrying the Boise daily brake across the BACKFILL → LIVE boundary; the
// score is reported only over the defined LIVE slice.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replayB4x4, type SourceRow } from "../engine";

const FIXTURE = join(__dirname, "fixtures", "b4x4_live_slice_20260810.csv");

const LIVE_SLICE_START = Date.parse("2026-08-07T04:30:00.000Z");
const LIVE_SLICE_END = Date.parse("2026-08-11T00:00:00.000Z");

interface FixtureRow {
  ts: string;
  runMode: string;
  source: SourceRow;
  storedWouldTrade: boolean;
  storedResult: string | null;
  storedScore: number;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split("\n");
  const header = lines[0]!.split(",");
  return lines.slice(1).map((line) => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

function loadFixture(): FixtureRow[] {
  return parseCsv(readFileSync(FIXTURE, "utf8")).map((r) => {
    const ts = new Date(r["b4x4_target_candle_ts"]!).toISOString();
    const prob = r["b4x4_a2_probability_green"];
    const dir = r["b4x4_actual_direction"];
    return {
      ts,
      runMode: r["b4x4_run_mode"] ?? "",
      source: {
        candleTs: ts,
        probabilityGreen: prob ? Number(prob) : null,
        timingStatus: r["b4x4_timing_status"] || null,
        leakageCheckPassed:
          r["b4x4_leakage_check_passed"] === "" ? null : r["b4x4_leakage_check_passed"] === "true",
        actualDirection: dir === "GREEN" || dir === "RED" ? dir : null,
      },
      storedWouldTrade: r["b4x4_would_trade"] === "true",
      storedResult: r["b4x4_result"] || null,
      storedScore: r["b4x4_result_score"] ? Number(r["b4x4_result_score"]) : 0,
    };
  });
}

function inLiveSlice(r: FixtureRow): boolean {
  const t = Date.parse(r.ts);
  return r.runMode === "LIVE" && t >= LIVE_SLICE_START && t <= LIVE_SLICE_END;
}

describe("B4x4 external fixture parity (B4x4-20260810)", () => {
  const fixture = loadFixture();

  it("fixture shape matches the pinned checkpoint window", () => {
    expect(fixture[0]!.ts).toBe("2026-07-15T22:00:00.000Z");
    const live = fixture.filter(inLiveSlice);
    expect(live.length).toBe(363);
    const unresolved = live.filter((r) => r.source.actualDirection === null).map((r) => r.ts);
    expect(unresolved).toEqual([
      "2026-08-09T11:15:00.000Z",
      "2026-08-11T00:00:00.000Z",
    ]);
    // No synthetic LIVE rows are created for the four absent targets.
    const present = new Set(live.map((r) => r.ts));
    for (const gap of [
      "2026-08-08T20:30:00.000Z",
      "2026-08-08T20:45:00.000Z",
      "2026-08-08T21:00:00.000Z",
      "2026-08-08T21:15:00.000Z",
    ]) {
      expect(present.has(gap)).toBe(false);
    }
  });

  it("stored (pre-repair) LIVE slice reproduces 170 trades, 94-76, +18", () => {
    const live = fixture.filter(inLiveSlice);
    const traded = live.filter((r) => r.storedWouldTrade && r.storedResult != null);
    const wins = traded.filter((r) => r.storedResult === "WIN").length;
    const losses = traded.filter((r) => r.storedResult === "LOSS").length;
    expect(traded.length).toBe(170);
    expect(wins).toBe(94);
    expect(losses).toBe(76);
    expect(wins - losses).toBe(18);
  });

  it("corrected 768-row replay reproduces the LIVE slice checkpoint", () => {
    // Build state from the pinned epoch across every preceding row.
    const replay = replayB4x4(fixture.map((r) => r.source));
    const byTs = new Map(replay.map((r) => [r.row.candleTs, r]));

    let trades = 0;
    let wins = 0;
    let losses = 0;
    let net = 0;
    let running = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let evaluable = 0;
    const daily = new Map<string, number>();

    for (const f of fixture.filter(inLiveSlice)) {
      const r = byTs.get(f.ts);
      if (!r) continue;
      const d = r.decision;
      if (!String(d.decisionReason).startsWith("ABSTAIN_A2_") &&
          !String(d.decisionReason).startsWith("ABSTAIN_WARMUP") &&
          !String(d.decisionReason).startsWith("ABSTAIN_SOURCE") &&
          !String(d.decisionReason).startsWith("ABSTAIN_GRID_REFERENCE")) {
        evaluable++;
      }
      if (!d.wouldTrade) continue;
      // Unresolved / doji outcomes are excluded from score.
      if (f.source.actualDirection == null) continue;
      trades++;
      const won = d.finalPrediction === f.source.actualDirection;
      if (won) wins++; else losses++;
      const score = won ? 1 : -1;
      net += score;
      running += score;
      peak = Math.max(peak, running);
      maxDrawdown = Math.max(maxDrawdown, peak - running);
      daily.set(d.localDate, (daily.get(d.localDate) ?? 0) + score);
    }

    expect({ trades, wins, losses, net }).toEqual({ trades: 166, wins: 91, losses: 75, net: 16 });
    expect(Number(((wins / (wins + losses)) * 100).toFixed(2))).toBe(54.82);
    expect(maxDrawdown).toBe(9);
    expect([...daily.keys()].sort().map((k) => daily.get(k))).toEqual([1, 6, -1, 13, -3]);
  });

  it("reports an explicit row-level mismatch count vs the stored pre-repair rows", () => {
    const replay = replayB4x4(fixture.map((r) => r.source));
    const byTs = new Map(replay.map((r) => [r.row.candleTs, r]));
    const live = fixture.filter(inLiveSlice);

    let compared = 0;
    let tradeMismatches = 0;
    let outcomeMismatches = 0;
    for (const f of live) {
      const d = byTs.get(f.ts)?.decision;
      if (!d) continue;
      compared++;
      if (d.wouldTrade !== f.storedWouldTrade) tradeMismatches++;
      if (d.wouldTrade && f.storedWouldTrade && f.source.actualDirection != null) {
        const score = d.finalPrediction === f.source.actualDirection ? 1 : -1;
        if (score !== f.storedScore) outcomeMismatches++;
      }
    }

    // Every LIVE fixture row is compared; mismatches are the pre-repair
    // truncated-window rows and are reported exactly, not just in aggregate.
    expect(compared).toBe(363);
    expect(tradeMismatches).toBe(12);
    expect(outcomeMismatches).toBe(0);
  });
});
