"use client";
import { useState } from "react";
import { LayoutGrid, List, Plus } from "lucide-react";

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
    <button type="button" className={value === "list" ? "on" : ""} onClick={() => onChange("list")}><List />Siyahı</button>
    <button type="button" className={value === "board" ? "on" : ""} onClick={() => onChange("board")}><LayoutGrid />Lövhə</button>
  </div>;
}

type Firm = { id: number; name: string };

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
      {ordered.map(({ firm, rows: cards }) => <section key={firm.id} className="boardcol">
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
