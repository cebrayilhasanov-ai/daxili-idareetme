"use client";
import { useRef, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Versiya 3.24: Müştərilər → "Excel-dən yüklə" (the admin alone). The file is read here, every row is checked by the same rules as
// a customer added by hand and shown before anything is saved; "Yüklə" saves the rows without a mistake (in parts of 100) and
// leaves out the others with their reason. A VÖEN/FİN already in the system is left out, never overwritten.

export type ImportCustomer = { row: number; entityType: string; country: string; voen: string; name: string; legalAddress: string; manager: string; phone: string };
type Field = Exclude<keyof ImportCustomer, "row">;
type Checked = ImportCustomer & { error: string | null };
type Result = { created: number; skipped: { row: number; error: string }[] };

// The template's columns and the header names each may be found under.
const FIELDS: { key: Field; title: string; width: number; names: string[] }[] = [
  { key: "entityType", title: "Statusu *", width: 16, names: ["statusu", "status"] },
  { key: "country", title: "Ölkə", width: 18, names: ["ölkə"] },
  { key: "voen", title: "VÖEN / FİN", width: 16, names: ["vöen / fin", "vöen/fin", "vöen", "fin", "vergi nömrəsi", "vöen/fin / vergi nömrəsi"] },
  { key: "name", title: "Adı *", width: 36, names: ["adı", "müştərinin adı", "ad"] },
  { key: "legalAddress", title: "Hüquqi ünvan *", width: 40, names: ["hüquqi ünvan", "ünvan"] },
  { key: "manager", title: "Rəhbər *", width: 24, names: ["rəhbər"] },
  { key: "phone", title: "Telefon *", width: 20, names: ["telefon"] },
];
const RULES: [string, string][] = [
  ["Statusu *", "Yalnız bunlardan biri: Hüquqi şəxs, Fərdi sahibkar, Fiziki şəxs, Xarici təchizatçı"],
  ["Ölkə", "Yalnız Xarici təchizatçı üçün və məcburidir (məs. Türkiyə, Rusiya, Gürcüstan). Yerli müştəridə boş qalır — Azərbaycan sayılır."],
  ["VÖEN / FİN", "Hüquqi şəxs və Fərdi sahibkar — VÖEN, 10 rəqəm. Fiziki şəxs — FİN, 7 simvol (hərf və rəqəm). Xarici təchizatçı — istəyə bağlı (ölkənin vergi nömrəsi). Excel rəqəmin əvvəlindəki 0-ı silməsin deyə xananı Mətn (Text) formatında saxlayın."],
  ["Adı *", "Müştərinin tam adı, məs. \"ABC\" MMC"],
  ["Hüquqi ünvan *", "Hüquqi ünvan"],
  ["Rəhbər *", "Rəhbərin adı, soyadı"],
  ["Telefon *", "7–15 rəqəm; yalnız rəqəm, boşluq, +, - və mötərizə. Məs. +994 50 123 45 67"],
  ["", ""],
  ["Qeyd", "* — məcburi sütun. Məlumatları 1-ci vərəqdə (Müştərilər), başlıq sətrinin altından yazın; başlıqları dəyişməyin. Sistemdə artıq olan VÖEN/FİN təkrar yaradılmır."],
];
const CHUNK = 100;
const norm = (value: unknown) => String(value ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("az-AZ");
const cellText = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === "number" ? String(value) :String(value ?? "").replace(/\s+/g, " ").trim();

export async function downloadCustomerTemplate() {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const head = (value: string) => ({ value, fontWeight: "bold" as const, backgroundColor: "#DCE6F2", wrap: true });
  await writeXlsxFile([
    { data: [FIELDS.map((f) => head(f.title))], sheet: "Müştərilər", columns: FIELDS.map((f) => ({ width: f.width })), stickyRowsCount: 1 },
    { data: [[head("Sütun"), head("Necə doldurulur")], ...RULES.map(([a, b]) => [{ value: a, wrap: true }, { value: b, wrap: true }])], sheet: "Qaydalar", columns: [{ width: 18 }, { width: 100 }] },
  ]).toFile("Musteriler_sablon.xlsx");
}

// The first sheet: the header row is the first one where at least three template columns are found.
async function readRows(file: File): Promise<ImportCustomer[]> {
  const { readSheet } = await import("read-excel-file/browser");
  const data = (await readSheet(file)) as unknown[][];
  const headerIndex = data.findIndex((row) => row.filter((cell) => FIELDS.some((f) => f.names.includes(norm(cell)))).length >= 3);
  if (headerIndex < 0) throw new Error("Faylda şablonun başlıq sətri tapılmadı (Statusu, VÖEN / FİN, Adı …). Şablonu yükləyib onu doldurun.");
  const header = data[headerIndex].map(norm);
  const column = Object.fromEntries(FIELDS.map((f) => [f.key, header.findIndex((h) => f.names.includes(h))])) as Record<Field, number>;
  const missing = FIELDS.filter((f) => f.key !== "country" && column[f.key] < 0).map((f) => f.title.replace(" *", ""));
  if (missing.length) throw new Error(`Faylda bu sütunlar yoxdur: ${missing.join(", ")}.`);
  const rows: ImportCustomer[] = [];
  data.slice(headerIndex + 1).forEach((cells, i) => {
    const at = (key: Field) => (column[key] >= 0 ? cells[column[key]] : null);
    const row = Object.fromEntries(FIELDS.map((f) => [f.key, cellText(at(f.key))])) as Record<Field, string>;
    if (!Object.values(row).some(Boolean)) return;
    // Excel keeps a VÖEN typed as a number without its leading zero — put it back where 10 digits are expected.
    const voenCell = at("voen");
    if (typeof voenCell === "number" && /^\d{9}$/.test(row.voen) && /hüquqi|fərdi/.test(norm(row.entityType))) row.voen = `0${row.voen}`;
    rows.push({ row: headerIndex + i + 2, ...row });
  });
  return rows;
}

export function CustomerImport({ entityTypes, foreignType, countries, check, onDone }: {
  entityTypes: string[]; foreignType: string; countries: string[];
  // A row's mistake by the customer form's rules (and against the customers already in the system), or null.
  check: (row: ImportCustomer) => string | null;
  onDone: (items: unknown[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Checked[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const close = () => { if (busy) return; setRows(null); setResult(null); setError(""); setFileName(""); };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(""); setResult(null); setFileName(file.name);
    if (!/\.xlsx$/i.test(file.name)) { setRows([]); setError("Yalnız .xlsx faylı yüklənir. Köhnə .xls faylını Excel-də “Save As → Excel Workbook (.xlsx)” ilə saxlayın."); return; }
    try {
      const read = await readRows(file);
      const seen = new Map<string, number>();
      setRows(read.map((r) => {
        // Status and country are matched without regard to letter case; a local customer has no country.
        const entityType = entityTypes.find((t) => norm(t) === norm(r.entityType)) || r.entityType;
        const foreign = entityType === foreignType;
        const country = foreign ? countries.find((c) => norm(c) === norm(r.country)) || r.country : "";
        const voen = foreign ? r.voen.toUpperCase().replace(/\s+/g, "") : r.voen.replace(/\s+/g, "");
        const row = { ...r, entityType, country, voen };
        let rowError = check(row);
        const key = `${voen}|${country}`;
        if (!rowError && voen && seen.has(key)) rowError = `Bu VÖEN/FİN faylda təkrarlanır (${seen.get(key)}-ci sətir).`;
        if (voen && !seen.has(key)) seen.set(key, r.row);
        return { ...row, error: rowError };
      }));
    } catch (e) { setRows([]); setError(e instanceof Error ? e.message : "Fayl oxunmadı."); }
  };

  const ready = rows?.filter((r) => !r.error) || [];
  const upload = async () => {
    if (!rows || !ready.length) return;
    setBusy(true); setError("");
    const skipped = rows.filter((r) => r.error).map((r) => ({ row: r.row, error: r.error as string }));
    let created = 0, items: unknown[] | null = null;
    try {
      for (let i = 0; i < ready.length; i += CHUNK) {
        setProgress(`${Math.min(i + CHUNK, ready.length)} / ${ready.length}`);
        const part = ready.slice(i, i + CHUNK).map(({ error: _error, ...r }) => r); // eslint-disable-line @typescript-eslint/no-unused-vars
        const response = await fetch("/api/customers?import=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: part }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Müştərilər yüklənmədi.");
        created += body.created.length;
        skipped.push(...body.skipped);
        items = body.items;
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Müştərilər yüklənmədi."); }
    finally {
      setBusy(false); setProgress("");
      if (items) onDone(items);
      if (created || items) setResult({ created, skipped: skipped.sort((a, b) => a.row - b.row) });
    }
  };

  return <>
    <button type="button" className="editcompanybtn" onClick={() => void downloadCustomerTemplate()} title="Doldurmaq üçün boş Excel şablonu"><Download/>Şablonu yüklə</button>
    <Button variant="outline" onClick={() => fileRef.current?.click()}><FileSpreadsheet/>Excel-dən yüklə</Button>
    <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void pick(file); }}/>
    <Dialog open={rows !== null} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="businessdialog customerimportdialog" resizable>
        <DialogHeader className="businessdialogheader"><span className="formeyebrow">MÜŞTƏRİLƏR</span><DialogTitle>Excel-dən yükləmə</DialogTitle>
          <DialogDescription>{fileName}{rows?.length ? ` — ${rows.length} sətir: ${ready.length} hazırdır, ${rows.length - ready.length} səhvli` : ""}</DialogDescription></DialogHeader>
        <div className="form businessform">
          {error && <div className="errorbox">{error}</div>}
          {result ? <div className="importresult">
            <p><b>{result.created}</b> müştəri əlavə edildi{result.skipped.length ? <>, <b>{result.skipped.length}</b> sətir buraxıldı</> : null}.</p>
            {result.skipped.length > 0 && <table className="importtable"><thead><tr><th>Sətir</th><th>Səbəb</th></tr></thead><tbody>{result.skipped.map((s) => <tr key={s.row}><td>{s.row}</td><td className="bad">{s.error}</td></tr>)}</tbody></table>}
          </div> : rows && rows.length > 0 && <div className="importwrap"><table className="importtable"><thead><tr><th>Sətir</th><th>Statusu</th><th>Ölkə</th><th>VÖEN / FİN</th><th>Adı</th><th>Hüquqi ünvan</th><th>Rəhbər</th><th>Telefon</th><th>Nəticə</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.row} className={r.error ? "bad" : ""}><td>{r.row}</td><td>{r.entityType}</td><td>{r.country || (r.entityType ? "Azərbaycan" : "")}</td><td>{r.voen}</td><td>{r.name}</td><td>{r.legalAddress}</td><td>{r.manager}</td><td>{r.phone}</td><td>{r.error ? <span className="bad">{r.error}</span> : <span className="ok">Hazırdır</span>}</td></tr>)}</tbody></table></div>}
          {rows && rows.length === 0 && !error && <p>Faylda başlıqdan sonra dolu sətir yoxdur.</p>}
          <div className="inlineactions">
            <button className="inlinecancel" disabled={busy} onClick={close}>{result ? "Bağla" : "Ləğv et"}</button>
            {!result && <Button disabled={busy || !ready.length} onClick={() => void upload()}>{busy ? `Yüklənir… ${progress}` : `Yüklə (${ready.length})`}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
