import { describe, it, expect } from "vitest";
import { convert, toCsv, parseTime, formatTime, TEMPLATE_HEADERS } from "./converter";

const map = { id: 0, date: 1, time: 2, type: -1 };

describe("converter", () => {
  it("8:00 AM + 5:00 PM -> IN 08:00, OUT 17:00, rest blank", () => {
    const [r] = convert([["001", "03/15/2019", "8:00 AM"], ["001", "03/15/2019", "5:00 PM"]], map, "MM/DD/YYYY");
    expect([r.date, r.systemId, r.IN, r.OUT, r["IN.1"], r["OUT.1"]]).toEqual(["3/15/2019", "001", "08:00", "17:00", "", ""]);
  });
  it("4 punches fill all slots chronologically", () => {
    const [r] = convert(
      [["7", "2019-03-15", "17:00"], ["7", "2019-03-15", "08:00"], ["7", "2019-03-15", "13:00"], ["7", "2019-03-15", "12:00"]],
      map, "MM/DD/YYYY");
    expect([r.IN, r.OUT, r["IN.1"], r["OUT.1"]]).toEqual(["08:00", "12:00", "13:00", "17:00"]);
  });
  it("12:00 AM -> 00:00 and 12:00 PM -> 12:00", () => {
    expect(formatTime(parseTime("12:00 AM")!)).toBe("00:00");
    expect(formatTime(parseTime("12:00 PM")!)).toBe("12:00");
  });
  it("headers match template exactly", () => {
    expect(toCsv([]).split("\r\n")[0]).toBe("Date,System ID,IN,OUT,IN.1,OUT.1");
    expect(TEMPLATE_HEADERS).toEqual(["Date", "System ID", "IN", "OUT", "IN.1", "OUT.1"]);
  });
  it("removes exact duplicates and keeps >4 punches as extras", () => {
    const rows = ["08:00", "08:00", "10:00", "11:00", "12:00", "13:00"].map((t) => ["1", "1/2/2020", t]);
    const [r] = convert(rows, map, "MM/DD/YYYY");
    expect(r.dupes).toBe(1);
    expect(r.extra).toEqual(["13:00"]);
  });
  it("keeps slot positions from punch type", () => {
    const [r] = convert([["1", "1/2/2020", "17:00", "OUT"]], { ...map, type: 3 }, "MM/DD/YYYY");
    expect([r.IN, r.OUT]).toEqual(["", "17:00"]);
  });
  it("DD/MM/YYYY input", () => {
    const [r] = convert([["1", "15/03/2019", "08:00"]], map, "DD/MM/YYYY");
    expect(r.date).toBe("3/15/2019");
  });
});
