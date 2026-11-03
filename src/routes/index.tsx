import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { readFile } from "@/lib/file-reader";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Loader2, Check, Undo2, Plus, Trash2, Download, Search, AlertTriangle, XCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  autoConvert, NoPunchError, newKey, normalizeTime, parseDate, formatDate, toCsv, validate,
  SLOTS, TEMPLATE_HEADERS, type OutRow, type Issue,
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

const STEPS = ["Upload", "Check & Export"];
const card = "rounded-2xl border border-border bg-card shadow-soft";

function App() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [fileName, setFileName] = useState("");
  const [ambiguousDate, setAmbiguousDate] = useState(false);
  const [rows, setRows] = useState<OutRow[]>([]);
  const [history, setHistory] = useState<OutRow[][]>([]);

  const onFile = async (file: File) => {
    setBusy(true);
    setProblem("");
    try {
      const res = autoConvert(await readFile(file));
      setFileName(file.name);
      setRows(res.rows);
      setAmbiguousDate(res.ambiguousDate);
      setHistory([]);
      setStep(1);
    } catch (e) {
      setProblem(e instanceof NoPunchError ? e.message : "Could not read this file. Please upload a CSV or Excel export.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-3xl">YAHSHUA Payroll Online Logs Converter</h1>
          <p className="mt-2 text-sm text-muted-foreground">Drop your biometric log export — it converts automatically. Files never leave your browser.</p>
        </header>

        <Stepper step={step} />

        {step === 0 && <UploadStep onFile={onFile} busy={busy} problem={problem} />}
        {step === 1 && (
          <EditStep rows={rows} setRows={setRows} history={history} setHistory={setHistory} fileName={fileName}
            ambiguousDate={ambiguousDate} onBack={() => setStep(0)} />
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

function UploadStep({ onFile, busy, problem }: { onFile: (f: File) => void; busy: boolean; problem: string }) {
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
          {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
        </span>
        <div>
          <p className="text-base font-semibold text-heading">Drag & drop your biometric log export</p>
          <p className="mt-1 text-sm text-muted-foreground">or click to browse — XLS, XLSX, CSV, TXT or DAT</p>
        </div>
        <Button type="button" className="rounded-xl" disabled={busy}>Choose file</Button>
        <input ref={input} type="file" accept=".csv,.xlsx,.xls,.txt,.dat" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      </div>
      {problem && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {problem}
        </div>
      )}
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

function EditStep({ rows, setRows, history, setHistory, fileName, ambiguousDate, onBack }: {
  rows: OutRow[]; setRows: (r: OutRow[]) => void; history: OutRow[][]; setHistory: (h: OutRow[][]) => void;
  fileName: string; ambiguousDate: boolean; onBack: () => void;
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

  const employees = new Set(rows.map((r) => r.systemId).filter(Boolean)).size;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileSpreadsheet className="h-4 w-4 text-secondary" /> {fileName}
      </div>
      {ambiguousDate && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          Dates in this file could be read either way (e.g. 02/03). They were read as Month/Day/Year — please double-check.
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Rows" value={rows.length} />
        <Stat label="Employees" value={employees} />
        <Stat label="Errors" value={errors} tone="error" />
        <Stat label="Warnings" value={warnings} tone="warning" />
      </div>
      <div className={cn(card, "flex flex-wrap items-center gap-3 p-4")}>
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search System ID or date" className="rounded-xl pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="issues" checked={issuesOnly} onCheckedChange={setIssuesOnly} />
          <Label htmlFor="issues" className="text-sm">Show issues only</Label>
        </div>
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
                          {i.level === "warning" && r.extra.length > 0 && <div>Additional punches: {r.extra.join(", ")}</div>}
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
        <Button variant="ghost" className="rounded-xl" onClick={onBack}><ArrowLeft className="h-4 w-4" /> New file</Button>
        <Button className="rounded-xl" onClick={onExport}><Download className="h-4 w-4" /> Export CSV</Button>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-heading">Export with warnings?</AlertDialogTitle>
            <AlertDialogDescription>{warnings} row(s) have more than 4 punches.{ambiguousDate ? " Dates were read as Month/Day/Year." : ""} Only the first 4 punches per row will be exported; additional punches remain available for review.</AlertDialogDescription>
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
