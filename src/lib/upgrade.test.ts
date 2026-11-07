import { describe, expect, it } from "vitest";
import { autoConvert, exportSelection, filterRows, toCsv, validate } from "./converter";
import { convertWithRecipe, makeSample, recipeSchema } from "./recipe";

const block = [["Attendance Record Report 2026-10-01 ~ 2026-10-16"], ["", "1", "2"], ["ID:", "1"], ["", "08:5514:4815:4618:00", ""]];
const times = ["08:55", "14:48", "15:46", "18:00"];
const spec = { sheet: 0, layout: "long" as const, headerRow: 0, idColumn: 0, idLabel: null, dateColumn: 1, dayHeaderRow: null, rangeRow: null, timeColumns: [1], dateFormat: "ISO" as const, timeFormat: "mixed" as const, punchTypeColumn: null, punchMapping: [] };

describe("payroll upgrade rules", () => {
  it("removes repeat taps up to 2 minutes, keeping the first retained punch", () => {
    const { rows } = autoConvert([[["ID", "Date", "Time"], ...["08:00", "08:00", "08:01", "08:02", "08:03", "17:00"].map((t) => ["1", "2026-10-01", t])]]);
    expect([rows[0]?.IN, rows[0]?.OUT, rows[0]?.["IN.1"]]).toEqual(["08:00", "08:03", "17:00"]);
  });
  it("headerless, BioTime, NGTECO, Hikvision, block and matrix give identical columns", () => {
    const expected = "10/1/2026,1,08:55,14:48,15:46,18:00";
    const layouts = [times.map((t) => ["1", `2026-10-01 ${t}`, "0", "1"]), ...["BioTime", "NGTECO", "Hikvision"].map((brand) => [[brand], ["Emp Code", "Punch Time", "Punch State", "Terminal"], ...times.map((t) => ["1", `2026-10-01 ${t}`, "0", "1"])]), block, [["Employee", "2026-10-01", "2026-10-02"], ["1 Ana", times.join(" "), ""]]];
    for (const sheet of layouts) expect(toCsv(autoConvert([sheet]).rows).split("\r\n")[1]).toBe(expected);
  });
  it("ID/date searches combine as partial matches", () => {
    const rows = autoConvert([[["ID", "Date", "Time"], ["001", "2026-10-01", "08:00 17:00"], ["002", "2026-10-02", "09:00 18:00"]]]).rows;
    expect(filterRows(rows, "01", "10/1").map((r) => r.systemId)).toEqual(["001"]);
    expect(filterRows(rows, "01", "10/2")).toEqual([]);
  });
  it("exports only flagged rows and confirms both errors and warnings", () => {
    const rows = autoConvert([block]).rows;
    expect(exportSelection(rows, false).needsConfirmation).toBe(false);
    const bad = { ...rows[0], key: "bad", IN: "08:55", OUT: "", "IN.1": "", "OUT.1": "", extra: [] };
    if (!bad.date || !bad.systemId) throw new Error("Expected sample row");
    const all = [...rows, bad as typeof rows[number]];
    expect(exportSelection(all, true).rows.map((r) => r.key)).toEqual(["bad"]);
    expect(exportSelection(all, false).errors).toBe(1);
    expect(exportSelection(all, true).needsConfirmation).toBe(true);
    const warning = { ...rows[0], extra: ["19:00", "20:00"] } as typeof rows[number];
    expect(exportSelection([warning], false).warnings).toBe(1);
  });
  it("bounds samples at 100 rows (head + block + tail) and masks names in separate/combined cells", () => {
    const sample = makeSample([[["Emp Code", "Name", "Punch Time"], ...Array.from({ length: 160 }, () => ["001 Ana Cruz", "Ben Reyes", "2026-10-01 08:00"])]]);
    expect(sample[0]?.rows.length).toBeLessThanOrEqual(100);
    expect(sample[0]?.rows[0]?.row).toBe(0);
    expect(sample[0]?.rows.at(-1)?.row).toBe(160);
    expect(JSON.stringify(sample)).not.toMatch(/Ana|Cruz|Ben|Reyes/);
    expect(sample[0]?.rows[1]?.cells[0]).toBe("001 [masked]");
  });
  it("applies schema-validated recipes locally, never generated output values", () => {
    const recipe = { format: "Transaction log", confidence: 0.95, sheets: [spec] };
    const rows = convertWithRecipe([[["Emp Code", "Punch Time"], ...times.map((t) => ["1", `2026-10-01 ${t}`])]], recipe).rows;
    expect(toCsv(rows).split("\r\n")[1]).toBe("10/1/2026,1,08:55,14:48,15:46,18:00");
    expect(recipeSchema.safeParse({ ...recipe, confidence: 2 }).success).toBe(false);
    expect(() => convertWithRecipe([block], { ...recipe, confidence: 0.2 })).toThrow("Low confidence");
  });
  it("reads declared serial dates and fractional-day times", () => {
    const rows = convertWithRecipe([[["ID", "Date", "In", "Out"], ["001", "46296", "0.375", "0.75"]]], { format: "Serial wide", confidence: 0.9, sheets: [{ ...spec, layout: "wide", timeColumns: [2, 3], dateFormat: "excel", timeFormat: "excel" }] }).rows;
    expect([rows[0]?.systemId, rows[0]?.IN, rows[0]?.OUT]).toEqual(["001", "09:00", "18:00"]);
    expect(rows[0]?.date).toBe("10/1/2026");
  });
  it("consistent punch types preserve placement rather than shifting", () => {
    const rows = convertWithRecipe([[["ID", "Time", "State"], ["1", "2026-10-01 08:00", "in"], ["1", "2026-10-01 18:00", "final"]]], { format: "Typed", confidence: 0.9, sheets: [{ ...spec, punchTypeColumn: 2, punchMapping: [{ value: "in", slot: "IN" }, { value: "final", slot: "OUT.1" }] }] }).rows;
    expect([rows[0]?.IN, rows[0]?.OUT, rows[0]?.["IN.1"], rows[0]?.["OUT.1"]]).toEqual(["08:00", "", "", "18:00"]);
    expect(validate(rows[0] as typeof rows[number], rows)).toEqual([]);
  });
});