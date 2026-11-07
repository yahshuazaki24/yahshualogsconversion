import Papa from "papaparse";
import * as XLSX from "xlsx";

export const SCANNED_PDF_MESSAGE = "This PDF has no readable text (it looks like a scan). Please export the attendance/punch log.";

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

/** UTF-8 (BOM stripped) with a Windows-1252 fallback for legacy device exports. */
function decodeText(data: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("windows-1252").decode(data);
  }
}

/** Text-based PDFs only: rows are text lines, cells are text runs left to right. */
async function readPdfSheets(data: ArrayBuffer): Promise<string[][][]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data }).promise;
  const sheets: string[][][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] ?? 0);
      const line = lines.get(y) ?? [];
      line.push({ x: item.transform[4] ?? 0, s: item.str });
      lines.set(y, line);
    }
    sheets.push([...lines.entries()].sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s)));
  }
  if (!sheets.some((s) => s.some((r) => r.some((c) => c.trim())))) throw new Error(SCANNED_PDF_MESSAGE);
  return sheets;
}

export async function readFile(file: File): Promise<string[][][]> {
  if (/\.pdf$/i.test(file.name)) return readPdfSheets(await file.arrayBuffer());
  if (/\.(csv|txt|dat|tsv)$/i.test(file.name)) return readTextSheets(decodeText(await file.arrayBuffer()));
  return readWorkbookSheets(await file.arrayBuffer());
}
