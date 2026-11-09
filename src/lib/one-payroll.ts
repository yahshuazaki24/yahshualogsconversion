import { zipSync, strToU8 } from "fflate";
import { parseDate, newKey, SLOTS, type OutRow, type Issue } from "./converter";

export const ONE_HEADERS = ["employee_code", "log_date", "time_in", "time_out", "source", "remarks"] as const;
export type OneColumn = typeof ONE_HEADERS[number];
export type OneRow = Record<OneColumn, string> & { key: string };
export const SOURCES = ["biometric", "import", "manual"] as const;
// Shared grid adapter: column positions are UI storage only, never payroll interpretation.
export const oneToGrid = (r: OneRow): OutRow => ({ key: r.key, systemId: r.employee_code, date: r.log_date, IN: r.time_in, OUT: r.time_out, "IN.1": r.source, "OUT.1": r.remarks, extra: [], dupes: 0 });
export const gridToOne = (r: OutRow): OneRow => ({ key: r.key, employee_code: r.systemId, log_date: r.date, time_in: r.IN, time_out: r.OUT, source: r["IN.1"], remarks: r["OUT.1"] });
const dayKey = (r: OneRow) => JSON.stringify([r.employee_code, r.log_date || r.key]);
const dateKey = (s: string) => { const d = parseDate(s, "MM/DD/YYYY"); return d ? d.y * 10000 + d.m * 100 + d.d : Infinity; };
export const sortOne = (rows: OneRow[]) => [...rows].sort((a, b) => a.employee_code.localeCompare(b.employee_code, undefined, { numeric: true }) || dateKey(a.log_date) - dateKey(b.log_date) || a.time_in.localeCompare(b.time_in));

export function formatOne(days: OutRow[], source = "biometric"): OneRow[] {
  const rows: OneRow[] = [];
  for (const day of days) {
    const d = parseDate(day.date, "MM/DD/YYYY");
    const date = d ? `${String(d.m).padStart(2, "0")}/${String(d.d).padStart(2, "0")}/${d.y}` : "";
    const punches = day.neutral?.punches ?? [...SLOTS.map((s) => day[s]), ...day.extra].filter(Boolean).map((time) => ({ time, side: undefined, pair: undefined }));
    const pairs: { time_in: string; time_out: string }[] = [];
    if (punches.some((p) => p.pair !== undefined)) {
      const groups = new Map<number, { time_in: string; time_out: string }>();
      for (const p of punches) {
        const index = p.pair ?? groups.size;
        const pair = groups.get(index) ?? { time_in: "", time_out: "" };
        pair[p.side === "out" ? "time_out" : "time_in"] = p.time;
        groups.set(index, pair);
      }
      pairs.push(...groups.values());
    } else {
      let current: { time_in: string; time_out: string } | undefined;
      for (const p of punches) {
        const side = p.side === "out" ? "time_out" : p.side === "in" ? "time_in" : current?.time_in && !current.time_out ? "time_out" : "time_in";
        if (!current || current[side] || (side === "time_in" && current.time_out)) { current = { time_in: "", time_out: "" }; pairs.push(current); }
        current[side] = p.time;
      }
    }
    for (const pair of pairs) if (pair.time_in || pair.time_out) rows.push({ key: newKey(), employee_code: day.systemId, log_date: date, ...pair, source, remarks: "" });
  }
  return sortOne(rows);
}

export function validateOne(row: OneRow, all: OneRow[]): Issue[] {
  const errors: Issue[] = [];
  const error = (message: string) => errors.push({ level: "error", message });
  if (!row.employee_code.trim()) error("Missing Employee Code");
  const validDate = /^\d{2}\/\d{2}\/\d{4}$/.test(row.log_date) && parseDate(row.log_date, "MM/DD/YYYY");
  if (!validDate) error("Invalid date: use MM/DD/YYYY");
  for (const column of ["time_in", "time_out"] as const) if (row[column] && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row[column])) error(`Invalid ${column}: use HH:MM`);
  if (!row.time_in && !row.time_out) error("Missing time-in or time-out");
  if (!SOURCES.some((s) => s === row.source)) error("Invalid source");
  if (all.some((r) => r.key !== row.key && r.employee_code === row.employee_code && r.log_date === row.log_date && r.time_in === row.time_in && r.time_out === row.time_out)) error("Duplicate employee/date/pair");
  if (!validDate || !row.employee_code.trim()) return errors;
  const count = all.filter((r) => dayKey(r) === dayKey(row)).reduce((n, r) => n + Number(Boolean(r.time_in)) + Number(Boolean(r.time_out)), 0);
  if (count % 2) error("Missing punch: incomplete IN/OUT (imports as time-in/time-out only)");
  else if (count > 4) errors.push({ level: "warning", message: "More than 4 punches, please review" });
  return errors;
}

export function oneSelection(rows: OneRow[], issuesOnly = false, all = rows) {
  const map = new Map(all.map((r) => [r.key, validateOne(r, all)]));
  const selected = issuesOnly ? rows.filter((r) => map.get(r.key)?.length) : rows;
  const days = new Map<string, Issue[]>();
  for (const r of selected) days.set(dayKey(r), [...(days.get(dayKey(r)) ?? []), ...(map.get(r.key) ?? [])]);
  let errors = 0, warnings = 0;
  for (const issues of days.values()) { if (issues.some((i) => i.level === "error")) errors++; else if (issues.length) warnings++; }
  return { rows: selected, errors, warnings, days: days.size, needsConfirmation: errors + warnings > 0, map };
}
export function oneCsv(rows: OneRow[]): string {
  if (!rows.length) throw new Error("No rows to export");
  const escape = (s: string) => /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return [ONE_HEADERS.join(","), ...sortOne(rows).map((r) => ONE_HEADERS.map((c) => escape(r[c])).join(","))].join("\r\n") + "\r\n";
}
export function splitOne(rows: OneRow[], maxRows: number): OneRow[][] {
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new Error("Max rows per file must be a positive whole number");
  const groups = new Map<string, OneRow[]>();
  for (const row of sortOne(rows)) groups.set(dayKey(row), [...(groups.get(dayKey(row)) ?? []), row]);
  const parts: OneRow[][] = []; let part: OneRow[] = [];
  for (const group of groups.values()) { if (part.length && part.length + group.length > maxRows) { parts.push(part); part = []; } part.push(...group); }
  if (part.length) parts.push(part);
  return parts;
}
export function oneFilename(now = new Date()) { return `yahshua_one_daily_logs_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}.csv`; }
export function oneZip(rows: OneRow[], max: number, filename: string): Uint8Array {
  return zipSync(Object.fromEntries(splitOne(rows, max).map((part, i) => [filename.replace(/\.csv$/, `_part_${String(i + 1).padStart(3, "0")}.csv`), strToU8(oneCsv(part))])));
}