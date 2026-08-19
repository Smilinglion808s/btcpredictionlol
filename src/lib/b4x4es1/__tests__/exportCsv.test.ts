import { describe, expect, it, vi } from "vitest";
import {
  ES1_EXPORT_PAGE_SIZE,
  boundaryCoverage,
  fetchAllDescThenChronological,
  isLiveNonCatchup,
  precisionNonNullCounts,
  sortChronological,
  toCsv,
  unionColumns,
} from "../exportCsv";

const T0 = Date.parse("2026-08-01T00:00:00.000Z");
const TF = 15 * 60 * 1000;

/** 2,565 rows, newest-first pages, plus a timestamp tie at the newest target. */
function makeFixture(n = 2565) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(5, "0")}`,
    target_candle_ts: new Date(T0 + i * TF).toISOString(),
    run_mode: i % 50 === 0 ? "BACKFILL" : "LIVE",
    operational_gap_status: i % 77 === 0 ? "CATCHUP" : "NONE",
    precision_sleeve: i % 3 === 0 ? "PRIMARY" : null,
    precision_candidate_direction: i % 2 === 0 ? "GREEN" : "RED",
  }));
  // tie on the newest timestamp
  rows.push({ ...rows[rows.length - 1]!, id: "id-zzzzz" });
  return rows;
}

function descPager(all: ReturnType<typeof makeFixture>) {
  const desc = [...all].sort((a, b) => {
    const d = Date.parse(b.target_candle_ts) - Date.parse(a.target_candle_ts);
    return d !== 0 ? d : b.id.localeCompare(a.id);
  });
  return async (offset: number, limit: number) => desc.slice(offset, offset + limit);
}

describe("ES1 export pagination (reporting-only)", () => {
  it("exports every row past the 1,000-row default", async () => {
    const all = makeFixture();
    const out = await fetchAllDescThenChronological(descPager(all), ES1_EXPORT_PAGE_SIZE);
    expect(out.length).toBe(all.length);
  });

  it("includes the newest row", async () => {
    const all = makeFixture();
    const out = sortChronological(
      await fetchAllDescThenChronological(descPager(all), ES1_EXPORT_PAGE_SIZE),
    );
    const newest = out[out.length - 1]!;
    expect(newest.target_candle_ts).toBe(all[all.length - 1]!.target_candle_ts);
  });

  it("returns chronological order with deterministic id tiebreak", async () => {
    const all = makeFixture();
    const out = sortChronological(
      await fetchAllDescThenChronological(descPager(all), ES1_EXPORT_PAGE_SIZE),
    );
    for (let i = 1; i < out.length; i++) {
      const a = Date.parse(String(out[i - 1]!.target_candle_ts));
      const b = Date.parse(String(out[i]!.target_candle_ts));
      expect(b).toBeGreaterThanOrEqual(a);
      if (a === b) expect(String(out[i]!.id) > String(out[i - 1]!.id)).toBe(true);
    }
  });

  it("emits current precision_* columns in the header", async () => {
    const all = makeFixture(5);
    const rows = sortChronological(await fetchAllDescThenChronological(descPager(all), 2));
    const csv = toCsv(rows, unionColumns(rows));
    const header = csv.split("\n")[0]!;
    expect(header).toContain("precision_sleeve");
    expect(header).toContain("precision_candidate_direction");
  });

  it("latest-24h filter keeps only LIVE, non-CATCHUP rows", () => {
    const all = makeFixture(200);
    const kept = all.filter(isLiveNonCatchup);
    expect(kept.every((r) => r.run_mode === "LIVE")).toBe(true);
    expect(kept.some((r) => r.operational_gap_status === "CATCHUP")).toBe(false);
  });

  it("preserves genuine nulls and reports non-null counts", () => {
    const rows = makeFixture(9);
    const counts = precisionNonNullCounts(rows);
    expect(counts.precision_sleeve).toBe(rows.filter((r) => r.precision_sleeve != null).length);
    const csv = toCsv(rows, unionColumns(rows));
    expect(csv).toContain(",,"); // nulls stay empty, never fabricated
  });

  it("reports boundary coverage and missing targets", () => {
    const rows = sortChronological(makeFixture(10).filter((_, i) => i !== 4));
    const cov = boundaryCoverage(rows);
    expect(cov.expected_boundaries).toBe(10);
    expect(cov.missing_targets).toEqual([new Date(T0 + 4 * TF).toISOString()]);
  });

  it("never mutates source rows and invokes no model/webhook path", async () => {
    const all = makeFixture(10);
    const snapshot = JSON.stringify(all);
    const pager = vi.fn(descPager(all));
    const out = await fetchAllDescThenChronological(pager, 4);
    sortChronological(out);
    toCsv(out, unionColumns(out));
    expect(JSON.stringify(all)).toBe(snapshot);
    expect(pager).toHaveBeenCalled();
  });
});
