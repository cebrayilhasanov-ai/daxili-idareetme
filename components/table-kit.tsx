"use client";

// Table building blocks shared by every list in the app: columns that can be dragged to a new place and resized from their
// right edge (remembered per table in this browser), Excel-like filter and sort menus in the headers, and automatic column widths.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownAZ, ArrowDownZA, ChevronDown, Funnel } from "lucide-react";

export function useTableColumns(storageKey:string,defaultKeys:string[]){
  const heal=(order:string[])=>{
    const known=new Set(defaultKeys);
    const healed=order.filter(k=>known.has(k));
    // A column added later lands at its default position instead of the far end.
    defaultKeys.forEach((k,index)=>{if(!healed.includes(k))healed.splice(Math.min(index,healed.length),0,k)});
    return healed;
  };
  const [state,setState]=useState<{order:string[];widths:Record<string,number>}>(()=>{
    if(typeof window==="undefined")return {order:defaultKeys,widths:{}};
    try{
      const raw=window.localStorage.getItem(`cols:${storageKey}`);
      if(!raw)return {order:defaultKeys,widths:{}};
      const parsed=JSON.parse(raw);
      return {order:heal(Array.isArray(parsed.order)?parsed.order:defaultKeys),widths:parsed.widths&&typeof parsed.widths==="object"?parsed.widths:{}};
    }catch{return {order:defaultKeys,widths:{}}}
  });
  const persist=(next:{order:string[];widths:Record<string,number>})=>{
    setState(next);
    if(typeof window!=="undefined"){try{window.localStorage.setItem(`cols:${storageKey}`,JSON.stringify(next))}catch{}}
  };
  const setWidth=(key:string,width:number)=>persist({...state,widths:{...state.widths,[key]:Math.round(width)}});
  const moveColumn=(key:string,targetKey:string)=>{
    if(key===targetKey)return;
    const order=state.order.filter(k=>k!==key);
    const targetIndex=order.indexOf(targetKey);
    if(targetIndex<0)return;
    order.splice(targetIndex,0,key);
    persist({...state,order});
  };
  return {order:state.order,widths:state.widths,setWidth,moveColumn};
}
// Column sorting shared by the Excel-like filters: A→Z or Z→A on one column. Empty cells always go last; the choice is remembered per table.
type ColumnSort={key:string;dir:"asc"|"desc"}|null;
export function useColumnSort(storageKey:string){
  const [sort,setSort]=useState<ColumnSort>(()=>{if(typeof window==="undefined")return null;try{const raw=window.localStorage.getItem(`sort:${storageKey}`);return raw?JSON.parse(raw):null}catch{return null}});
  const setSortTo=(next:ColumnSort)=>{
    setSort(next);
    try{if(next)window.localStorage.setItem(`sort:${storageKey}`,JSON.stringify(next));else window.localStorage.removeItem(`sort:${storageKey}`)}catch{}
  };
  const applySort=<T,>(rows:T[],value:(key:string,row:T)=>string|number|null)=>{
    if(!sort)return rows;
    const direction=sort.dir==="asc"?1:-1;
    const empty=(v:string|number|null)=>v===null||v===""||v==="—"||(typeof v==="number"&&Number.isNaN(v));
    return [...rows].sort((a,b)=>{
      const x=value(sort.key,a),y=value(sort.key,b);
      if(empty(x)||empty(y))return empty(x)===empty(y)?0:empty(x)?1:-1;
      const diff=typeof x==="number"&&typeof y==="number"?x-y:String(x).localeCompare(String(y),"az",{numeric:true,sensitivity:"base"});
      return diff*direction;
    });
  };
  return {sort,setSortTo,applySort};
}
// Excel-like column filters: every header gets a ▾ button that opens a panel with A→Z / Z→A sorting, a value search and a
// checkbox list of the column's distinct values (with counts). Values offered for one column follow the filters set on the
// others, like in Excel. The chosen sort is remembered per table; filters last until the page is reloaded.
// `values` lets one cell hold several filter values (e.g. every executor of a work); the row stays visible while any of them is ticked.
export type ExcelColumn<T>={key:string;label:string;search?:(row:T)=>string;values?:(row:T)=>string[];sort?:(row:T)=>string|number|null};
type ExcelValue={value:string;count:number;order:string|number|null};
const EMPTY_VALUE="(Boş)";
function compareSortValues(x:string|number|null,y:string|number|null){
  const empty=(v:string|number|null)=>v===null||v===""||v==="—"||v===EMPTY_VALUE||(typeof v==="number"&&Number.isNaN(v));
  if(empty(x)||empty(y))return empty(x)===empty(y)?0:empty(x)?1:-1;
  return typeof x==="number"&&typeof y==="number"?x-y:String(x).localeCompare(String(y),"az",{numeric:true,sensitivity:"base"});
}
export function useExcelFilters<T>(storageKey:string,columns:ExcelColumn<T>[],rows:T[],options:{sortable?:boolean}={}){
  const sortable=options.sortable!==false;
  const {sort,setSortTo,applySort}=useColumnSort(storageKey);
  const [excluded,setExcluded]=useState<Record<string,string[]>>({});
  const byKey=new Map(columns.map(c=>[c.key,c]));
  const cellText=(col:ExcelColumn<T>,row:T)=>{const text=(col.search?col.search(row):"").trim();return text&&text!=="—"?text:EMPTY_VALUE};
  const cellValues=(col:ExcelColumn<T>,row:T)=>{if(!col.values)return [cellText(col,row)];const list=col.values(row).map(v=>v.trim()).filter(Boolean);return list.length?list:[EMPTY_VALUE]};
  const passes=(row:T,skipKey?:string)=>Object.entries(excluded).every(([key,values])=>{
    if(key===skipKey||!values.length)return true;
    const col=byKey.get(key);
    return !col||cellValues(col,row).some(value=>!values.includes(value));
  });
  const visible=rows.filter(row=>passes(row));
  const sorted=sortable?applySort(visible,(key,row)=>{const col=byKey.get(key);return col?(col.sort?col.sort(row):col.search?col.search(row):null):null}):visible;
  const header=(col:ExcelColumn<T>)=>{
    const counts=new Map<string,ExcelValue>();
    for(const row of rows){
      if(!passes(row,col.key))continue;
      for(const value of cellValues(col,row)){
        const entry=counts.get(value);
        if(entry)entry.count+=1;else counts.set(value,{value,count:1,order:value===EMPTY_VALUE?null:col.sort&&!col.values?col.sort(row):value});
      }
    }
    const values=[...counts.values()].sort((a,b)=>compareSortValues(a.order,b.order));
    return <ExcelFilterHeader label={col.label} values={values} excluded={excluded[col.key]||[]} sortable={sortable} sortDir={sortable&&sort?.key===col.key?sort.dir:null}
      onSort={dir=>setSortTo(dir?{key:col.key,dir}:null)} onApply={next=>setExcluded(current=>({...current,[col.key]:next}))}/>;
  };
  return {rows:sorted,header};
}
export function ExcelFilterHeader({label,values,excluded,sortable,sortDir,onSort,onApply}:{label:string;values:ExcelValue[];excluded:string[];sortable:boolean;sortDir:"asc"|"desc"|null;onSort:(dir:"asc"|"desc"|null)=>void;onApply:(excluded:string[])=>void}){
  const [open,setOpen]=useState(false);
  const [place,setPlace]=useState<{host:Element;top:number;left:number;maxHeight:number}|null>(null);
  const [draft,setDraft]=useState<Set<string>>(new Set());
  const [query,setQuery]=useState("");
  const buttonRef=useRef<HTMLButtonElement>(null);
  const panelRef=useRef<HTMLDivElement>(null);
  const active=excluded.length>0;
  useEffect(()=>{
    if(!open)return;
    const outside=(e:Event)=>{const target=e.target as Node;if(panelRef.current?.contains(target)||buttonRef.current?.contains(target))return;setOpen(false)};
    const escape=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false)};
    const close=()=>setOpen(false);
    document.addEventListener("mousedown",outside);
    document.addEventListener("scroll",outside,true);
    document.addEventListener("keydown",escape);
    window.addEventListener("resize",close);
    return()=>{document.removeEventListener("mousedown",outside);document.removeEventListener("scroll",outside,true);document.removeEventListener("keydown",escape);window.removeEventListener("resize",close)};
  },[open]);
  const show=()=>{
    const button=buttonRef.current;
    if(!button)return;
    // Inside a dialog the panel is mounted in the dialog itself (the dialog is transformed, so fixed positions are relative to it).
    const host=button.closest("[role=\"dialog\"]")||document.body;
    const rect=button.getBoundingClientRect();
    const origin=host===document.body?{top:0,left:0}:host.getBoundingClientRect();
    const width=270;
    const left=Math.max(8,Math.min(rect.right-width,window.innerWidth-width-8));
    setPlace({host,top:rect.bottom+4-origin.top,left:left-origin.left,maxHeight:Math.max(220,window.innerHeight-rect.bottom-16)});
    setDraft(new Set(excluded));setQuery("");setOpen(true);
  };
  const needle=query.trim().toLocaleLowerCase("az-AZ");
  const shown=needle?values.filter(v=>v.value.toLocaleLowerCase("az-AZ").includes(needle)):values;
  const checkedCount=shown.filter(v=>!draft.has(v.value)).length;
  const allChecked=shown.length>0&&checkedCount===shown.length;
  const toggle=(value:string)=>setDraft(current=>{const next=new Set(current);if(next.has(value))next.delete(value);else next.add(value);return next});
  const toggleAll=()=>setDraft(current=>{const next=new Set(current);for(const v of shown){if(allChecked)next.add(v.value);else next.delete(v.value)}return next});
  // As in Excel: while searching, OK keeps only the matching values that are ticked.
  const apply=()=>{
    const matched=new Set(shown.map(v=>v.value));
    const next=needle?[...new Set([...values.filter(v=>!matched.has(v.value)).map(v=>v.value),...draft])]:[...draft];
    onApply(next);setOpen(false);
  };
  const panel=open&&place?<div ref={panelRef} className="excelpanel" style={{top:place.top,left:place.left,maxHeight:place.maxHeight}} onMouseDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
    {sortable&&<div className="excelsort">
      <button type="button" className={sortDir==="asc"?"on":""} onClick={()=>{onSort(sortDir==="asc"?null:"asc");setOpen(false)}}><ArrowDownAZ/>A→Z sırala</button>
      <button type="button" className={sortDir==="desc"?"on":""} onClick={()=>{onSort(sortDir==="desc"?null:"desc");setOpen(false)}}><ArrowDownZA/>Z→A sırala</button>
    </div>}
    <input className="excelsearch" placeholder="Axtar..." value={query} autoFocus onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")apply()}}/>
    <div className="excellist">
      {shown.length>0&&<label className="excelall"><input type="checkbox" checked={allChecked} ref={el=>{if(el)el.indeterminate=checkedCount>0&&!allChecked}} onChange={toggleAll}/><span>{needle?"(Bütün nəticələri seç)":"(Hamısını seç)"}</span></label>}
      {shown.map(v=><label key={v.value}><input type="checkbox" checked={!draft.has(v.value)} onChange={()=>toggle(v.value)}/><span title={v.value}>{v.value}</span><small>{v.count}</small></label>)}
      {!shown.length&&<small className="excelnone">Uyğun dəyər yoxdur</small>}
    </div>
    <div className="excelactions"><button type="button" disabled={!active} onClick={()=>{onApply([]);setOpen(false)}}>Filtri təmizlə</button><button type="button" className="primary" disabled={needle?checkedCount===0:values.length>0&&values.every(v=>draft.has(v.value))} onClick={apply}>OK</button></div>
  </div>:null;
  return <div className="excelhead">
    <div className="excellabel" title={label}>{label}</div>
    <button ref={buttonRef} type="button" className={`excelbtn${active||sortDir?" on":""}`} title={active?"Filtr tətbiq olunub":"Filtr və sıralama"} aria-label={`${label}: filtr və sıralama`} onMouseDown={e=>e.stopPropagation()} onClick={()=>open?setOpen(false):show()}>
      {sortDir==="asc"?<ArrowDownAZ/>:sortDir==="desc"?<ArrowDownZA/>:null}{active?<Funnel/>:<ChevronDown/>}
    </button>
    {panel&&place&&createPortal(panel,place.host)}
  </div>;
}
export function useColumnDrag(moveColumn:(key:string,targetKey:string)=>void){
  const [draggingKey,setDraggingKey]=useState<string|null>(null);
  const [overKey,setOverKey]=useState<string|null>(null);
  const dragProps=(key:string)=>({
    draggable:true,
    onDragStart:(e:React.DragEvent)=>{setDraggingKey(key);e.dataTransfer.effectAllowed="move";try{e.dataTransfer.setData("text/plain",key)}catch{}},
    onDragEnd:()=>{setDraggingKey(null);setOverKey(null)},
    onDragOver:(e:React.DragEvent)=>{if(!draggingKey)return;e.preventDefault();e.dataTransfer.dropEffect="move";if(overKey!==key)setOverKey(key)},
    onDragLeave:()=>setOverKey(current=>current===key?null:current),
    onDrop:(e:React.DragEvent)=>{e.preventDefault();if(draggingKey&&draggingKey!==key)moveColumn(draggingKey,key);setDraggingKey(null);setOverKey(null)},
    className:overKey===key?"coldragover":undefined,
  });
  return {dragProps};
}
export function SortableTh({resize,drag,className,children}:{resize:{onMouseMove:(e:React.MouseEvent<HTMLElement>)=>void;onMouseLeave:()=>void;onMouseDown:(e:React.MouseEvent<HTMLElement>)=>void;onDoubleClick:(e:React.MouseEvent<HTMLElement>)=>void;className?:string};drag:{draggable:boolean;onDragStart:(e:React.DragEvent)=>void;onDragEnd:()=>void;onDragOver:(e:React.DragEvent)=>void;onDragLeave:()=>void;onDrop:(e:React.DragEvent)=>void;className?:string};className?:string;children:React.ReactNode}){
  return <th draggable={drag.draggable} onDragStart={drag.onDragStart} onDragEnd={drag.onDragEnd} onDragOver={drag.onDragOver} onDragLeave={drag.onDragLeave} onDrop={drag.onDrop} onMouseMove={resize.onMouseMove} onMouseLeave={resize.onMouseLeave} onMouseDown={resize.onMouseDown} onDoubleClick={resize.onDoubleClick} className={joinClass(resize.className,drag.className,className)}>{children}</th>;
}
export function useEdgeResize(onResize:(key:string,width:number)=>void,min=60){
  const [hoverKey,setHoverKey]=useState<string|null>(null);
  const EDGE=8;
  const near=(e:React.MouseEvent<HTMLElement>)=>Math.abs(e.currentTarget.getBoundingClientRect().right-e.clientX)<=EDGE;
  return (key:string)=>({
    onMouseMove:(e:React.MouseEvent<HTMLElement>)=>setHoverKey(near(e)?key:null),
    onMouseLeave:()=>setHoverKey(current=>current===key?null:current),
    onMouseDown:(e:React.MouseEvent<HTMLElement>)=>{
      if(!near(e))return;
      e.preventDefault();e.stopPropagation();
      const startX=e.clientX;
      const startWidth=e.currentTarget.getBoundingClientRect().width;
      document.body.classList.add("colresizing");
      const onMove=(ev:MouseEvent)=>{ev.preventDefault();onResize(key,Math.max(min,startWidth+(ev.clientX-startX)))};
      const onUp=()=>{document.body.classList.remove("colresizing");window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp)};
      window.addEventListener("mousemove",onMove);
      window.addEventListener("mouseup",onUp);
    },
    // Double-click on the edge fits the column to its longest text, like Excel; the width is kept as the user's own.
    onDoubleClick:(e:React.MouseEvent<HTMLElement>)=>{
      if(!near(e))return;
      e.preventDefault();e.stopPropagation();
      const th=e.currentTarget as HTMLTableCellElement;
      const table=th.closest("table");
      const width=table?measureColumns(table)[th.cellIndex]:0;
      if(width)onResize(key,Math.min(MANUAL_FIT_MAX,Math.max(min,width)));
    },
    className:hoverKey===key?"edgeresizing":undefined,
  });
}
// Excel-like column widths. Text in every cell wraps and the row grows with it; a column the user has not resized yet is
// fitted to its longest one-line content the first time the table has rows (capped, so long notes still wrap), so rows start
// one line high. The table is exactly as wide as its columns (never narrower than its box), so narrowing a column really narrows it.
const AUTO_FIT_MAX=350;
const MANUAL_FIT_MAX=800;
// Natural one-line width of every column, measured by letting the browser lay the table out unwrapped for a moment (see .colmeasure).
function measureColumns(table:HTMLTableElement):number[]{
  const header=table.tHead?.rows[0];
  if(!header)return [];
  table.classList.add("colmeasure");
  const widths=Array.from(header.cells).map(cell=>Math.ceil(cell.getBoundingClientRect().width));
  table.classList.remove("colmeasure");
  return widths;
}
export function ColGroup({order,defaultWidths,widths,extraKeys=[]}:{order:string[];defaultWidths:Record<string,number>;widths:Record<string,number>;extraKeys?:string[]}){
  const ref=useRef<HTMLTableColElement>(null);
  const [fitted,setFitted]=useState<Record<string,number>|null>(null);
  const [box,setBox]=useState(0);
  const keys=[...order,...extraKeys];
  // Runs after every render until the table first has rows to measure, then never again (no dependency list on purpose).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(()=>{
    if(fitted)return;
    const table=ref.current?.parentElement;
    // Phones show the table as cards, where column widths do not apply.
    if(!(table instanceof HTMLTableElement)||!table.tBodies[0]?.rows.length||window.matchMedia("(max-width:700px)").matches)return;
    const measured=measureColumns(table);
    setFitted(Object.fromEntries(keys.map((key,i)=>[key,Math.min(AUTO_FIT_MAX,Math.max(60,measured[i]||0))])));
  });
  // The width of the box the table sits in, so a table narrower than its box can be widened to fill it.
  useLayoutEffect(()=>{
    const host=ref.current?.parentElement?.parentElement;
    if(!host)return;
    const read=()=>{const style=getComputedStyle(host);setBox(host.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight))};
    read();
    const observer=new ResizeObserver(read);
    observer.observe(host);
    return ()=>observer.disconnect();
  },[]);
  const base=(key:string)=>widths[key]||fitted?.[key]||defaultWidths[key]||140;
  const sum=keys.reduce((total,key)=>total+base(key),0);
  // Spare room goes only to the long-text columns that hit the fit cap (else to the last column), never spread over all of them,
  // so narrowing any other column really narrows it. Columns the user sized keep exactly their width.
  const capped=order.filter(key=>!widths[key]&&(fitted?.[key]||0)>=AUTO_FIT_MAX);
  const lastFree=[...order].reverse().find(key=>!widths[key]);
  const takers=capped.length?capped:lastFree?[lastFree]:[];
  const spare=takers.length?Math.max(0,Math.floor(box-sum)):0;
  const width=(key:string)=>base(key)+(takers.includes(key)?Math.floor(spare/takers.length):0);
  const total=keys.reduce((all,key)=>all+width(key),0);
  useLayoutEffect(()=>{const table=ref.current?.parentElement;table?.style.setProperty("width",`${total}px`)},[total]);
  return <colgroup ref={ref}>{keys.map(key=><col key={key} style={{width:width(key)}}/>)}</colgroup>;
}
export function joinClass(...parts:Array<string|undefined>){return parts.filter(Boolean).join(" ")||undefined}
export function ActionsHeader({hasSearch=false}:{hasSearch?:boolean}){return <>{hasSearch&&<input aria-hidden="true" tabIndex={-1} readOnly value="" style={{visibility:"hidden"}}/>}<span>Əməliyyat</span></>}