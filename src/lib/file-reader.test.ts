import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readTextSheets, readWorkbookSheets } from "./file-reader";
import { autoConvert, validate } from "./converter";

const block = [["Attendance Record Report 2026-10-01 ~ 2026-10-16"], ["", "1", "2"], ["ID:", "1"], ["", "08:5514:4815:4618:00", ""]];
const check = (sheets: string[][][]) => {
  const { rows } = autoConvert(sheets);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("Expected sample row");
  expect([row.date, row.systemId, row.IN, row.OUT, row["IN.1"], row["OUT.1"]])
    .toEqual(["10/1/2026", "1", "08:55", "14:48", "15:46", "18:00"]);
  expect(validate(row, rows)).toEqual([]);
};

describe("browser file readers", () => {
  for (const bookType of ["xls", "xlsx"] as const) {
    it(`reads ${bookType} blocks across all sheets`, () => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Cover"]]), "Cover");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(block), "Records");
      check(readWorkbookSheets(XLSX.write(wb, { bookType, type: "array" })));
    });
  }
  it("reads CSV blocks", () => {
    check(readTextSheets(XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(block))));
  });
  it("reads tab-delimited TXT and DAT blocks", () => {
    check(readTextSheets(block.map((r) => r.join("\t")).join("\r\n")));
  });
  it("reads whitespace DAT punch logs with combined date/time and AM/PM", () => {
    const { rows } = autoConvert(readTextSheets("1 2026-10-01 8:55 AM 1 0\n1 2026-10-01 6:00 PM 1 0"));
    expect(rows.map((r) => [r.date, r.systemId, r.IN, r.OUT])).toEqual([["10/1/2026", "1", "08:55", "18:00"]]);
  });
});