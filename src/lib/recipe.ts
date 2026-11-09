import { z } from "zod";
import { autoConvert, blockStartRows, extractCellTimes, extractPunchTimes, extractId, groupPunches, inferDateFormat, parseDate, punchStats, type ConvertResult, type ResolvedPunch, type Slot } from "./converter";

const col = z.number().int().min(0).max(255).nullable();
export const sheetRecipeSchema = z.object({
  sheet: z.number().int().min(0).max(63), layout: z.enum(["long", "wide", "block", "matrix", "timecard", "ignore"]),
  headerRow: z.number().int().min(-1).max(1000), idColumn: col, idLabel: z.string().max(80).nullable(),
  dateColumn: col, dayHeaderRow: col, rangeRow: col, timeColumns: z.array(z.number().int().min(0).max(255)).max(256),
  dateFormat: z.enum(["MM/DD/YYYY", "DD/MM/YYYY", "ISO", "D-Mon-YY", "text", "excel"]), timeFormat: z.enum(["24h", "12h", "excel", "mixed"]),
  punchTypeColumn: col, punchMapping: z.array(z.object({ value: z.string().max(80), slot: z.enum(["IN", "OUT", "IN.1", "OUT.1"]) })).max(16),
}).strict();
export const recipeSchema = z.object({ format: z.string().min(1).max(100), confidence: z.number().min(0).max(1), sheets: z.array(sheetRecipeSchema).min(1).max(64) }).strict();
export type ParsingRecipe = z.infer<typeof recipeSchema>;

// Whitelist structural metadata; all unrecognized prose (including personal names) is redacted.
// Sample = first 40 rows + 40 rows from the 2nd employee block + last 20 rows (bounded at 100).
export function makeSample(sheets: string[][][]) {
  return sheets.slice(0, 64).map((sheet, sheetIndex) => {
    const nonempty = sheet.map((cells, row) => ({ row, cells })).filter(({ cells }) => cells.some((c) => c.trim()));
    const picked = new Map<number, string[]>();
    const take = (entries: { row: number; cells: string[] }[]) => {
      for (const e of entries) if (!picked.has(e.row) && picked.size < 100) picked.set(e.row, e.cells);
    };
    take(nonempty.slice(0, 40));
    const second = blockStartRows(sheet)[1];
    if (second !== undefined) take(nonempty.filter((e) => e.row >= second).slice(0, 40));
    take(nonempty.slice(-20));
    return { sheet: sheetIndex,
      rows: [...picked.entries()].sort((a, b) => a[0] - b[0])
        .map(([row, cells]) => ({ row, cells: cells.slice(0, 256).map(maskCell) })),
    };
  });
}
function maskCell(value: string): string {
  const s = value.trim();
  if (!s) return "";
  if (/^name\s*[:：]/i.test(s)) return "Name: [masked]";
  const label = s.match(/^((?:user|system|emp(?:loyee)?)\s*(?:id|no\.?|code)|id)\s*[:#.]?\s*(.*)$/i);
  if (label) return `${label[1]}: ${extractId(label[2] ?? "") ?? ""}`;
  const id = extractId(s);
  if (id) return id === s ? s : `${id} [masked]`;
  if (/^\d+(?:\.\d+)?$/.test(s) || parseDate(s, "MM/DD/YYYY") || parseDate(s, "DD/MM/YYYY"))
    return s.replace(/[A-Za-z]+/g, (word) => /^(T|Z|AM|PM)$/i.test(word) ? word : "[masked]").slice(0, 512);
  if (extractCellTimes(s).length) return (s.match(/\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?/gi) ?? []).join(" ").slice(0, 512);
  const structural = /^(attendance record report|attendance|record|report|time card|daily time record|stat[- ]date|date|time|punch time|punch state|emp code|employee code|employee|emp|user id|system id|emp no\.?|name|in\d*|out\d*|time in|time out|time\d+|terminal|device|status|verify|check in|check out|total hours|schedule|shift|day|no\.?|id|weekday|work ?time|daily total|total|note|pay period|timecard( report)?|department)$/i;
  if (structural.test(s)) return s;
  const dates = s.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/g);
  if (dates?.length) return `Report period: ${dates.join(" ~ ")}`;
  return "[masked]";
}

function serialDate(s: string) {
  const n = Number(s);
  if (!s.trim() || !Number.isFinite(n) || n < 1 || n > 100000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
export function convertWithRecipe(sheets: string[][][], input: unknown): ConvertResult {
  const recipe = recipeSchema.parse(input);
  if (recipe.confidence < 0.75) throw new Error("Low confidence");
  if (new Set(recipe.sheets.map((s) => s.sheet)).size !== sheets.length) throw new Error("Recipe must account for every sheet");
  if (recipe.sheets.every((s) => s.layout === "timecard" || s.layout === "ignore")) {
    return autoConvert(recipe.sheets.filter((s) => s.layout === "timecard").map((s) => sheets[s.sheet] ?? []));
  }
  const inferred = inferDateFormat(sheets.flatMap((s) => s.flat()));
  const punches: ResolvedPunch[] = [];
  // Inner block/timecard conversions may already have merged duplicate taps; carry the counts.
  const carriedDupes = new Map<string, number>();
  const carryDupes = (id: string, date: string, dupes: number) => {
    if (dupes) carriedDupes.set(`${id}|${date}`, (carriedDupes.get(`${id}|${date}`) ?? 0) + dupes);
  };
  for (const spec of recipe.sheets) {
    const sheet = sheets[spec.sheet];
    if (!sheet) throw new Error("Recipe sheet not found");
    if (spec.layout === "ignore") continue;
    if (spec.layout === "timecard") {
      for (const row of autoConvert([sheet]).rows) {
        carryDupes(row.systemId, row.date, row.dupes);
        for (const [position, value] of [row.IN, row.OUT, row["IN.1"], row["OUT.1"], ...row.extra].entries()) {
          const slot = (["IN", "OUT", "IN.1", "OUT.1"] as const)[position];
          for (const time of extractCellTimes(value)) punches.push({ id: row.systemId, date: parseDate(row.date, "MM/DD/YYYY"), time, source: `s${spec.sheet}:${row.key}`, block: row.key, pairPosition: position, ...(slot ? { slot } : {}) });
        }
      }
      continue;
    }
    if (spec.layout === "block" || spec.layout === "matrix") {
      // Feed only the declared punch day columns into the established block/day resolver.
      const safe = sheet.map((row, i) => i <= spec.headerRow || i === spec.dayHeaderRow || i === spec.rangeRow || row.some((c) => /^(?:id|user id|emp no)\s*[:#.]?/i.test(c))
        ? row : row.map((cell, c) => spec.timeColumns.includes(c) || c === spec.idColumn ? cell : ""));
      const result = autoConvert([safe]);
      for (const row of result.rows) {
        carryDupes(row.systemId, row.date, row.dupes);
        const times = [row.IN, row.OUT, row["IN.1"], row["OUT.1"], ...row.extra];
        for (const value of times) for (const time of extractCellTimes(value)) punches.push({ id: row.systemId, date: parseDate(row.date, "MM/DD/YYYY"), time, source: `s${spec.sheet}:${row.key}`, block: row.key });
      }
      continue;
    }
    let id = "", lastDate = "";
    const mapping = new Map(spec.punchMapping.map((p) => [p.value.toLowerCase(), p.slot]));
    const dataRows = sheet.slice(spec.headerRow + 1);
    const typed = spec.punchTypeColumn !== null && mapping.size > 0 && dataRows.filter((row) => spec.timeColumns.some((c) => extractCellTimes(row[c] ?? "").length))
      .every((row) => mapping.has((row[spec.punchTypeColumn ?? -1] ?? "").trim().toLowerCase()));
    for (let r = spec.headerRow + 1; r < sheet.length; r++) {
      const row = sheet[r] ?? [];
      if (row.some((c) => /\b(total|summary|schedule|shift)\b/i.test(c))) continue;
      if (spec.idLabel) {
        const c = row.findIndex((v) => v.toLowerCase().startsWith(spec.idLabel?.toLowerCase() ?? ""));
        if (c >= 0) { id = extractId((row[c] ?? "").replace(/^[^:]*:\s*/, "")) ?? extractId(row.slice(c + 1).find((v) => v.trim()) ?? "") ?? ""; continue; }
      }
      if (spec.idColumn !== null && row[spec.idColumn]?.trim()) {
        const found = extractId(row[spec.idColumn] ?? "");
        if (!found) continue; // repeated header or non-punch row
        if (found !== id) lastDate = "";
        id = found;
      }
      const cellDate = spec.dateColumn === null ? "" : (row[spec.dateColumn] ?? "").trim();
      if (cellDate) lastDate = cellDate;
      const rawDate = cellDate || lastDate;
      // The date format comes from ALL values in the file when unambiguous, never just the sample.
      const df = inferred.ambiguous ? (spec.dateFormat === "DD/MM/YYYY" ? "DD/MM/YYYY" : "MM/DD/YYYY") : inferred.fmt;
      const date = spec.dateFormat === "excel" ? serialDate(rawDate) : parseDate(rawDate, df);
      for (const c of spec.timeColumns) {
        const raw = row[c] ?? "";
        let times = extractPunchTimes(raw);
        if (!times.length && spec.timeFormat === "excel" && raw.trim() && Number.isFinite(Number(raw))) {
          const n = Number(raw); if (n >= 0 && n < 100000) times = [Math.floor((n % 1) * 1440 + 0.00001)];
        }
        const slot: Slot | undefined = typed ? mapping.get((row[spec.punchTypeColumn ?? -1] ?? "").trim().toLowerCase()) : undefined;
        for (const time of times) punches.push({ id, date, time, source: `s${spec.sheet}r${r}c${c}`, block: `s${spec.sheet}r${r}`, ...(slot ? { slot } : {}) });
      }
    }
  }
  if (!punches.length) throw new Error("Recipe found no punches");
  const rows = groupPunches(punches);
  let carried = 0;
  for (const r of rows) {
    const d = carriedDupes.get(`${r.systemId}|${r.date}`) ?? 0;
    if (d) { r.dupes += d; carried += d; }
  }
  return { rows, ambiguousDate: inferred.ambiguous, layout: recipe.format, stats: punchStats(punches.length + carried, rows) };
}

export function checkRecipeSample(sheets: string[][][], recipe: unknown) {
  const sample = sheets.map((sheet) => {
    let nonempty = 0;
    return sheet.map((row) => row.some((cell) => cell.trim()) && ++nonempty > 40 ? [] : row);
  });
  const result = convertWithRecipe(sample, recipe);
  if (result.rows.some((r) => !r.systemId || !r.date)) throw new Error("Sample has unresolved employee IDs or dates");
  return result;
}