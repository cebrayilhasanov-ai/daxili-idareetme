"use client";
import { useState } from "react";
import { Plus } from "lucide-react";

// Versiya 3.31: "Lövhə" — the same rows as the list (same tabs, filters and visibility), only laid out in one column per firm.
// Rows without a firm have no column, so the board leaves them out and says how many stay in the list.
export type ListOrBoard = "list" | "board";

export function useListOrBoard(storageKey: string) {
  const key = `view:${storageKey}`;
  const [view, setViewState] = useState<ListOrBoard>(() => {
    if (typeof window === "undefined") return "list";
    try { return window.localStorage.getItem(key) === "board" ? "board" : "list"; } catch { return "list"; }
  });
  const setView = (next: ListOrBoard) => {
    setViewState(next);
    try { window.localStorage.setItem(key, next); } catch {}
  };
  return [view, setView] as const;
}

export function ViewSwitch({ value, onChange }: { value: ListOrBoard; onChange: (next: ListOrBoard) => void }) {
  return <div className="viewswitch" role="group" aria-label="Görünüş">
    <button type="button" className={value === "list" ? "on" : ""} onClick={() => onChange("list")}>Siyahı</button>
    <button type="button" className={value === "board" ? "on" : ""} onClick={() => onChange("board")}>Lövhə</button>
  </div>;
}

type Firm = { id: number; name: string };

// Versiya 3.35: every firm keeps its own colour on the board (picked by its id, so it does not change between visits).
const FIRM_COLORS = [
  { accent: "#0C8599", tint: "#E6F6F8" },
  { accent: "#4F46E5", tint: "#EEF0FE" },
  { accent: "#D97706", tint: "#FDF4E3" },
  { accent: "#DB2777", tint: "#FDEEF5" },
  { accent: "#059669", tint: "#E7F7F0" },
  { accent: "#7C3AED", tint: "#F3EEFE" },
  { accent: "#0284C7", tint: "#E7F3FB" },
  { accent: "#EA580C", tint: "#FEF0E7" },
];
const firmColor = (id: number) => FIRM_COLORS[Math.abs(id) % FIRM_COLORS.length];

export function FirmBoard<T>({ rows, firmOf, keyOf, renderCard, extraFirms = [], onAdd, filtered = false, emptyText }: {
  rows: T[];
  firmOf: (row: T) => { id: number | null; name: string | null };
  keyOf: (row: T) => string | number;
  renderCard: (row: T) => React.ReactNode;
  // Firms shown even with no rows yet (where the user may add a work).
  extraFirms?: Firm[];
  onAdd?: (companyId: number) => void;
  filtered?: boolean;
  emptyText: string;
}) {
  const columns = new Map<number, { firm: Firm; rows: T[] }>();
  for (const firm of extraFirms) columns.set(firm.id, { firm, rows: [] });
  let firmless = 0;
  for (const row of rows) {
    const { id, name } = firmOf(row);
    if (!id) { firmless += 1; continue; }
    const column = columns.get(id) || { firm: { id, name: name || "—" }, rows: [] };
    column.rows.push(row);
    columns.set(id, column);
  }
  const ordered = [...columns.values()].sort((a, b) => a.firm.name.localeCompare(b.firm.name, "az", { sensitivity: "base", numeric: true }));
  return <div className="firmboardwrap">
    {(filtered || firmless > 0) && <div className="boardnotes">
      {filtered && <small>Siyahıda seçdiyiniz süzgəclər lövhəyə də aiddir.</small>}
      {firmless > 0 && <small>Firması olmayan {firmless} qeyd lövhədə göstərilmir — onlara “Siyahı”da baxın.</small>}
    </div>}
    {ordered.length ? <div className="firmboard">
      {ordered.map(({ firm, rows: cards }) => <section key={firm.id} className="boardcol" style={{ "--col": firmColor(firm.id).accent, "--coltint": firmColor(firm.id).tint } as React.CSSProperties}>
        <header><b title={firm.name}>{firm.name}</b><em>{cards.length}</em></header>
        <div className="boardcards">
          {cards.map(row => <div key={keyOf(row)} className="boardcardslot">{renderCard(row)}</div>)}
          {!cards.length && <p className="boardempty">Boşdur</p>}
        </div>
        {onAdd && <button type="button" className="boardadd" onClick={() => onAdd(firm.id)}><Plus />İş əlavə et</button>}
      </section>)}
    </div> : <p className="boardempty wide">{emptyText}</p>}
  </div>;
}
