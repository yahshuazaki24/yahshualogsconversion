import { describe, expect, it } from "vitest";
import { autoConvert, describeResult, verifyConversion } from "./converter";
import { makeSample } from "./recipe";
import { readTextSheets } from "./file-reader";

describe("detection engine gate", () => {
  it("never takes the System ID from a device column", () => {
    const sheet = [
      ["Person ID", "Person Name", "Punch Date", "Attendance record", "Verify Type", "TimeZone", "Source"],
      ["AMAIA0029", "Ana Cruz", "2026-10-01 08:00", "", "FP", "UTC+8", "UWH-01"],
      ["AMAIA0029", "Ana Cruz", "2026-10-01 17:00", "", "FP", "UTC+8", "UWH-01"],
      ["RW30", "Ben Reyes", "2026-10-01 08:05", "", "FP", "UTC+8", "UWH-01"],
      ["RW30", "Ben Reyes", "2026-10-01 17:10", "", "FP", "UTC+8", "UWH-01"],
    ];
    const res = autoConvert([sheet]);
    expect(res.rows.map((r) => r.systemId)).toEqual(["AMAIA0029", "RW30"]);
    expect(res.rows.every((r) => !r.systemId.startsWith("UWH"))).toBe(true);
    expect(verifyConversion(res)).toEqual([]);
  });
  it("counts merged duplicate taps and accounts for every source punch", () => {
    const res = autoConvert([[["ID", "Date", "Time"], ...["08:00", "08:00", "08:01", "08:03", "17:00"].map((t) => ["1", "2026-10-01", t])]]);
    expect(res.stats?.merged).toBe(2);
    expect(res.stats!.parsed).toBe(res.stats!.placed + res.stats!.extras + res.stats!.merged);
  });
  it("flags rows falling outside the stated report period", () => {
    const res = autoConvert([[["Attendance Record Report 2026-10-01 ~ 2026-10-16"], ["ID", "Date", "Time"], ["1", "2026-10-01", "08:00 17:00"], ["1", "2026-11-20", "08:00 17:00"]]]);
    expect(verifyConversion(res).some((f) => f.check === "period")).toBe(true);
  });
  it("fails the gate on blank IDs and unresolved dates", () => {
    const res = autoConvert([[["ID", "Date", "Time"], ["", "2026-10-01", "08:00 17:00"], ["2", "not-a-date", "09:00 18:00"]]]);
    const checks = verifyConversion(res).map((f) => f.check);
    expect(checks).toContain("blank-id");
    expect(checks).toContain("blank-date");
  });
  it("describes results as a readable line with employees and date range", () => {
    const res = autoConvert([[["ID", "Date", "Time"], ["5", "2026-10-02", "07:50 17:03"], ["9", "2026-10-05", "08:00 18:00"]]]);
    expect(describeResult(res)).toBe("Punch log · 2 employees · 10/2/2026–10/5/2026");
  });
  it("samples head, second employee block and tail, bounded and name-masked", () => {
    const rows: string[][] = [["Emp Code", "Punch Time"]];
    for (let e = 1; e <= 5; e++) {
      rows.push([`ID: ${e}`]);
      for (let i = 0; i < 30; i++) rows.push([`${e} Name${e} Surname${e}`, `2026-10-01 ${String(8 + (i % 10)).padStart(2, "0")}:00`]);
    }
    const sample = makeSample([rows]);
    const idx = sample[0]!.rows.map((r) => r.row);
    expect(idx.length).toBeLessThanOrEqual(100);
    expect(idx[0]).toBe(0);
    expect(idx).toContain(32); // second employee block start
    expect(idx).toContain(155); // tail of the file
    expect(JSON.stringify(sample)).not.toMatch(/Name\d|Surname\d/);
  });
  it("reads TSV text and windows-1252 legacy exports", () => {
    const sheets = readTextSheets("ID\tDate\tTime\r\n1\t2026-10-01\t08:00 17:00");
    expect(autoConvert(sheets).rows[0]?.IN).toBe("08:00");
  });
});
