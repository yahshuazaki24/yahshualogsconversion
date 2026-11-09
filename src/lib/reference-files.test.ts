import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { autoConvert, exportSelection, SLOTS, verifyConversion } from "./converter";
import { readTextSheets, readWorkbookSheets } from "./file-reader";
import { convertWithRecipe } from "./recipe";

// Real uploaded files, with employee names masked; punch cells and IDs are unchanged.
const csv = readFileSync("src/lib/__fixtures__/ngteco-tc2.csv", "utf8");
const book = readFileSync("src/lib/__fixtures__/ngteco-k4.xls");
const flatSheets = readTextSheets(csv);
const cardSheets = readWorkbookSheets(book.buffer.slice(book.byteOffset, book.byteOffset + book.byteLength));
const flat = autoConvert(flatSheets);
const card = autoConvert(cardSheets);
const flatCounts = exportSelection(flat.rows, false);
const cardCounts = exportSelection(card.rows, false);
const base = { sheet: 0, headerRow: 0, idColumn: 0, idLabel: null, dateColumn: 2, dayHeaderRow: null, rangeRow: null, timeColumns: [3], dateFormat: "MM/DD/YYYY", timeFormat: "mixed", punchTypeColumn: null, punchMapping: [] };

describe("NGTECO TC2 real-file regression", () => {
  it("produces 329 punched days", () => expect(flat.rows).toHaveLength(329));
  it("preserves 44 employee IDs, never device IDs", () => {
    expect(new Set(flat.rows.map((r) => r.systemId)).size).toBe(44);
    expect(flat.rows.some((r) => r.systemId.startsWith("UWH"))).toBe(false);
  });
  it("has 82 errors", () => expect(flatCounts.errors).toBe(82));
  it("has 1 warning", () => expect(flatCounts.warnings).toBe(1));
  it("merges exactly 2 taps using seconds before truncation", () => {
    expect(flat.stats?.merged).toBe(2);
    expect(flat.rows.find((r) => r.systemId === "RW0004" && r.date === "10/6/2026")?.extra).toEqual(["17:05"]);
  });
  it("accounts for all 1118 punches and only outputs times from the same source ID/date", () => {
    expect(flat.stats).toEqual({ parsed: 1118, placed: 1101, extras: 15, merged: 2 });
    expect(verifyConversion(flat)).toEqual([]);
    const source = new Map<string, Set<string>>();
    for (const r of (flatSheets[0] ?? []).slice(1)) {
      const [id, , date, time] = r;
      if (!id || !date || !time) continue;
      const [m, d, y] = date.split("/");
      const key = `${id}|${Number(m)}/${Number(d)}/${y}`;
      const times = source.get(key) ?? new Set<string>();
      times.add(time.slice(0, 5)); source.set(key, times);
    }
    for (const row of flat.rows) for (const time of [...SLOTS.map((s) => row[s]), ...row.extra].filter(Boolean)) {
      expect(source.get(`${row.systemId}|${row.date}`)?.has(time)).toBe(true);
    }
  });
  it("recipe conversion matches deterministic counts and seconds-aware merges", () => {
    const result = convertWithRecipe(flatSheets, { format: "NGTECO TC2", confidence: 0.99, sheets: [{ ...base, layout: "long" }] });
    expect(result.stats).toEqual(flat.stats);
    expect(exportSelection(result.rows, false).errors).toBe(82);
  });
});

describe("NGTeco K4 real-file regression", () => {
  it("produces 200 punched days", () => expect(card.rows).toHaveLength(200));
  it("counts 52 employees with punches", () => expect(new Set(card.rows.map((r) => r.systemId)).size).toBe(52));
  it("has 50 errors", () => expect(cardCounts.errors).toBe(50));
  it("has 7 warnings", () => expect(cardCounts.warnings).toBe(7));
  it("resolves every date despite Date being over the weekday column", () => {
    expect(card.rows.every((r) => /^10\/[2-8]\/2026$/.test(r.date))).toBe(true);
    expect(verifyConversion(card)).toEqual([]);
  });
  it("extracts ID 5 and keeps the October 2 explicit pairs", () => {
    const row = card.rows.find((r) => r.systemId === "5" && r.date === "10/2/2026");
    expect(row && SLOTS.map((s) => row[s])).toEqual(["07:50", "12:02", "12:54", "17:03"]);
  });
  it("keeps every explicit pair and extra, including equal-time partners", () => {
    expect(card.stats).toEqual({ parsed: 712, placed: 682, extras: 30, merged: 0 });
    const row = card.rows.find((r) => r.systemId === "26" && r.date === "10/3/2026");
    expect(row && SLOTS.map((s) => row[s])).toEqual(["07:39", "07:40", "12:08", "12:51"]);
    expect(row?.extra).toEqual(["12:51", "16:55"]);
  });
  it("timecard recipes preserve extras, pairs, dates and verification metadata", () => {
    const result = convertWithRecipe(cardSheets, { format: "NGTeco K4", confidence: 0.99, sheets: [{ ...base, layout: "timecard" }] });
    expect(result.stats).toEqual(card.stats);
    expect(result.period).toEqual(card.period);
    expect(exportSelection(result.rows, false).warnings).toBe(7);
  });
});