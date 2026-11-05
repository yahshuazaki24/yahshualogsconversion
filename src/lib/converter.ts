// Pure conversion logic: raw biometric logs -> payroll Daily Logs template.
// Everything is detected from cell CONTENT (header text is only used to skip
// summary/schedule columns), so the user never has to pick anything.
export const TEMPLATE_HEADERS = ["Date", "System ID", "IN", "OUT", "IN.1", "OUT.1"] as const;
export const SLOTS = ["IN", "OUT", "IN.1", "OUT.1"] as const;
export type Slot = (typeof SLOTS)[number];
export type DateFormat = "MM/DD/YYYY" | "DD/MM/YYYY";
export const NO_PUNCH_MESSAGE = "This file has no punch times. Please export the attendance/punch log.";

export class NoPunchError extends Error {
  constructor() { super(NO_PUNCH_MESSAGE); }
}

export interface OutRow {
  key: string;
  date: string; // M/D/YYYY, or raw text when invalid
  systemId: string;
  IN: string; OUT: string; "IN.1": string; "OUT.1": string;
  extra: string[]; // punches beyond four slots
  dupes: number; // exact duplicates removed
}
export interface Issue { level: "error" | "warning"; message: string }
export interface ConvertResult { rows: OutRow[]; ambiguousDate: boolean; layout: string }

let seq = 0;
export const newKey = () => `r${++seq}`;

/* ---------- primitive parsing ---------- */
export interface ParsedDate { y: number; m: number; d: number }
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIdx = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;

const ISO_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/;
const NUM_RE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/;
const DMON_RE = /^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?[-\s,]+(\d{4}|\d{2})(?!\d)/;
const MOND_RE = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/;
const WEEKDAY_RE = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i;
const TIME_G = /(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp]\.?\s*[Mm]\.?)?/g;

function valid(y: number, m: number, d: number): ParsedDate | null {
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  if (m < 1 || dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return { y, m, d };
}

/** Splits a leading date off a string. Returns the date text and the remainder. */
function splitDate(s: string): { date: string; rest: string } | null {
  const t = s.replace(WEEKDAY_RE, "");
  for (const re of [ISO_RE, NUM_RE, DMON_RE, MOND_RE]) {
    const m = t.match(re);
    if (m) {
      if ((re === DMON_RE && !monthIdx(m[2]!)) || (re === MOND_RE && !monthIdx(m[1]!))) continue;
      return { date: m[0], rest: t.slice(m[0].length).replace(/^[\sT,]+/, "") };
    }
  }
  return null;
}

export function parseDate(raw: string, fmt: DateFormat): ParsedDate | null {
  const s = raw.trim().replace(WEEKDAY_RE, "");
  let m = s.match(ISO_RE);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(NUM_RE);
  if (m) return fmt === "DD/MM/YYYY" ? valid(+m[3]!, +m[2]!, +m[1]!) : valid(+m[3]!, +m[1]!, +m[2]!);
  m = s.match(DMON_RE);
  if (m) return valid(+m[3]!, monthIdx(m[2]!), +m[1]!);
  m = s.match(MOND_RE);
  if (m) return valid(+m[3]!, monthIdx(m[1]!), +m[2]!);
  return null;
}

export const formatDate = (p: ParsedDate) => `${p.m}/${p.d}/${p.y}`;

function toMinutes(h: number, min: number, ampm?: string): number | null {
  if (min > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    const pm = /p/i.test(ampm);
    h = h === 12 ? (pm ? 12 : 0) : pm ? h + 12 : h;
  } else if (h > 23) return null;
  return h * 60 + min;
}

/** All times in a string that contains ONLY times (and separators). Null otherwise. */
export function parseTimes(raw: string): number[] | null {
  const s = raw.trim();
  if (!s || !s.includes(":")) return null;
  if (/\d\s*(?:[AaPp]\.?[Mm]\.?)?\s*[-~–—]\s*\d{1,2}:\d{2}/.test(s)) return null; // range = schedule
  const out: number[] = [];
  const left = s.replace(TIME_G, (_, h, m, _s, ap) => {
    const v = toMinutes(+h, +m, ap);
    if (v === null) out.push(NaN);
    else out.push(v);
    return " ";
  });
  if (!out.length || out.some(Number.isNaN) || /[^\s,;|/\n]/.test(left)) return null;
  return out;
}

export function parseTime(raw: string): number | null {
  const t = parseTimes(raw);
  return t && t.length === 1 ? t[0]! : null;
}

export const formatTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function normalizeTime(raw: string): string {
  if (!raw.trim()) return "";
  const m = parseTime(raw);
  return m === null ? raw : formatTime(m);
}

const isRange = (s: string) => /\d{1,2}:\d{2}\s*(?:[AaPp]\.?[Mm]\.?)?\s*[-~–—]\s*\d{1,2}:\d{2}/.test(s);

/** Matrix cells may contain annotations or concatenated punches, but not shift ranges. */
export function extractCellTimes(raw: string): number[] {
  if (isRange(raw)) return [];
  const out: number[] = [];
  for (const match of raw.matchAll(TIME_G)) {
    if (!match[1] || !match[2]) continue;
    const minute = toMinutes(Number(match[1]), Number(match[2]), match[4]);
    if (minute !== null) out.push(minute);
  }
  return out;
}

/* ---------- cell classification ---------- */
type Cell =
  | { k: "empty" }
  | { k: "date"; date: string }
  | { k: "times"; times: number[] }
  | { k: "datetime"; date: string; times: number[] }
  | { k: "other"; text: string };

function classify(raw: unknown): Cell {
  const s = String(raw ?? "").trim();
  if (!s) return { k: "empty" };
  const sd = splitDate(s);
  if (sd) {
    if (!sd.rest) return { k: "date", date: sd.date };
    const t = parseTimes(sd.rest);
    if (t) return { k: "datetime", date: sd.date, times: t };
    return { k: "other", text: s };
  }
  const t = parseTimes(s);
  if (t) return { k: "times", times: t };
  return { k: "other", text: s };
}

/** Pulls an employee ID out of "001", "EMP-12", "001 - Ana Cruz", "Ana Cruz (001)". */
export function extractId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const ID = "[A-Za-z]{0,4}-?\\d[\\w-]*";
  // "Ana Cruz ID: 5" / "Ana No. 12" — an explicit label inside a name wins.
  const lab = s.match(new RegExp(`(?:\\bID|\\bNo\\.?)\\s*[:#]?\\s*(${ID})(?![\\w:])`, "i"));
  if (lab && /[A-Za-z]/.test(s.replace(/\b(?:ID|No)\b/gi, ""))) return lab[1]!;
  // Names ending with "(5)": take the LAST parenthesized/bracketed ID.
  const paren = [...s.matchAll(new RegExp(`[(\\[]\\s*(${ID})\\s*[)\\]]`, "g"))].at(-1);
  if (paren && /[A-Za-z]/.test(s.slice(0, paren.index))) return paren[1]!;
  if (splitDate(s) || s.includes(":")) return null;
  let m = s.match(new RegExp(`^(${ID})$`));
  if (m) return m[1]!;
  m = s.match(new RegExp(`^(${ID})\\s*[-–:|,]?\\s+[A-Za-z]`));
  if (m) return m[1]!;
  m = s.match(new RegExp(`[(\\[]\\s*(${ID})\\s*[)\\]]`));
  if (m) return m[1]!;
  m = s.match(new RegExp(`[A-Za-z]\\s*[-–:|,]\\s*(${ID})$`));
  if (m) return m[1]!;
  return null;
}

/* ---------- date format inference ---------- */
export function inferDateFormat(dates: string[]): { fmt: DateFormat; ambiguous: boolean } {
  let mdOnly = false, dmOnly = false, unclear = false;
  for (const d of dates) {
    const m = d.trim().replace(WEEKDAY_RE, "").match(NUM_RE);
    if (!m) continue;
    const a = +m[1]!, b = +m[2]!;
    if (a > 12 && b <= 12) dmOnly = true;
    else if (b > 12 && a <= 12) mdOnly = true;
    else if (a !== b) unclear = true;
  }
  if (dmOnly && !mdOnly) return { fmt: "DD/MM/YYYY", ambiguous: false };
  if (mdOnly) return { fmt: "MM/DD/YYYY", ambiguous: dmOnly };
  return { fmt: "MM/DD/YYYY", ambiguous: unclear };
}

/* ---------- punch extraction ---------- */
interface RawPunch { id: string; date: string; time: number; source: string; block?: string | undefined; slot?: Slot }
export interface ResolvedPunch extends Omit<RawPunch, "date"> { date: ParsedDate | null }
const SKIP_HEADER = /(total|hours?|hrs|late|tardy|under ?time|over ?time|\bot\b|duration|work ?time|sched|shift|plan|expected|required|break ?hrs|absent|night ?diff)/i;
const nonEmpty = (r: Cell[]) => r.filter((c) => c.k !== "empty").length;

function pickIdCol(grid: Cell[][], rows: number[], exclude: Set<number>): number {
  const width = Math.max(0, ...rows.map((r) => grid[r]!.length));
  let best = -1, bestScore = 0.5;
  for (let c = 0; c < width; c++) {
    if (exclude.has(c)) continue;
    const vals: string[] = [];
    let filled = 0;
    for (const r of rows) {
      const cell = grid[r]![c];
      if (cell && cell.k !== "empty") filled++;
      const id = cell?.k === "other" ? extractId(cell.text) : null;
      if (id) vals.push(id);
    }
    // IDs may appear once per employee block, so score against filled cells only
    let score = filled ? vals.length / filled : 0;
    // a row counter (1,2,3,...) is not an employee ID
    const nums = vals.map(Number);
    if (vals.length > 2 && nums.every((n, i) => i === 0 || n === nums[i - 1]! + 1)) score *= 0.3;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

function cellId(cell: Cell | undefined): string {
  return cell?.k === "other" ? extractId(cell.text) ?? "" : "";
}

/** Labels can move between columns; values can be inline or in the next populated cell. */
function labeledId(row: string[]): string | null {
  for (let c = 0; c < row.length; c++) {
    const text = (row[c] ?? "").trim();
    if (/^(?:employee|emp|id|user id|system id|emp no\.?)$/i.test(text)
      && row.slice(c + 1).filter((cell) => /^\d{1,2}$/.test(cell.trim())).length >= 2) continue;
    const label = text.match(/^(?:(?:user|system|emp(?:loyee)?)\s*(?:id|no\.?|number|code)|id|no\.?|code|number)\s*[:#.]?\s*(.*)$/i);
    if (!label || /^(?:employee|emp)\.?$/i.test(text)) continue;
    const inline = label[1]?.trim() ?? "";
    if (inline) {
      const id = extractId(inline);
      if (id) return id;
      continue;
    }
    const right = row.slice(c + 1).find((cell) => cell.trim());
    const id = right ? extractId(right) : null;
    if (id) return id;
  }
  return null;
}

/** Report periods are metadata, not punch dates. Match ISO first without truncating its year. */
function reportPeriod(raw: string[][], header: number, fmt: DateFormat): { start: ParsedDate; end: ParsedDate | null } | null {
  for (let r = header - 1; r >= 0; r--) {
    const text = (raw[r] ?? []).join(" ");
    const dates = (text.match(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g) ?? [])
      .map((d) => parseDate(d, fmt)).filter((d): d is ParsedDate => d !== null);
    const start = dates[0];
    if (start) return { start, end: dates[1] ?? null };
    const my = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/);
    if (my?.[1] && my[2] && monthIdx(my[1]))
      return { start: { y: Number(my[2]), m: monthIdx(my[1]), d: 1 }, end: null };
  }
  return null;
}

/** Matrix: a header row with ≥2 date (or day-number) columns, punch times in the cells below. */
function matrixPunches(grid: Cell[][], raw: string[][], fmt: DateFormat): RawPunch[] | null {
  const out: RawPunch[] = [];
  let activeDates = new Map<number, string>();
  let activeId = "", lastId = "", block = 0;
  const hasBlocks = raw.some((r) => labeledId(r) !== null);
  let idCol = -1;
  for (let h = 0; h < grid.length; h++) {
    const row = grid[h] ?? [];
    const rawRow = raw[h] ?? [];
    const id = labeledId(rawRow);
    if (id !== null) { activeId = id; lastId = ""; block++; continue; }
    if (!row.some((c) => c.k === "times" || c.k === "datetime") && !rawRow.some((c) => extractCellTimes(c).length)) {
    // A stat-date range spread over several cells is metadata, not a matrix header.
    if (/~|–|—|\bto\b/i.test(rawRow.join(" ")) && row.filter((c) => c.k === "date").length >= 2) continue;
    const dateCols = new Map<number, string>();
    row.forEach((c, i) => { if (c.k === "date") dateCols.set(i, c.date); });
    if (dateCols.size < (hasBlocks ? 1 : 2)) {
      // day-number header (1..31) with the period taken from a date above it
      const days = row.map((_, i) => String(raw[h]?.[i] ?? "").trim()).map((v) => {
        const match = v.match(/^(\d{1,2})(?:\s*\(?\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*\)?)?$/i);
        return match?.[1] ? Number(match[1]) : 0;
      });
      const dayCols = days.map((d, i) => (d >= 1 && d <= 31 ? i : -1)).filter((i) => i >= 0);
      const period = reportPeriod(raw, h, fmt);
      if (dayCols.length < (hasBlocks ? 1 : 2) || (!period && !hasBlocks && dayCols.length < 5)) continue;
      let y = period?.start.y ?? 0, m = period?.start.m ?? 0, prev = 0;
      for (const c of dayCols) {
        const d = days[c] ?? 0;
        if (d < prev) { m++; if (m > 12) { m = 1; y++; } }
        prev = d;
        const candidate = period ? valid(y, m, d) : null;
        const inRange = candidate && (!period?.end || new Date(y, m - 1, d) <= new Date(period.end.y, period.end.m - 1, period.end.d))
          && (!period || new Date(y, m - 1, d) >= new Date(period.start.y, period.start.m - 1, period.start.d));
        dateCols.set(c, inRange && candidate ? formatDate(candidate) : "");
      }
    }
    const body: number[] = [];
    for (let r = h + 1; r < grid.length; r++) {
      if ([...dateCols.keys()].some((c) => { const k = grid[r]![c]?.k; return k === "times" || k === "datetime"; })) body.push(r);
    }
    activeDates = dateCols;
    idCol = pickIdCol(grid, body, new Set(dateCols.keys()));
    continue;
    }
    if (!activeDates.size) continue;
    let rowId = activeId || (idCol >= 0 ? cellId(row[idCol]) : "");
    const named = !activeId && idCol >= 0 && row[idCol]?.k !== "empty";
    if (!rowId && !named) rowId = lastId;
    if (rowId) lastId = rowId; else if (named) lastId = "";
    for (const [c, date] of activeDates) {
      const times = extractCellTimes(rawRow[c] ?? "");
      times.forEach((time) => out.push({ id: rowId, date, time, block: rowId ? undefined : `m${block}-${h}`, source: `r${h}c${c}` }));
    }
  }
  return out.length ? out : null;
}

const INOUT = /^(?:clock|check|time|punch)?\s*[-_ ]?\s*(in|out)\s*\.?\s*\d*$/i;
const TC_SKIP = /\b(?:work\s*time|daily\s*total|total|note|pay\s*period|summary)\b/i;

/** Employee label row: "Employee" | "Sunny Gutierrez (5)", inline "Name: Ana (5)", or an ID label. */
function employeeBlockId(row: string[]): string | null {
  for (let c = 0; c < row.length; c++) {
    const t = (row[c] ?? "").trim();
    const m = t.match(/^(?:employee|emp|name)\s*(?:name)?\s*[:：]?\s*([\s\S]*)$/i);
    if (!m) continue;
    const inline = m[1]?.trim();
    const id = inline ? extractId(inline) : null;
    if (id) return id;
    const right = row.slice(c + 1).filter((v) => v.trim());
    for (const v of right) { const found = extractId(v); if (found) return found; }
  }
  return labeledId(row);
}

/** Timecard: employee blocks, a header with In/Out columns, date carried down, one IN/OUT pair per row. */
function timecardPunches(raw: string[][], fmt: DateFormat): RawPunch[] | null {
  const out: RawPunch[] = [];
  let id = "", block = 0, sawBlock = false;
  let pairs: { inCol: number; outCol: number }[] | null = null;
  let dateCol = -1, date = "", dateRow = -1, pairIdx = 0, stray = false;
  const period = reportPeriod(raw, raw.length, fmt);
  for (let r = 0; r < raw.length; r++) {
    const row = raw[r] ?? [];
    const cells = row.map((c) => String(c ?? "").trim());
    const timesHere = cells.some((c) => extractCellTimes(c).length);
    const bid = timesHere ? null : employeeBlockId(cells);
    if (bid) { id = bid; block++; sawBlock = true; pairs = null; continue; }
    const io = cells.map((c, i) => ({ i, m: c.match(INOUT)?.[1]?.toLowerCase() })).filter((x) => x.m);
    if (!timesHere && io.length >= 2) {
      const list: { inCol: number; outCol: number }[] = [];
      io.forEach((x, k) => { if (x.m === "in") { const o = io.slice(k + 1).find((y) => y.m === "out"); if (o) list.push({ inCol: x.i, outCol: o.i }); } });
      if (list.length) { pairs = list; dateCol = cells.findIndex((c) => /^(?:date|day)$/i.test(c)); date = ""; continue; }
    }
    if (!pairs) { if (timesHere) stray = true; continue; }
    if (cells.some((c) => TC_SKIP.test(c) && !extractCellTimes(c).length)) continue;
    const dc = dateCol >= 0 ? [dateCol] : cells.map((_, i) => i).filter((i) => !pairs!.some((p) => p.inCol === i || p.outCol === i));
    for (const c of dc) {
      const v = cells[c] ?? "";
      if (!v || extractCellTimes(v).length) continue;
      const d = tcDate(v, fmt, period);
      if (d) { date = d; dateRow = r; pairIdx = 0; break; }
    }
    if (!timesHere) continue;
    const rowSlots = pairs.length > 1 ? pairs.flatMap((_, k) => [k * 2, k * 2 + 1]) : [pairIdx * 2, pairIdx * 2 + 1];
    pairs.forEach((p, k) => {
      [p.inCol, p.outCol].forEach((col, side) => {
        const idx = rowSlots[k * 2 + side]!;
        extractCellTimes(cells[col] ?? "").forEach((time) => out.push({
          id, date, time, source: date ? `r${dateRow}` : `r${r}`, block: id ? undefined : `t${block}`, ...(idx < 4 ? { slot: SLOTS[idx] } : {}),
        }));
      });
    });
    pairIdx++;
  }
  return sawBlock && out.length && !stray ? out : null;
}

function tcDate(v: string, fmt: DateFormat, period: { start: ParsedDate; end: ParsedDate | null } | null): string {
  const sd = splitDate(v);
  if (sd && parseDate(sd.date, fmt)) return sd.date;
  const t = v.replace(WEEKDAY_RE, "").trim();
  if (!period) return "";
  let m = t.match(/^(\d{1,2})[-/](\d{1,2})(?:\s|$|\()/);
  if (m) { const d = valid(period.start.y, +m[1]!, +m[2]!); return d ? `${d.y}-${d.m}-${d.d}` : ""; }
  m = t.match(/^(\d{1,2})(?:\s|$|\()/);
  if (m) {
    const day = +m[1]!, mo = day < period.start.d ? period.start.m + 1 : period.start.m;
    const d = valid(mo > 12 ? period.start.y + 1 : period.start.y, mo > 12 ? 1 : mo, day);
    return d ? `${d.y}-${d.m}-${d.d}` : "";
  }
  return "";
}

/** Long (one punch per row) and wide (several time columns per row). */
function rowPunches(grid: Cell[][], raw: string[][]): RawPunch[] {
  const data: number[] = [];
  grid.forEach((r, i) => {
    if (nonEmpty(r) >= 2 && r.some((c) => c.k === "times" || c.k === "datetime")) data.push(i);
  });
  if (!data.length) return [];
  // header = closest text row above the first data row; used only to skip summary columns
  const skip = new Set<number>();
  for (let h = data[0]! - 1; h >= 0; h--) {
    const r = grid[h]!;
    if (r.filter((c) => c.k === "other").length >= 2) {
      r.forEach((c, i) => { if (c.k === "other" && SKIP_HEADER.test(c.text)) skip.add(i); });
      break;
    }
  }
  const width = Math.max(...data.map((r) => grid[r]!.length));
  let dateCol = -1, most = 0;
  for (let c = 0; c < width; c++) {
    const n = data.filter((r) => grid[r]![c]?.k === "date").length;
    if (n > most) { most = n; dateCol = c; }
  }
  const idCol = pickIdCol(grid, data, new Set([dateCol, ...skip]));

  // section-style reports: "Employee ID: 001  Ana Cruz" on a row above the punches
  const sectionId = new Map<number, string>();
  const blockOf = new Map<number, number>();
  {
    let cur = "", block = 0, prevData = false;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r]!;
      const isData = data.includes(r);
      if (!isData) {
        const id = labeledId(raw[r] ?? []);
        if (id !== null) { cur = id; block++; }
        if (prevData && nonEmpty(row) > 0) block++;
      }
      prevData = isData;
      sectionId.set(r, cur);
      blockOf.set(r, block);
    }
  }

  const out: RawPunch[] = [];
  let lastId = "", lastBlock = -1;
  for (const r of data) {
    const row = grid[r]!;
    let id = sectionId.get(r) || (idCol >= 0 ? cellId(row[idCol]) : "");
    if (!id) id = idCol >= 0 && lastId && blockOf.get(r) === lastBlock ? lastId : sectionId.get(r) ?? "";
    if (!id && idCol >= 0) id = lastId && blockOf.get(r) === lastBlock ? lastId : "";
    if (id) { lastId = id; lastBlock = blockOf.get(r)!; }
    const block = id ? undefined : `b${blockOf.get(r)}`;
    const dcell = dateCol >= 0 ? row[dateCol] : undefined;
    const rowDate = dcell?.k === "date" ? dcell.date : "";
    row.forEach((c, i) => {
      if (skip.has(i) || i === idCol) return;
      if (c.k === "times") c.times.forEach((t) => out.push({ id, date: rowDate, time: t, block, source: `r${r}c${i}` }));
      if (c.k === "datetime") c.times.forEach((t) => out.push({ id, date: c.date, time: t, block, source: `r${r}c${i}` }));
    });
  }
  return out;
}

/** Main entry: all sheets of a workbook (each a grid of cell texts) -> template rows. */
export function autoConvert(sheets: string[][][]): ConvertResult {
  const grids = sheets.map((s) => s.map((r) => r.map(classify)));
  const allDates: string[] = [];
  grids.forEach((g) => g.forEach((r) => r.forEach((c) => { if (c.k === "date" || c.k === "datetime") allDates.push(c.date); })));
  const { fmt, ambiguous } = inferDateFormat(allDates);

  const punches: RawPunch[] = [];
  const layouts = new Set<string>();
  grids.forEach((g, i) => {
    const tag = (ps: RawPunch[]) => ps.map((p) => ({ ...p, source: `s${i}${p.source}`, block: p.block ? `s${i}${p.block}` : undefined }));
    const tc = timecardPunches(sheets[i] ?? [], fmt);
    if (tc?.length) { punches.push(...tag(tc)); layouts.add("timecard"); return; }
    const mx = matrixPunches(g, sheets[i]!, fmt);
    if (mx?.length) { punches.push(...tag(mx)); layouts.add("matrix"); return; }
    const rp = rowPunches(g, sheets[i] ?? []);
    if (rp.length) { punches.push(...tag(rp)); layouts.add("rows"); }
  });
  if (!punches.length) throw new NoPunchError();
  const resolved: ResolvedPunch[] = punches.map((p) => ({ ...p, date: parseDate(p.date, fmt) }));
  return { rows: groupPunches(resolved), ambiguousDate: ambiguous, layout: [...layouts].join("+") };
}

export function groupPunches(punches: ResolvedPunch[]): OutRow[] {
  const groups = new Map<string, { id: string; date: string; sortKey: string; punches: ResolvedPunch[] }>();
  for (const p of punches) {
    const pd = p.date;
    const date = pd ? formatDate(pd) : "";
    const sortKey = pd ? `${pd.y}${String(pd.m).padStart(2, "0")}${String(pd.d).padStart(2, "0")}` : `~${p.source}`;
    // Without a resolved date, only punches from the very same source cell may share a row.
    const k = JSON.stringify([p.id || `\u0001${p.block ?? ""}`, pd ? date : `unresolved:${p.source}`]);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { id: p.id, date, sortKey, punches: [] }));
    g.punches.push(p);
  }
  const out = [...groups.values()].map((g) => {
    const sorted = [...g.punches].sort((a, b) => a.time - b.time);
    const uniq: ResolvedPunch[] = [];
    for (const punch of sorted) {
      const previous = uniq.at(-1);
      if (!previous || punch.time - previous.time > 2) uniq.push(punch);
    }
    const row: OutRow & { sortKey: string } = {
      key: newKey(), date: g.date, systemId: g.id, sortKey: g.sortKey,
      IN: "", OUT: "", "IN.1": "", "OUT.1": "", extra: [], dupes: sorted.length - uniq.length,
    };
    const typed = uniq.every((p) => p.slot) && new Set(uniq.map((p) => p.slot)).size === uniq.length;
    uniq.forEach((p, i) => {
      const slot = typed ? p.slot : SLOTS[i];
      if (slot) row[slot] = formatTime(p.time); else row.extra.push(formatTime(p.time));
    });
    return row;
  });
  out.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.systemId.localeCompare(b.systemId, undefined, { numeric: true })));
  return out.map(({ sortKey: _s, ...r }) => r);
}

/* ---------- validation ---------- */
export function validate(row: OutRow, _all: OutRow[]): Issue[] {
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(row.date) || !parseDate(row.date, "MM/DD/YYYY"))
    return [{ level: "error", message: "Missing date" }];
  const issues: Issue[] = [];
  if (!row.systemId.trim()) return [{ level: "error", message: "Missing System ID" }];
  const vals: string[] = SLOTS.map((s) => row[s].trim());
  SLOTS.forEach((s, i) => {
    if (vals[i] && !/^\d{2}:\d{2}$/.test(vals[i]!)) issues.push({ level: "error", message: `Invalid time in ${s}` });
  });
  const filled = vals.filter(Boolean).length + row.extra.length;
  if (issues.length) return issues;
  if (filled >= 6) issues.push({ level: "warning", message: "More than 4 punches, please review" });
  else if (filled % 2 === 1) return [{ level: "error", message: "Missing punch: incomplete IN/OUT." }];
  for (const [inSlot, outSlot] of [["IN", "OUT"], ["IN.1", "OUT.1"]] as const) {
    const start = parseTime(row[inSlot]), end = parseTime(row[outSlot]);
    if (start !== null && end !== null && end < start) {
      issues.push({ level: "warning", message: "OUT earlier than IN" });
      break;
    }
  }
  return issues;
}

export function filterRows(rows: OutRow[], id: string, date: string, issuesOnly = false): OutRow[] {
  return rows.filter((r) => r.systemId.toLowerCase().includes(id.trim().toLowerCase())
    && r.date.includes(date.trim()) && (!issuesOnly || validate(r, rows).length > 0));
}

export function exportSelection(rows: OutRow[], issuesOnly: boolean) {
  const selected = issuesOnly ? rows.filter((r) => validate(r, rows).length > 0) : rows;
  let errors = 0, warnings = 0;
  for (const row of selected) {
    const issues = validate(row, rows);
    if (issues.some((i) => i.level === "error")) errors++;
    else if (issues.length) warnings++;
  }
  return { rows: selected, errors, warnings, needsConfirmation: errors + warnings > 0 };
}

/* ---------- export ---------- */
export function toCsv(rows: OutRow[]): string {
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [TEMPLATE_HEADERS.join(",")];
  for (const r of rows) lines.push([r.date, r.systemId, r.IN, r.OUT, r["IN.1"], r["OUT.1"]].map(esc).join(","));
  return lines.join("\r\n") + "\r\n";
}

export { isRange };

/** Share of rows with at least one error; used for the self-check before showing results. */
export function errorRate(rows: OutRow[]): number {
  if (!rows.length) return 1;
  return rows.filter((r) => validate(r, rows).some((i) => i.level === "error")).length / rows.length;
}
export const UNRELIABLE_MESSAGE = "We couldn't read this file reliably";
