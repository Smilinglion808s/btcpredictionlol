// Pure, reporting-only helpers for the B4x4-ES1 CSV exports.
//
// Nothing here touches predictions, resolution, activation, webhooks or model
// decisions: these functions only page, sort and serialize rows that were
// already written by the orchestrator.

export type ExportRow = Record<string, unknown>;

export const ES1_EXPORT_PAGE_SIZE = 1000;

/** One page of rows, newest-first, starting at `offset`. */
export type DescPageFetcher = (offset: number, limit: number) => Promise<ExportRow[]>;

/**
 * Newest-first, offset-paged read. Keeps requesting successive ranges until a
 * page returns fewer than `pageSize` rows, then reverses the completed array
 * ONCE so the result is chronological (target_candle_ts ASC, id ASC).
 */
export async function fetchAllDescThenChronological(
  fetchPage: DescPageFetcher,
  pageSize: number = ES1_EXPORT_PAGE_SIZE,
): Promise<ExportRow[]> {
  const out: ExportRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    out.push(...page);
    if (page.length < pageSize) break;
  }
  out.reverse();
  return out;
}

/** Deterministic chronological order: target_candle_ts ASC, then id ASC. */
export function sortChronological(rows: ExportRow[]): ExportRow[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(String(a.target_candle_ts)).getTime();
    const tb = new Date(String(b.target_candle_ts)).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
}

export function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Union of every key present in the dataset, so no stale column list is used. */
export function unionColumns(rows: ExportRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

export function toCsv(rows: ExportRow[], columns: string[]): string {
  if (rows.length === 0) return "";
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

/** Non-null counts for every column whose name starts with `precision_`. */
export function precisionNonNullCounts(rows: ExportRow[]): Record<string, number> {
  const cols = unionColumns(rows).filter((c) => c.startsWith("precision_"));
  const counts: Record<string, number> = {};
  for (const c of cols) counts[c] = rows.filter((r) => r[c] != null).length;
  return counts;
}

/** A row belongs in the latest-24h file only when it is LIVE and not CATCHUP. */
export function isLiveNonCatchup(r: ExportRow): boolean {
  return r.run_mode === "LIVE" && String(r.operational_gap_status ?? "NONE") !== "CATCHUP";
}

const TF_MS = 15 * 60 * 1000;

/** Boundary coverage report for a chronological window. */
export function boundaryCoverage(rows: ExportRow[]) {
  if (rows.length === 0)
    return { earliest: null, latest: null, expected_boundaries: 0, missing_targets: [] as string[] };
  const stamps = new Set(rows.map((r) => new Date(String(r.target_candle_ts)).toISOString()));
  const earliest = new Date(String(rows[0]!.target_candle_ts)).getTime();
  const latest = new Date(String(rows[rows.length - 1]!.target_candle_ts)).getTime();
  const missing: string[] = [];
  let expected = 0;
  for (let t = earliest; t <= latest; t += TF_MS) {
    expected++;
    const iso = new Date(t).toISOString();
    if (!stamps.has(iso)) missing.push(iso);
  }
  return {
    earliest: new Date(earliest).toISOString(),
    latest: new Date(latest).toISOString(),
    expected_boundaries: expected,
    missing_targets: missing,
  };
}

export function countBy(rows: ExportRow[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = r[key] == null ? "null" : String(r[key]);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
