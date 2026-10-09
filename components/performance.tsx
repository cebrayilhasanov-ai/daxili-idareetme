"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { DEFAULT_FIXED_START, FREQUENCY_TITLES, formatBakuDate, periodState, periodWindow, periodsOfYear, type FixedFrequency } from "@/lib/fixed-periods";

// Versiya 3.12: Ana səhifə → "Mənim performansım" — the user's own quarter, counted from what the program already holds: tasks
// (approval score, submitted on time), fixed works (done by the deadline) and Nöqsanlar. Nobody fills anything in for it.

type PerfTask = { id:number; title:string; status:string; due_at:string; created_at:string; completed_at:string|null; submitted_at:string|null; evaluation:number|null; evaluation_note:string|null; company_name:string|null; request_id:number|null };
type PerfAssignment = { id:number; created_at:string; title:string; frequency:string; due_day:number|null; due_month:number|null; company_name:string };
type PerfData = { none?:boolean; employee:{ id:number; name:string; email:string|null; avatar_key:string|null }; positions:{ company_name:string; title:string|null; department:string|null }[];
  tasks:PerfTask[]; assignments:PerfAssignment[]; completions:{ work_assignment_id:number; period_key:string; completed_at:string }[]; violations:{ id:number; title:string; created_at:string }[]; fixedWorksStart:string|null };
type Quarter = { year:number; q:number };

// The score's parts and weights; a part with nothing to count in the quarter drops out and the others share its weight.
export const SCORE_WEIGHTS = { grade:40, onTime:30, fixed:20, discipline:10 } as const;
const ROMAN = ["I","II","III","IV"];
const quarterLabel = (p:Quarter) => `${p.year} – ${ROMAN[p.q-1]} rüb`;
const shortLabel = (p:Quarter) => `${ROMAN[p.q-1]} ${p.year}`;
const shift = (p:Quarter, by:number):Quarter => { const n = p.year*4 + (p.q-1) + by; return { year:Math.floor(n/4), q:n%4+1 }; };
const range = (p:Quarter) => ({ start:new Date(p.year,(p.q-1)*3,1).getTime(), end:new Date(p.year,p.q*3,1).getTime() });
const currentQuarter = ():Quarter => { const d = new Date(); return { year:d.getFullYear(), q:Math.floor(d.getMonth()/3)+1 }; };
const done = (t:PerfTask) => t.status === "Təsdiqlənib";
// When the worker handed the task in: the submission time (since 3.12), for older approved tasks the approval time.
const handedIn = (t:PerfTask) => t.submitted_at || (done(t) ? t.completed_at : null);
function timing(t:PerfTask, now:number):"ontime"|"late"|"pending" {
  const due = new Date(t.due_at).getTime(), at = handedIn(t);
  if (at) return new Date(at).getTime() <= due ? "ontime" : "late";
  return now > due ? "late" : "pending";
}
function taskBucket(t:PerfTask, now:number) {
  if (done(t)) return "Tamamlanan";
  if (!handedIn(t) && now > new Date(t.due_at).getTime()) return "Gecikən";
  return t.status === "Yeni" ? "Başlanmayan" : "Davam edən";
}

function quarterStats(data:PerfData, p:Quarter, now:number) {
  const { start, end } = range(p);
  const inQuarter = (iso:string|null|undefined) => { const t = iso ? new Date(iso).getTime() : NaN; return t >= start && t < end; };
  const tasks = data.tasks.filter(t => inQuarter(t.due_at) && new Date(t.created_at).getTime() <= now);
  const graded = tasks.filter(t => done(t) && t.evaluation != null);
  const avg = graded.length ? graded.reduce((s,t) => s + Number(t.evaluation), 0) / graded.length : null;
  const timed = tasks.map(t => timing(t, now)).filter(x => x !== "pending");
  const onTime = timed.length ? timed.filter(x => x === "ontime").length / timed.length * 100 : null;
  // Fixed works: the periods due inside the quarter that count for this person and whose deadline has come (or that are marked).
  const marks = new Map(data.completions.map(c => [`${c.work_assignment_id}|${c.period_key}`, c.completed_at]));
  const fixedRows: { assignment:PerfAssignment; key:string; due:number; state:string }[] = [];
  for (const a of data.assignments) for (const year of [p.year-1, p.year]) for (const period of periodsOfYear(a.frequency, year)) {
    const win = periodWindow(a, period.key);
    if (!win || win.due - 1 < start || win.due - 1 >= end) continue;
    const state = periodState(a, period.key, marks.get(`${a.id}|${period.key}`), now, { start:data.fixedWorksStart || DEFAULT_FIXED_START, assignedAt:a.created_at });
    if (state === "skipped") continue;
    fixedRows.push({ assignment:a, key:period.key, due:win.due - 1, state });
  }
  const settled = fixedRows.filter(r => r.state === "done" || r.state === "late-done" || r.state === "overdue");
  const fixedOnTime = settled.filter(r => r.state === "done").length;
  // A late mark still counts for half.
  const fixed = settled.length ? (fixedOnTime + settled.filter(r => r.state === "late-done").length/2) / settled.length * 100 : null;
  const violations = data.violations.filter(v => inQuarter(v.created_at));
  const discipline = Math.max(0, 100 - violations.length*25);
  const parts:[keyof typeof SCORE_WEIGHTS, number|null][] = [["grade", avg == null ? null : avg*10], ["onTime", onTime], ["fixed", fixed], ["discipline", discipline]];
  const hasWork = avg != null || onTime != null || fixed != null;
  const used = parts.filter(([,v]) => v != null) as [keyof typeof SCORE_WEIGHTS, number][];
  const weight = used.reduce((s,[k]) => s + SCORE_WEIGHTS[k], 0);
  const score = hasWork && weight ? Math.round(used.reduce((s,[k,v]) => s + v*SCORE_WEIGHTS[k], 0) / weight) : null;
  return { tasks, avg, onTime, timedCount:timed.length, fixedRows, settledCount:settled.length, fixedOnTime, fixed, violations, discipline, score };
}

const fmt = (n:number|null, digits=0) => n == null ? "—" : n.toLocaleString("az-AZ", { maximumFractionDigits:digits, minimumFractionDigits:digits });
const dateOnly = (iso:string|number) => formatBakuDate(new Date(iso).getTime());

function Meter({ value, color }:{ value:number|null; color:string }) {
  return <span className="perfmeter"><i style={{ width:`${Math.max(0, Math.min(100, value ?? 0))}%`, background:color }}/></span>;
}

function TrendChart({ points }:{ points:{ label:string; value:number|null }[] }) {
  const w = 560, h = 210, left = 34, right = 14, top = 18, bottom = 30;
  const x = (i:number) => left + (points.length > 1 ? i*(w-left-right)/(points.length-1) : (w-left-right)/2);
  const y = (v:number) => top + (100-v)*(h-top-bottom)/100;
  const shown = points.map((p,i) => ({ ...p, i })).filter(p => p.value != null) as { label:string; value:number; i:number }[];
  const line = shown.map((p,k) => `${k ? "L" : "M"}${x(p.i)},${y(p.value)}`).join(" ");
  const area = shown.length > 1 ? `${line} L${x(shown[shown.length-1].i)},${y(0)} L${x(shown[0].i)},${y(0)} Z` : "";
  return <svg className="perftrend" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Rüblər üzrə ümumi bal">
    {[0,20,40,60,80,100].map(v => <g key={v}><line x1={left} x2={w-right} y1={y(v)} y2={y(v)} className="grid"/><text x={left-8} y={y(v)+3} textAnchor="end">{v}</text></g>)}
    {area && <path d={area} className="area"/>}
    {line && <path d={line} className="line"/>}
    {shown.map(p => <g key={p.i}><circle cx={x(p.i)} cy={y(p.value)} r="4" className="dot"/><text x={x(p.i)} y={y(p.value)-10} textAnchor="middle" className="val">{p.value}</text></g>)}
    {points.map((p,i) => <text key={p.label} x={x(i)} y={h-8} textAnchor="middle">{p.label}</text>)}
  </svg>;
}

const BUCKETS:[string,string][] = [["Tamamlanan","#16a34a"],["Davam edən","#2563eb"],["Gecikən","#f59e0b"],["Başlanmayan","#cbd5e1"]];
function TaskDonut({ tasks, now }:{ tasks:PerfTask[]; now:number }) {
  const counts = Object.fromEntries(BUCKETS.map(([b]) => [b, 0])) as Record<string, number>;
  tasks.forEach(t => counts[taskBucket(t, now)]++);
  const total = tasks.length;
  let at = 0;
  return <div className="donutwrap"><div className="donut"><svg viewBox="0 0 42 42" role="img" aria-label="Tapşırıqların vəziyyəti">
    <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#eef2f7" strokeWidth="6"/>
    {total > 0 && BUCKETS.filter(([b]) => counts[b]).map(([b,color]) => { const share = counts[b]/total*100; const seg = <circle key={b} cx="21" cy="21" r="15.9155" fill="none" stroke={color} strokeWidth="6" strokeDasharray={`${share} ${100-share}`} strokeDashoffset={25-at}/>; at += share; return seg; })}
  </svg><div className="donutcenter"><b>{total}</b><small>tapşırıq</small></div></div>
    <div className="donutlegend">{BUCKETS.map(([b,color]) => <div key={b} className="perflegend"><i style={{ background:color }}/><b>{counts[b]}</b><span>{b}</span></div>)}</div>
  </div>;
}

const STATE_TEXT:Record<string,[string,string]> = { done:["Vaxtında","ok"], "late-done":["Gecikməklə","warn"], overdue:["Gecikib","bad"], active:["Açıqdır","info"], future:["Hələ açılmayıb","muted"] };

export function PerformancePanel({ employeeId }:{ employeeId:number|null }) {
  const [data, setData] = useState<PerfData|null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Quarter>(currentQuarter);
  const [tab, setTab] = useState<"tasks"|"fixed"|"notes">("tasks");
  useEffect(() => { let cancelled = false; setData(null); setError("");
    fetch(`/api/performance${employeeId ? `?employeeId=${employeeId}` : ""}`).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error); if (!cancelled) setData(body); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Performans məlumatı açıla bilmədi."); });
    return () => { cancelled = true; }; }, [employeeId]);
  const now = Date.now();
  const latest = currentQuarter();
  const stats = useMemo(() => data && !data.none ? quarterStats(data, period, now) : null, [data, period.year, period.q]); // eslint-disable-line react-hooks/exhaustive-deps
  const previous = useMemo(() => data && !data.none ? quarterStats(data, shift(period, -1), now) : null, [data, period.year, period.q]); // eslint-disable-line react-hooks/exhaustive-deps
  const trend = useMemo(() => data && !data.none ? Array.from({ length:6 }, (_, i) => { const p = shift(period, i-5); return { label:shortLabel(p), value:quarterStats(data, p, now).score }; }) : [], [data, period.year, period.q]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="panel perfempty">{error}</div>;
  if (!data) return <div className="panel perfempty">Yüklənir...</div>;
  if (data.none || !stats) return <div className="panel perfempty">Hesabınız işçi kartına bağlı deyil — performans göstəriciləri yoxdur.</div>;
  const e = data.employee;
  const pos = data.positions.find(p => p.title) || data.positions[0];
  const delta = stats.score != null && previous?.score != null ? stats.score - previous.score : null;
  const approved = stats.tasks.filter(done).length;
  const notes = data.tasks.filter(t => done(t) && t.evaluation_note?.trim()).sort((a,b) => String(b.completed_at).localeCompare(String(a.completed_at))).slice(0, 5);
  const options = Array.from({ length:8 }, (_, i) => shift(latest, -i));
  const cards:[string,string,string,number|null,string][] = [
    ["Tapşırıqlar", `${approved}`, ` / ${stats.tasks.length}`, stats.tasks.length ? approved/stats.tasks.length*100 : null, "#2563eb"],
    ["Orta qiymət", fmt(stats.avg, 1), " / 10", stats.avg == null ? null : stats.avg*10, "#7c3aed"],
    ["Vaxtında icra", stats.onTime == null ? "—" : `${fmt(stats.onTime)}%`, stats.timedCount ? ` · ${stats.timedCount} tapşırıq` : "", stats.onTime, "#0A7B8C"],
    ["Sabit işlər", `${stats.fixedOnTime}`, ` / ${stats.settledCount}`, stats.fixed, "#f59e0b"],
    ["Nöqsanlar", String(stats.violations.length), stats.violations.length ? "" : " · yoxdur", stats.discipline, stats.violations.length ? "#dc2626" : "#16a34a"],
  ];
  return <div className="perfpage">
    <div className="perftoolbar"><span>Qiymətləndirmə dövrü</span>
      <select value={`${period.year}-${period.q}`} onChange={ev => { const [y,q] = ev.target.value.split("-").map(Number); setPeriod({ year:y, q }); }}>{options.map(p => <option key={`${p.year}-${p.q}`} value={`${p.year}-${p.q}`}>{quarterLabel(p)}</option>)}</select>
      <button title="Əvvəlki rüb" onClick={() => setPeriod(p => shift(p, -1))}><ChevronLeft/></button>
      <button title="Növbəti rüb" disabled={period.year*4+period.q >= latest.year*4+latest.q} onClick={() => setPeriod(p => shift(p, 1))}><ChevronRight/></button>
      <button className="perfprint" onClick={() => window.print()}><Printer/>Çap / PDF</button>
    </div>
    <div className="perfhead">
      <section className="panel perfcard">
        {e.avatar_key ? <img src={`/api/file?key=${encodeURIComponent(e.avatar_key)}`} alt={e.name}/> : <span className="perfinitials">{e.name.split(" ").slice(0,2).map(x => x[0]).join("").toUpperCase()}</span>}
        <div><h2>{e.name}</h2>{pos?.title && <p className="perfrole">{pos.title}</p>}{pos?.department && <p>🏢 {pos.department}{pos.company_name ? ` · ${pos.company_name}` : ""}</p>}{e.email && <p>✉ {e.email}</p>}</div>
      </section>
      <section className="panel perfscore">
        <h3>Ümumi performans balı</h3>
        <div><b>{stats.score ?? "—"}</b><span> / 100</span>{delta != null && <em className={delta >= 0 ? "up" : "down"}>{delta >= 0 ? "↑ +" : "↓ "}{delta}</em>}</div>
        <small>{stats.score == null ? "Bu rübdə hesablanacaq iş yoxdur." : delta != null ? "Əvvəlki rüblə müqayisədə" : quarterLabel(period)}</small>
        <small className="perfweights">Qiymət {SCORE_WEIGHTS.grade}% · Vaxtında icra {SCORE_WEIGHTS.onTime}% · Sabit işlər {SCORE_WEIGHTS.fixed}% · Nöqsanlar {SCORE_WEIGHTS.discipline}%</small>
      </section>
    </div>
    <div className="perfcards">{cards.map(([label, value, suffix, meter, color]) => <section className="panel" key={label}><small>{label}</small><div><b>{value}</b><span>{suffix}</span></div><Meter value={meter} color={color}/></section>)}</div>
    <div className="perfmid">
      <section className="panel"><div className="head"><div><h3>Performans trendi</h3><p>Son 6 rübün ümumi balı</p></div></div><TrendChart points={trend}/></section>
      <section className="panel"><div className="head"><div><h3>Tapşırıqların vəziyyəti</h3><p>{quarterLabel(period)}</p></div></div>{stats.tasks.length ? <TaskDonut tasks={stats.tasks} now={now}/> : <small className="perfnone">Bu rübdə son tarixi olan tapşırıq yoxdur.</small>}</section>
    </div>
    <section className="panel perflist">
      <div className="fixedsubtabs"><button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>Tapşırıqlar ({stats.tasks.length})</button><button className={tab === "fixed" ? "on" : ""} onClick={() => setTab("fixed")}>Sabit işlər ({stats.fixedRows.length})</button><button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>Rəhbərin qeydləri ({notes.length})</button></div>
      {tab === "tasks" && (stats.tasks.length ? <table><thead><tr><th>Tapşırıq</th><th>Son tarix</th><th>Təqdim</th><th>Vəziyyət</th><th>Qiymət</th></tr></thead><tbody>{stats.tasks.map(t => { const tm = timing(t, now); const b = taskBucket(t, now); return <tr key={t.id}><td>{t.title}{t.company_name && <small>{t.company_name}</small>}</td><td>{dateOnly(t.due_at)}</td><td>{handedIn(t) ? <span className={`perfbadge ${tm === "ontime" ? "ok" : "warn"}`}>{dateOnly(handedIn(t)!)}{tm === "late" ? " · gec" : ""}</span> : tm === "late" ? <span className="perfbadge bad">Təqdim edilməyib</span> : "—"}</td><td>{b}</td><td>{t.evaluation != null ? `${t.evaluation}/10` : "—"}</td></tr>; })}</tbody></table> : <small className="perfnone">Bu rübdə tapşırıq yoxdur.</small>)}
      {tab === "fixed" && (stats.fixedRows.length ? <table><thead><tr><th>Sabit iş</th><th>Növ</th><th>Son tarix</th><th>Vəziyyət</th></tr></thead><tbody>{stats.fixedRows.sort((a,b) => a.due - b.due).map(r => { const [text, cls] = STATE_TEXT[r.state] || [r.state, "muted"]; return <tr key={`${r.assignment.id}|${r.key}`}><td>{r.assignment.title}<small>{r.assignment.company_name}</small></td><td>{FREQUENCY_TITLES[r.assignment.frequency as FixedFrequency] || r.assignment.frequency}</td><td>{formatBakuDate(r.due)}</td><td><span className={`perfbadge ${cls}`}>{text}</span></td></tr>; })}</tbody></table> : <small className="perfnone">Bu rübdə son tarixi olan sabit iş yoxdur.</small>)}
      {tab === "notes" && (notes.length ? <ul className="perfnotes">{notes.map(t => <li key={t.id}><b>{t.title}</b><span className="perfbadge info">{t.evaluation}/10</span><p>“{t.evaluation_note}”</p>{t.completed_at && <small>{dateOnly(t.completed_at)}</small>}</li>)}</ul> : <small className="perfnone">Təsdiqlənən tapşırıqlarda hələ qeyd yazılmayıb.</small>)}
    </section>
  </div>;
}
