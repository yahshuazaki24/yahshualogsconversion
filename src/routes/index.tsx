import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Check, Undo2, Plus, Trash2, Download, Search, AlertTriangle, XCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  convert, detectMapping, newKey, normalizeTime, parseDate, formatDate, toCsv, validate,
  SLOTS, TEMPLATE_HEADERS, type DateFormat, type Mapping, type OutRow, type Issue,
} from "@/lib/converter";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "YAHSHUA Payroll Online Logs Converter" },
      { name: "description", content: "Upload a biometric log export and convert it to the payroll Daily Logs CSV — all in your browser." },
      { property: "og:title", content: "YAHSHUA Payroll Online Logs Converter" },
      { property: "og:description", content: "Convert biometric logs to the payroll Daily Logs template in your browser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: App,
});

const STEPS = ["Upload", "Map & Review", "Edit & Export"];
const card = "rounded-2xl border border-border bg-card shadow-soft";

async function readFile(file: File): Promise<string[][]> {
  if (/\.csv$|\.txt$/i.test(file.name)) {
    const text = await file.text();
    return Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }).data.map((r) => r.map(String));
  }
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils
    .sheet_to_json<string[]>(ws, { header: 1, raw: false, dateNF: "yyyy-mm-dd hh:mm:ss", defval: "", blankrows: false })
    .map((r) => r.map((c) => String(c ?? "")));
}

function guessFormat(rows: string[][], col: number): DateFormat {
  for (const r of rows.slice(0, 200)) {
    const m = String(r[col] ?? "").match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (m && +m[1]! > 12) return "DD/MM/YYYY";
    if (/^\d{4}-/.test(String(r[col] ?? ""))) return "YYYY-MM-DD";
  }
  return "MM/DD/YYYY";
}

function App() {
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({ id: -1, date: -1, time: -1, type: -1 });
  const [fmt, setFmt] = useState<DateFormat>("MM/DD/YYYY");
  const [rows, setRows] = useState<OutRow[]>([]);
  const [history, setHistory] = useState<OutRow[][]>([]);

  const onFile = async (file: File) => {
    try {
      const all = await readFile(file);
      if (all.length < 2) { toast.error("The file has no data rows."); return; }
      const h = all[0]!.map((c, i) => c.trim() || `Column ${i + 1}`);
      const m = detectMapping(h);
      setFileName(file.name);
      setHeaders(h);
      setData(all.slice(1));
      setMapping(m);
      setFmt(m.date >= 0 ? guessFormat(all.slice(1), m.date) : "MM/DD/YYYY");
      setStep(1);
    } catch {
      toast.error("Could not read this file. Please upload a CSV or XLSX export.");
    }
  };

  const preview = useMemo(
    () => (step === 1 && mapping.id >= 0 && mapping.date >= 0 && mapping.time >= 0 ? convert(data, mapping, fmt) : []),
    [step, data, mapping, fmt],
  );

  const goEdit = () => {
    setRows(preview);
    setHistory([]);
    setStep(2);
  };

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-3xl">YAHSHUA Payroll Online Logs Converter</h1>
          <p className="mt-2 text-sm text-muted-foreground">Convert biometric logs into the payroll Daily Logs template. Files never leave your browser.</p>
        </header>

        <Stepper step={step} />

        {step === 0 && <UploadStep onFile={onFile} />}
        {step === 1 && (
          <MapStep
            fileName={fileName} headers={headers} data={data} mapping={mapping} setMapping={setMapping}
            fmt={fmt} setFmt={setFmt} preview={preview} onBack={() => setStep(0)} onNext={goEdit}
          />
        )}
        {step === 2 && (
          <EditStep rows={rows} setRows={setRows} history={history} setHistory={setHistory} fileName={fileName} onBack={() => setStep(1)} />
        )}
      </div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-8 flex items-center justify-center gap-2 sm:gap-4">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold transition-colors",
                i < step && "border-primary bg-primary text-primary-foreground",
                i === step && "border-primary bg-accent text-primary",
                i > step && "border-border bg-card text-muted-foreground",
              )}
            >
              {i < step ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span className={cn("hidden text-sm font-medium sm:inline", i === step ? "text-heading" : "text-muted-foreground")}>{s}</span>
          </div>
          {i < STEPS.length - 1 && <span className="h-px w-6 bg-border sm:w-12" />}
        </li>
      ))}
    </ol>
  );
}

function UploadStep({ onFile }: { onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={cn(card, "p-6 sm:p-10")}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload log file"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors",
          over ? "border-primary bg-accent" : "border-border hover:border-primary hover:bg-accent/50",
        )}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
          <Upload className="h-6 w-6" />
        </span>
        <div>
          <p className="text-base font-semibold text-heading">Drag & drop your biometric log export</p>
          <p className="mt-1 text-sm text-muted-foreground">or click to browse — CSV or XLSX</p>
        </div>
        <Button type="button" className="rounded-xl">Choose file</Button>
        <input ref={input} type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      </div>
    </div>
  );
}

function ColSelect({ label, value, headers, onChange, optional }: { label: string; value: number; headers: string[]; onChange: (v: number) => void; optional?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}{optional && " (optional)"}</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(+v)}>
        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select column" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="-1">— None —</SelectItem>
          {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function issueCounts(rows: OutRow[]) {
  let errors = 0, warnings = 0;
  const map = new Map<string, Issue[]>();
  for (const r of rows) {
    const is = validate(r, rows);
    map.set(r.key, is);
    if (is.some((i) => i.level === "error")) errors++;
    else if (is.length) warnings++;
  }
  return { errors, warnings, map };
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "error" | "warning" }) {
  return (
    <div className={cn(card, "p-4")}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold", tone === "error" && value ? "text-destructive" : tone === "warning" && value ? "text-warning" : "text-heading")}>{value}</p>
    </div>
  );
}

function MapStep(p: {
  fileName: string; headers: string[]; data: string[][]; mapping: Mapping; setMapping: (m: Mapping) => void;
  fmt: DateFormat; setFmt: (f: DateFormat) => void; preview: OutRow[]; onBack: () => void; onNext: () => void;
}) {
  const { errors, warnings } = useMemo(() => issueCounts(p.preview), [p.preview]);
  const employees = new Set(p.preview.map((r) => r.systemId)).size;
  const ready = p.mapping.id >= 0 && p.mapping.date >= 0 && p.mapping.time >= 0;
  const set = (k: keyof Mapping) => (v: number) => p.setMapping({ ...p.mapping, [k]: v });
  return (
    <div className="space-y-6">
      <div className={cn(card, "p-6")}>
        <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
          <FileSpreadsheet className="h-4 w-4 text-secondary" /> {p.fileName} · {p.data.length} source rows
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <ColSelect label="System ID" value={p.mapping.id} headers={p.headers} onChange={set("id")} />
          <ColSelect label="Date" value={p.mapping.date} headers={p.headers} onChange={set("date")} />
          <ColSelect label="Time" value={p.mapping.time} headers={p.headers} onChange={set("time")} />
          <ColSelect label="Punch type" value={p.mapping.type} headers={p.headers} onChange={set("type")} optional />
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Input date format</Label>
            <Select value={p.fmt} onValueChange={(v) => p.setFmt(v as DateFormat)}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"] as const).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {!ready && <p className="mt-4 text-sm text-destructive">Select the System ID, Date and Time columns to continue.</p>}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Output rows" value={p.preview.length} />
        <Stat label="Employees" value={employees} />
        <Stat label="Rows with errors" value={errors} tone="error" />
        <Stat label="Rows with warnings" value={warnings} tone="warning" />
      </div>

      <div className={cn(card, "overflow-hidden")}>
        <p className="border-b border-border px-4 py-3 text-sm font-semibold text-heading">Source preview</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>{p.headers.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {p.data.slice(0, 5).map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {p.headers.map((_, j) => <td key={j} className="whitespace-nowrap px-4 py-2">{r[j]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" className="rounded-xl" onClick={p.onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button className="rounded-xl" disabled={!ready || !p.preview.length} onClick={p.onNext}>Continue to edit</Button>
      </div>
    </div>
  );
}

function EditStep({ rows, setRows, history, setHistory, fileName, onBack }: {
  rows: OutRow[]; setRows: (r: OutRow[]) => void; history: OutRow[][]; setHistory: (h: OutRow[][]) => void; fileName: string; onBack: () => void;
}) {
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState(false);
  const { errors, warnings, map } = useMemo(() => issueCounts(rows), [rows]);

  const commit = (next: OutRow[]) => { setHistory([...history.slice(-49), rows]); setRows(next); };
  const update = (key: string, patch: Partial<OutRow>) => commit(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const undo = () => { const prev = history.at(-1); if (prev) { setRows(prev); setHistory(history.slice(0, -1)); } };
  const addRow = () => commit([...rows, { key: newKey(), date: "", systemId: "", IN: "", OUT: "", "IN.1": "", "OUT.1": "", extra: [], dupes: 0 }]);

  const visible = rows.filter((r) => {
    if (issuesOnly && !map.get(r.key)?.length) return false;
    if (q && !`${r.systemId} ${r.date}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const download = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName.replace(/\.[^.]+$/, "") || "daily-logs"}_daily_logs.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("CSV exported");
  };
  const onExport = () => {
    if (errors) return toast.error(`Fix ${errors} row(s) with errors before exporting.`);
    if (warnings) return setConfirm(true);
    download();
  };

  const cellCls = "h-8 rounded-lg border-transparent bg-transparent px-2 shadow-none hover:border-border focus-visible:border-primary";

  return (
    <div className="space-y-4">
      <div className={cn(card, "flex flex-wrap items-center gap-3 p-4")}>
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search System ID or date" className="rounded-xl pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="issues" checked={issuesOnly} onCheckedChange={setIssuesOnly} />
          <Label htmlFor="issues" className="text-sm">Show issues only</Label>
        </div>
        <span className="flex items-center gap-1 text-sm text-destructive"><XCircle className="h-4 w-4" />{errors}</span>
        <span className="flex items-center gap-1 text-sm text-warning"><AlertTriangle className="h-4 w-4" />{warnings}</span>
        <Button variant="outline" size="sm" className="rounded-xl" onClick={undo} disabled={!history.length}><Undo2 className="h-4 w-4" /> Undo</Button>
        <Button variant="outline" size="sm" className="rounded-xl" onClick={addRow}><Plus className="h-4 w-4" /> Add row</Button>
      </div>

      <div className={cn(card, "overflow-hidden")}>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2" />
                {TEMPLATE_HEADERS.map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold text-heading">{h}</th>)}
                <th className="px-2 py-2 font-medium">Issues</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const is = map.get(r.key) ?? [];
                const err = is.some((i) => i.level === "error");
                return (
                  <tr key={r.key} className={cn("border-t border-border", err ? "bg-destructive/5" : is.length ? "bg-warning/5" : "")}>
                    <td className="px-2">
                      <span className={cn("block h-2 w-2 rounded-full", err ? "bg-destructive" : is.length ? "bg-warning" : "bg-success")} />
                    </td>
                    <td className="px-1 py-1">
                      <CellInput className={cn(cellCls, "w-28")} value={r.date} onCommit={(v) => {
                        const p = parseDate(v, "MM/DD/YYYY");
                        update(r.key, { date: p ? formatDate(p) : v });
                      }} />
                    </td>
                    <td className="px-1 py-1"><CellInput className={cn(cellCls, "w-28")} value={r.systemId} onCommit={(v) => update(r.key, { systemId: v })} /></td>
                    {SLOTS.map((s) => (
                      <td key={s} className="px-1 py-1">
                        <CellInput className={cn(cellCls, "w-20 font-mono")} value={r[s]} placeholder="—" onCommit={(v) => update(r.key, { [s]: normalizeTime(v) })} />
                      </td>
                    ))}
                    <td className="px-2 py-1 text-xs">
                      {is.map((i, n) => (
                        <div key={n} className={i.level === "error" ? "text-destructive" : "text-warning"}>
                          {i.message}
                          {i.message.includes("extra punch") && (
                            <button className="ml-1 text-secondary underline" onClick={() => update(r.key, { extra: [] })}>discard</button>
                          )}
                        </div>
                      ))}
                    </td>
                    <td className="px-1">
                      <Button variant="ghost" size="icon" aria-label="Delete row" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => commit(rows.filter((x) => x.key !== r.key))}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                );
              })}
              {!visible.length && <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">No rows to show.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" className="rounded-xl" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button className="rounded-xl" onClick={onExport}><Download className="h-4 w-4" /> Export CSV</Button>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-heading">Export with warnings?</AlertDialogTitle>
            <AlertDialogDescription>{warnings} row(s) have warnings (e.g. odd punch counts or OUT earlier than IN). They will be exported as-is.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Review</AlertDialogCancel>
            <AlertDialogAction onClick={download}>Export anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CellInput({ value, onCommit, className, placeholder }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setV(value); }
  return (
    <Input value={v} placeholder={placeholder} className={className}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}
