import Papa from "papaparse";
import * as XLSX from "xlsx";

export function readTextSheets(text: string): string[][][] {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }).data;
  // Whitespace-separated DAT logs have no CSV delimiter; preserve AM/PM with its time.
  if (parsed.every((r) => r.length === 1) && !text.includes('"')) {
    return [text.split(/\r?\n/).filter((line) => line.trim()).map((line) =>
      line.trim().split(/\s+(?![AP]M\b)/i),
    )];
  }
  return [parsed.map((r) => r.map(String))];
}

export function readWorkbookSheets(data: ArrayBuffer): string[][][] {
  const wb = XLSX.read(data, { type: "array" });
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", blankrows: false })
      .map((row) => row.map((cell) => String(cell ?? "")));
  });
}

export async function readFile(file: File): Promise<string[][][]> {
  return /\.(csv|txt|dat)$/i.test(file.name)
    ? readTextSheets(await file.text())
    : readWorkbookSheets(await file.arrayBuffer());
}