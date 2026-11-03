import { describe, it, expect } from "vitest";
import { autoConvert, toCsv, parseTime, formatTime, NoPunchError, NO_PUNCH_MESSAGE, SLOTS, type OutRow } from "./converter";

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

  it("removes exact duplicates and flags more than 4 punches", () => {
    const rows = ["08:00", "08:00", "10:00", "11:00", "12:00", "13:00"].map((t) => ["001", "1/2/2020", t]);
    const r = autoConvert([[["ID", "Date", "Time"], ...rows]]).rows[0]!;
    expect(r.dupes).toBe(1);
    expect(r.extra).toEqual(["13:00"]);
  });

  it("scans all sheets", () => {
    expect(run([["Cover page"]], LONG)).toEqual(EXPECTED);
  });

  it("CSV headers match template exactly", () => {
    expect(toCsv([]).split("\r\n")[0]).toBe("Date,System ID,IN,OUT,IN.1,OUT.1");
  });
});
