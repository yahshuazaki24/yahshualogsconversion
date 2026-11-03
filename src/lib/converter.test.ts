import { describe, it, expect } from "vitest";
import { autoConvert, toCsv, parseTime, formatTime, NoPunchError, NO_PUNCH_MESSAGE, SLOTS, validate, type OutRow } from "./converter";

const simple = (rows: OutRow[]) => rows.map((r) => [r.date, r.systemId, r.IN, r.OUT, r["IN.1"], r["OUT.1"]]);
const run = (...sheets: string[][][]) => simple(autoConvert(sheets).rows);

const LONG = [
  ["ACME Corp — Attendance Log"],
  ["Printed by admin"],
  [],
  ["No.", "Emp", "Name", "Date/Time", "Device"],
  ["1", "001", "Ana Cruz", "03/15/2019 8:00 AM", "Dev1"],
  ["2", "001", "Ana Cruz", "03/15/2019 12:00 PM", "Dev1"],
  ["3", "001", "Ana Cruz", "03/15/2019 1:00 PM", "Dev1"],
  ["4", "001", "Ana Cruz", "03/15/2019 5:00 PM", "Dev1"],
  ["5", "002", "Ben Reyes", "03/15/2019 12:00 AM", "Dev2"],
  ["6", "002", "Ben Reyes", "03/16/2019 9:00", "Dev2"],
  ["7", "002", "Ben Reyes", "03/16/2019 18:30", "Dev2"],
];
const WIDE = [
  ["Daily Time Record"],
  ["Employee", "Date", "Time In", "Time Out", "Time In", "Time Out", "Total Hours"],
  ["001 - Ana Cruz", "3/15/2019", "08:00", "12:00", "13:00", "17:00", "8:00"],
  ["002 - Ben Reyes", "3/15/2019", "00:00", "", "", "", ""],
  ["002 - Ben Reyes", "3/16/2019", "9:00 AM", "6:30 PM", "", "", "9:30"],
];
const MATRIX = [
  ["Attendance Matrix March 2019"],
  ["Employee", "Fri 03/15/2019", "Sat 03/16/2019", "Sun 03/17/2019"],
  ["Ana Cruz (001)", "08:00 12:00 13:00 17:00", "", ""],
  ["Ben Reyes (002)", "00:00", "09:00\n18:30", ""],
];
const EXPECTED = [
  ["3/15/2019", "001", "08:00", "12:00", "13:00", "17:00"],
  ["3/15/2019", "002", "00:00", "", "", ""],
  ["3/16/2019", "002", "09:00", "18:30", "", ""],
];

describe("auto conversion", () => {
  it("long, wide and matrix layouts give identical output", () => {
    expect(run(LONG)).toEqual(EXPECTED);
    expect(run(WIDE)).toEqual(EXPECTED);
    expect(run(MATRIX)).toEqual(EXPECTED);
  });

  it("8:00 AM + 5:00 PM -> IN 08:00, OUT 17:00, rest blank", () => {
    expect(run([["ID", "Date", "Time"], ["7", "3/15/2019", "8:00 AM"], ["7", "3/15/2019", "5:00 PM"]]))
      .toEqual([["3/15/2019", "7", "08:00", "17:00", "", ""]]);
  });

  it("12:00 AM -> 00:00, 12:00 PM -> 12:00", () => {
    expect(formatTime(parseTime("12:00 AM")!)).toBe("00:00");
    expect(formatTime(parseTime("12:00 PM")!)).toBe("12:00");
  });

  it("rejects schedule / shift-code reports", () => {
    const sched = [
      ["Employee Schedule"],
      ["Employee", "3/15/2019", "3/16/2019", "3/17/2019"],
      ["001 Ana", "D1", "08:00-17:00", "OFF"],
      ["002 Ben", "N2", "22:00 - 06:00", "RD"],
    ];
    expect(() => autoConvert([sched])).toThrow(NoPunchError);
    expect(() => autoConvert([sched])).toThrow(NO_PUNCH_MESSAGE);
  });

  it("never outputs a punch that is not in the source", () => {
    for (const sheet of [LONG, WIDE, MATRIX]) {
      const src = new Set<number>();
      sheet.flat().forEach((c) => (c.match(/\d{1,2}:\d{2}\s*(?:[AP]M)?/gi) ?? []).forEach((t) => src.add(parseTime(t)!)));
      for (const r of autoConvert([sheet]).rows)
        for (const s of SLOTS) if (r[s]) expect(src.has(parseTime(r[s])!)).toBe(true);
    }
  });

  it("infers DD/MM from the data and warns when ambiguous", () => {
    const dm = autoConvert([[["ID", "Date", "Time"], ["1", "15/03/2019", "08:00"], ["1", "02/03/2019", "08:00"]]]);
    expect(dm.rows.map((r) => r.date)).toEqual(["3/2/2019", "3/15/2019"]);
    expect(dm.ambiguousDate).toBe(false);
    const amb = autoConvert([[["ID", "Date", "Time"], ["1", "02/03/2019", "08:00"]]]);
    expect(amb.rows[0]!.date).toBe("2/3/2019");
    expect(amb.ambiguousDate).toBe(true);
  });

  const one = (times: string[]) => {
    const res = autoConvert([[["ID", "Date", "Time"], ...times.map((t) => ["001", "1/2/2020", t])]]).rows;
    return { row: res[0]!, issues: validate(res[0]!, res) };
  };
  it("2 and 4 punches are valid with no issues", () => {
    expect(one(["08:00", "17:00"]).issues).toEqual([]);
    expect(one(["08:00", "12:00", "13:00", "17:00"]).issues).toEqual([]);
  });
  it("odd punch counts are errors", () => {
    for (const t of [["08:00"], ["08:00", "12:00", "13:00"]]) {
      expect(one(t).issues).toEqual([{ level: "error", message: "Incomplete punches: missing IN or OUT." }]);
    }
  });
  it("6 punches: warning, first 4 placed, rest kept", () => {
    const { row, issues } = one(["08:00", "10:00", "11:00", "12:00", "13:00", "17:00"]);
    expect([row.IN, row.OUT, row["IN.1"], row["OUT.1"]]).toEqual(["08:00", "10:00", "11:00", "12:00"]);
    expect(row.extra).toEqual(["13:00", "17:00"]);
    expect(issues.map((i) => i.level)).toEqual(["warning"]);
    expect(issues[0]!.message).toContain("More than 4 punches, please review");
  });
  it("exact duplicates are removed silently", () => {
    const { row, issues } = one(["08:00", "08:00", "17:00"]);
    expect([row.IN, row.OUT]).toEqual(["08:00", "17:00"]);
    expect(issues).toEqual([]);
  });
  it("carries an employee ID shown once per block to all its rows", () => {
    const sheet = [
      ["Emp", "Date", "Time"],
      ["001 - Ana", "1/2/2020", "08:00"], ["", "1/2/2020", "17:00"], ["", "1/3/2020", "08:00"], ["", "1/3/2020", "17:00"],
      ["002 - Ben", "1/2/2020", "09:00"], ["", "1/2/2020", "18:00"],
    ];
    expect(run(sheet)).toEqual([
      ["1/2/2020", "001", "08:00", "17:00", "", ""], ["1/2/2020", "002", "09:00", "18:00", "", ""], ["1/3/2020", "001", "08:00", "17:00", "", ""],
    ]);
  });
  it("section headers give the ID; blank-ID blocks never merge", () => {
    const sheet = [
      ["Employee ID: 001 Ana Cruz"], ["Date", "In", "Out"], ["1/2/2020", "08:00", "17:00"],
      ["Employee ID: 002 Ben"], ["Date", "In", "Out"], ["1/2/2020", "09:00", "18:00"],
    ];
    expect(run(sheet)).toEqual([["1/2/2020", "001", "08:00", "17:00", "", ""], ["1/2/2020", "002", "09:00", "18:00", "", ""]]);
    const anon = [["Name: Ana"], ["Date", "In", "Out"], ["1/2/2020", "08:00", "17:00"], ["Name: Ben"], ["Date", "In", "Out"], ["1/2/2020", "09:00", "18:00"]];
    expect(autoConvert([anon]).rows.length).toBe(2);
  });

  it("matrix with only two day columns", () => {
    const m = [["Employee", "03/15/2019", "03/16/2019"], ["Ana Cruz (001)", "08:00 17:00", ""], ["Ben (002)", "", "17:00\n09:00"]];
    expect(run(m)).toEqual([["3/15/2019", "001", "08:00", "17:00", "", ""], ["3/16/2019", "002", "09:00", "17:00", "", ""]]);
  });

  it("scans all sheets", () => {
    expect(run([["Cover page"]], LONG)).toEqual(EXPECTED);
  });

  it("resolves October day headers from the stat-date range before grouping", () => {
    const sheet = [
      ["Stat-date: 2026-10-01 ~ 2026-10-16"],
      ["Employee", "1", "2", "3", "4", "5", "6", "7"],
      ["001 Ana", "08:00 17:00", "08:05 12:00 13:00 17:05", "08:10 17:10", "", "", "", ""],
    ];
    const { rows } = autoConvert([sheet]);
    expect(simple(rows)).toEqual([
      ["10/1/2026", "001", "08:00", "17:00", "", ""],
      ["10/2/2026", "001", "08:05", "12:00", "13:00", "17:05"],
      ["10/3/2026", "001", "08:10", "17:10", "", ""],
    ]);
    expect(rows.map((r) => validate(r, rows))).toEqual([[], [], []]);
  });

  it("supports short day matrices and uses the header, not a date inside the cell", () => {
    expect(run([
      ["Stat-date", "2026-10-01", "~", "2026-10-16"],
      ["Employee", "1 Thu", "2 (Fri)"],
      ["001 Ana", "2026-09-30 08:00 17:00", "08:00 12:00 13:00 17:00"],
    ])).toEqual([
      ["10/1/2026", "001", "08:00", "17:00", "", ""],
      ["10/2/2026", "001", "08:00", "12:00", "13:00", "17:00"],
    ]);
  });

  it("resolves day columns across a month and year boundary", () => {
    expect(run([
      ["Stat-date: 2026-12-30 ~ 2027-01-02"],
      ["Employee", "30", "31", "1", "2"],
      ["001 Ana", "08:00 17:00", "08:00 17:00", "09:00 18:00", "09:00 18:00"],
    ]).map((r) => r[0])).toEqual(["12/30/2026", "12/31/2026", "1/1/2027", "1/2/2027"]);
  });

  it("unresolved matrix days remain separate, retaining every punch", () => {
    const { rows } = autoConvert([[
      ["Employee", "1", "2", "3", "4", "5"],
      ["001 Ana", "08:00 12:00 13:00 17:00 18:00 19:00 20:00", "09:00 18:00", "10:00", "", ""],
    ]]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => SLOTS.filter((s) => r[s]).length + r.extra.length)).toEqual([7, 2, 1]);
    expect(rows.map((r) => validate(r, rows))).toEqual(Array.from({ length: 3 }, () => [{ level: "error", message: "Missing date" }]));
  });

  it("invalid dates in different rows or sheets never pool punches", () => {
    const sheet = [["Employee", "Date", "Time"], ["001 Ana", "2026-02-30", "08:00 17:00"], ["001 Ana", "2026-02-31", "09:00 18:00"]];
    const { rows } = autoConvert([sheet, sheet]);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => [r.IN, r.OUT])).toEqual([["08:00", "17:00"], ["08:00", "17:00"], ["09:00", "18:00"], ["09:00", "18:00"]]);
    expect(rows.every((r) => validate(r, rows).length === 1)).toBe(true);
  });

  it("days outside the stat-date range remain missing instead of guessing", () => {
    const { rows } = autoConvert([[
      ["Stat-date: 2026-10-01 ~ 2026-10-16"], ["Employee", "16", "17"],
      ["001 Ana", "08:00 17:00", "09:00 18:00"],
    ]]);
    expect(rows.map((r) => r.date)).toEqual(["10/16/2026", ""]);
    const missing = rows.find((r) => !r.date);
    if (!missing) throw new Error("Expected unresolved day");
    expect(validate(missing, rows)).toEqual([{ level: "error", message: "Missing date" }]);
  });

  it("CSV headers match template exactly", () => {
    expect(toCsv([]).split("\r\n")[0]).toBe("Date,System ID,IN,OUT,IN.1,OUT.1");
  });
});
