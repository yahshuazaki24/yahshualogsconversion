// Pure conversion logic: raw biometric logs -> payroll Daily Logs template.
export const TEMPLATE_HEADERS = ["Date", "System ID", "IN", "OUT", "IN.1", "OUT.1"] as const;
export const SLOTS = ["IN", "OUT", "IN.1", "OUT.1"] as const;
export type Slot = (typeof SLOTS)[number];
export type DateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";

export interface Mapping {
  id: number; // column index, -1 = none
  date: number;
  time: number; // may equal date when combined
  type: number;
}

export interface OutRow {
  key: string;
  date: string; // M/D/YYYY or raw invalid text
  systemId: string;
  IN: string;
  OUT: string;
  "IN.1": string;
  "OUT.1": string;
  extra: string[]; // punches beyond four slots
  dupes: number; // exact duplicates removed
}

export interface Issue {
  level: "error" | "warning";
  message: string;
}

let seq = 0;
export const newKey = () => `r${++seq}`;

/* ---------- column detection ---------- */
export function detectMapping(headers: string[]): Mapping {
  const find = (re: RegExp, exclude: number[] = []) =>
    headers.findIndex((h, i) => !exclude.includes(i) && re.test(h.toLowerCase()));
  const id = find(/(system ?id|emp(loyee)?\.? ?(id|no|code|number)|user ?id|ac-?no|badge|enroll|^id$|person ?id|staff)/);
  const dt = find(/(date ?time|datetime|timestamp|check ?time|punch ?time|log ?time)/, [id]);
  const date = dt >= 0 ? dt : find(/date|day/, [id]);
  const time = dt >= 0 ? dt : find(/time/, [id, date]);
  const type = find(/(type|state|status|direction|in ?\/ ?out|check ?type|punch|io|mode)/, [id, date, time]);
  return { id, date, time: time >= 0 ? time : date, type };
}

/* ---------- parsing ---------- */
export interface ParsedDate { y: number; m: number; d: number }

export function parseDate(raw: string, fmt: DateFormat): ParsedDate | null {
  const s = raw.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  } else {
    const p = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!p) return null;
    const a = +p[1], b = +p[2];
    y = +p[3];
    if (y < 100) y += 2000;
    if (fmt === "DD/MM/YYYY") [d, m] = [a, b];
    else [m, d] = [a, b];
  }
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return { y, m, d };
}

export const formatDate = (p: ParsedDate) => `${p.m}/${p.d}/${p.y}`;

/** Returns minutes since midnight or null. Accepts 12h and 24h. */
export function parseTime(raw: string): number | null {
  const s = raw.trim();
  const t = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp]\.?\s*[Mm]\.?)?\s*$/);
  if (!t) return null;
  let h = +t[1];
  const min = +t[2];
  if (min > 59) return null;
  if (t[4]) {
    const pm = /p/i.test(t[4]);
    if (h < 1 || h > 12) return null;
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  } else if (h > 23) return null;
  return h * 60 + min;
}

export const formatTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Normalizes user-typed time to HH:mm; returns input unchanged if invalid. */
export function normalizeTime(raw: string): string {
  if (!raw.trim()) return "";
  const m = parseTime(raw);
  return m === null ? raw : formatTime(m);
}

function punchKind(raw: string): "in" | "out" | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/out|^1$|^o$|break ?out|c\/out/.test(s)) return "out";
  if (/in|^0$|^i$|c\/in/.test(s)) return "in";
  return null;
}

/* ---------- conversion ---------- */
export function convert(rows: string[][], map: Mapping, fmt: DateFormat): OutRow[] {
  type Punch = { min: number; kind: "in" | "out" | null; raw: string };
  const groups = new Map<string, { id: string; date: string; sortKey: string; punches: Punch[]; invalid: string[] }>();

  for (const r of rows) {
    const cell = (i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
    const id = cell(map.id);
    const dateCell = cell(map.date);
    const timeCell = map.time === map.date ? dateCell : cell(map.time);
    if (!id && !dateCell && !timeCell) continue;
    const pd = parseDate(dateCell, fmt);
    const date = pd ? formatDate(pd) : dateCell;
    const sortKey = pd ? `${pd.y}${String(pd.m).padStart(2, "0")}${String(pd.d).padStart(2, "0")}` : `~${dateCell}`;
    const gk = `${id}\u0000${date}`;
    let g = groups.get(gk);
    if (!g) groups.set(gk, (g = { id, date, sortKey, punches: [], invalid: [] }));
    const min = parseTime(timeCell);
    if (min === null) g.invalid.push(timeCell);
    else g.punches.push({ min, kind: punchKind(cell(map.type)), raw: timeCell });
  }

  const out: (OutRow & { sortKey: string })[] = [];
  for (const g of groups.values()) {
    g.punches.sort((a, b) => a.min - b.min);
    const seen = new Set<string>();
    let dupes = 0;
    const uniq = g.punches.filter((p) => {
      const k = `${p.min}|${p.kind}`;
      if (seen.has(k)) { dupes++; return false; }
      seen.add(k);
      return true;
    });
    const row: OutRow & { sortKey: string } = {
      key: newKey(), date: g.date, systemId: g.id, sortKey: g.sortKey,
      IN: "", OUT: "", "IN.1": "", "OUT.1": "", extra: [], dupes,
    };
    const typed = uniq.length > 0 && uniq.every((p) => p.kind);
    if (typed) {
      let ins = 0, outs = 0;
      for (const p of uniq) {
        const slot: Slot | null =
          p.kind === "in" ? (ins++ === 0 ? "IN" : ins === 2 ? "IN.1" : null)
                          : (outs++ === 0 ? "OUT" : outs === 2 ? "OUT.1" : null);
        if (slot) row[slot] = formatTime(p.min);
        else row.extra.push(formatTime(p.min));
      }
    } else {
      uniq.forEach((p, i) => {
        if (i < 4) row[SLOTS[i]] = formatTime(p.min);
        else row.extra.push(formatTime(p.min));
      });
    }
    // invalid times are kept visible (not silently dropped) in first empty slot
    for (const bad of g.invalid) {
      const empty = SLOTS.find((s) => !row[s]);
      if (empty) row[empty] = bad;
      else row.extra.push(bad);
    }
    out.push(row);
  }
  out.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.systemId.localeCompare(b.systemId, undefined, { numeric: true })));
  return out.map(({ sortKey: _s, ...r }) => r);
}

/* ---------- validation ---------- */
export function validate(row: OutRow, all: OutRow[]): Issue[] {
  const issues: Issue[] = [];
  if (!row.systemId.trim()) issues.push({ level: "error", message: "Missing System ID" });
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(row.date) || !parseDate(row.date, "MM/DD/YYYY"))
    issues.push({ level: "error", message: "Invalid date" });
  const vals = SLOTS.map((s) => row[s].trim());
  SLOTS.forEach((s, i) => {
    if (vals[i] && !/^\d{2}:\d{2}$/.test(vals[i])) issues.push({ level: "error", message: `Invalid time in ${s}` });
  });
  if (row.extra.length) issues.push({ level: "error", message: `${row.extra.length} extra punch(es) beyond 4 slots: ${row.extra.join(", ")}` });
  const filled = vals.filter(Boolean).length + row.extra.length;
  if (filled % 2 === 1) issues.push({ level: "warning", message: "Odd number of punches" });
  const pairs: [number, number][] = [[0, 1], [2, 3]];
  for (const [a, b] of pairs) {
    const i = parseTime(vals[a]), o = parseTime(vals[b]);
    if (vals[a] && vals[b] && i !== null && o !== null && o < i)
      issues.push({ level: "warning", message: `${SLOTS[b]} earlier than ${SLOTS[a]}` });
  }
  if (row.dupes) issues.push({ level: "warning", message: `${row.dupes} duplicate punch(es) removed` });
  const dupRow = all.some((r) => r !== row && r.systemId === row.systemId && r.date === row.date);
  if (dupRow && row.systemId) issues.push({ level: "warning", message: "Duplicate System ID + Date row" });
  return issues;
}

/* ---------- export ---------- */
export function toCsv(rows: OutRow[]): string {
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [TEMPLATE_HEADERS.join(",")];
  for (const r of rows) lines.push([r.date, r.systemId, r.IN, r.OUT, r["IN.1"], r["OUT.1"]].map(esc).join(","));
  return lines.join("\r\n") + "\r\n";
}
