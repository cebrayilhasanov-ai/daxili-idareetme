"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Building2, CalendarCheck, ChevronLeft, ChevronRight, ClipboardCheck, Clock, Download, Mail, ShieldCheck, Star } from "lucide-react";
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
// The level the score is measured against (the "Hədəf" badge next to it).
export const SCORE_TARGET = 80;

function Meter({ value, color }:{ value:number|null; color:string }) {
  return <span className="perfmeter"><i style={{ width:`${Math.max(0, Math.min(100, value ?? 0))}%`, background:color }}/></span>;
}

function TrendChart({ points }:{ points:{ label:string; value:number|null }[] }) {
  const w = 520, h = 220, left = 30, right = 28, top = 22, bottom = 28;
  const x = (i:number) => left + (points.length > 1 ? i*(w-left-right)/(points.length-1) : (w-left-right)/2);
  const y = (v:number) => top + (100-v)*(h-top-bottom)/100;
  const shown = points.map((p,i) => ({ ...p, i })).filter(p => p.value != null) as { label:string; value:number; i:number }[];
  const line = shown.map((p,k) => `${k ? "L" : "M"}${x(p.i)},${y(p.value)}`).join(" ");
  const area = shown.length > 1 ? `${line} L${x(shown[shown.length-1].i)},${y(0)} L${x(shown[0].i)},${y(0)} Z` : "";
  return <svg className="perftrend" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Rüblər üzrə ümumi bal">
    <defs><linearGradient id="perfarea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity=".28"/><stop offset="100%" stopColor="#3b82f6" stopOpacity=".02"/></linearGradient></defs>
    {[0,20,40,60,80,100].map(v => <g key={v}><line x1={left} x2={w-right} y1={y(v)} y2={y(v)} className="grid"/><text x={left-8} y={y(v)+3} textAnchor="end">{v}</text></g>)}
    <line x1={left} x2={left} y1={top} y2={y(0)} className="axis"/>
    {area && <path d={area} fill="url(#perfarea)"/>}
    {line && <path d={line} className="line"/>}
    {shown.map(p => <g key={p.i}><circle cx={x(p.i)} cy={y(p.value)} r="3.5" className="dot"/><text x={x(p.i)} y={y(p.value)-10} textAnchor="middle" className="val">{p.value}</text></g>)}
    {points.map((p,i) => <text key={p.label} x={x(i)} y={h-8} textAnchor="middle">{p.label}</text>)}
  </svg>;
}

const BUCKETS:[string,string][] = [["Tamamlanan","#22a35a"],["Davam edən","#3b82f6"],["Gecikən","#f59e0b"],["Başlanmayan","#cbd5e1"]];
function TaskDonut({ tasks, now }:{ tasks:PerfTask[]; now:number }) {
  const counts = Object.fromEntries(BUCKETS.map(([b]) => [b, 0])) as Record<string, number>;
  tasks.forEach(t => counts[taskBucket(t, now)]++);
  const total = tasks.length;
  let at = 0;
  return <div className="perfdonut"><div className="ring"><svg viewBox="0 0 42 42" role="img" aria-label="Tapşırıqların bölgüsü">
    <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#eef2f7" strokeWidth="5.5"/>
    {total > 0 && BUCKETS.filter(([b]) => counts[b]).map(([b,color]) => { const share = counts[b]/total*100; const seg = <circle key={b} cx="21" cy="21" r="15.9155" fill="none" stroke={color} strokeWidth="5.5" strokeDasharray={`${share} ${100-share}`} strokeDashoffset={25-at}/>; at += share; return seg; })}
  </svg><div className="center"><b>{total}</b><small>Ümumi tapşırıq</small></div></div>
    <ul>{BUCKETS.map(([b,color]) => <li key={b}><i style={{ background:color }}/><b>{counts[b]}</b><span>{b}</span></li>)}</ul>
  </div>;
}

const STATE_TEXT:Record<string,[string,string]> = { done:["Vaxtında","ok"], "late-done":["Gecikməklə","warn"], overdue:["Gecikib","bad"], active:["Açıqdır","info"], future:["Hələ açılmayıb","muted"] };
const BUCKET_CLASS:Record<string,string> = { "Tamamlanan":"ok", "Davam edən":"info", "Gecikən":"bad", "Başlanmayan":"muted" };
type Tab = "summary"|"tasks"|"fixed"|"notes"|"history";

export function PerformancePanel({ employeeId, lead }:{ employeeId:number|null; lead?:ReactNode }) {
  const [data, setData] = useState<PerfData|null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Quarter>(currentQuarter);
  const [tab, setTab] = useState<Tab>("summary");
  useEffect(() => { let cancelled = false; setData(null); setError("");
    fetch(`/api/performance${employeeId ? `?employeeId=${employeeId}` : ""}`).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error); if (!cancelled) setData(body); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Performans məlumatı açıla bilmədi."); });
    return () => { cancelled = true; }; }, [employeeId]);
  const now = Date.now();
  const latest = currentQuarter();
  const ready = data && !data.none ? data : null;
  const stats = useMemo(() => ready ? quarterStats(ready, period, now) : null, [ready, period.year, period.q]); // eslint-disable-line react-hooks/exhaustive-deps
  const previous = useMemo(() => ready ? quarterStats(ready, shift(period, -1), now) : null, [ready, period.year, period.q]); // eslint-disable-line react-hooks/exhaustive-deps
  const history = useMemo(() => ready ? Array.from({ length:8 }, (_, i) => { const p = shift(period, i-7); return { p, s:quarterStats(ready, p, now) }; }) : [], [ready, period.year, period.q]); // eslint-disable-line react-hooks/exhaustive-deps
  const toolbar = <div className="perftoolbar"><div className="lead">{lead}</div><div className="right"><span>Qiymətləndirmə dövrü</span>
    <select value={`${period.year}-${period.q}`} onChange={ev => { const [y,q] = ev.target.value.split("-").map(Number); setPeriod({ year:y, q }); }}>{Array.from({ length:8 }, (_, i) => shift(latest, -i)).map(p => <option key={`${p.year}-${p.q}`} value={`${p.year}-${p.q}`}>{p.year} - Q{p.q}</option>)}</select>
    <button title="Əvvəlki rüb" onClick={() => setPeriod(p => shift(p, -1))}><ChevronLeft/></button>
    <button title="Növbəti rüb" disabled={period.year*4+period.q >= latest.year*4+latest.q} onClick={() => setPeriod(p => shift(p, 1))}><ChevronRight/></button>
    <button className="perfprint" onClick={() => window.print()}><Download/>PDF yüklə</button></div></div>;
  if (error) return <div className="perfpage">{toolbar}<div className="panel perfempty">{error}</div></div>;
  if (!data) return <div className="perfpage">{toolbar}<div className="panel perfempty">Yüklənir...</div></div>;
  if (!ready || !stats) return <div className="perfpage">{toolbar}<div className="panel perfempty">Hesabınız işçi kartına bağlı deyil — performans göstəriciləri yoxdur.</div></div>;
  const e = ready.employee;
  const pos = ready.positions.find(p => p.title) || ready.positions[0];
  const delta = stats.score != null && previous?.score != null ? stats.score - previous.score : null;
  const approved = stats.tasks.filter(done).length;
  const notes = ready.tasks.filter(t => done(t) && t.evaluation_note?.trim()).sort((a,b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  const fixedRows = [...stats.fixedRows].sort((a,b) => a.due - b.due);
  const cards:{ label:string; value:string; suffix:string; meter:number|null; color:string; tint:string; icon:ReactNode }[] = [
    { label:"Tapşırıq icrası", value:String(approved), suffix:` / ${stats.tasks.length}`, meter:stats.tasks.length ? approved/stats.tasks.length*100 : null, color:"#22a35a", tint:"#e8f7ee", icon:<ClipboardCheck/> },
    { label:"Orta qiymət", value:fmt(stats.avg, 1), suffix:" / 10", meter:stats.avg == null ? null : stats.avg*10, color:"#3b82f6", tint:"#e8f0fe", icon:<Star/> },
    { label:"Vaxtında icra", value:stats.onTime == null ? "—" : `${fmt(stats.onTime)}%`, suffix:"", meter:stats.onTime, color:"#f59e0b", tint:"#fef3e2", icon:<Clock/> },
    { label:"Sabit işlər", value:String(stats.fixedOnTime), suffix:` / ${stats.settledCount}`, meter:stats.fixed, color:"#7c5cf0", tint:"#efebfd", icon:<CalendarCheck/> },
    { label:"Nöqsanlar", value:String(stats.violations.length), suffix:stats.violations.length ? "" : " · yoxdur", meter:stats.discipline, color:"#0ea5a4", tint:"#e3f6f5", icon:<ShieldCheck/> },
  ];
  const parts:[string,number|null][] = [["Orta qiymət", stats.avg == null ? null : stats.avg*10], ["Vaxtında icra", stats.onTime], ["Sabit işlər", stats.fixed], ["Tapşırıq icrası", stats.tasks.length ? approved/stats.tasks.length*100 : null], ["Nöqsansızlıq", stats.discipline]];
  const tabs:[Tab,string][] = [["summary","Ümumi görünüş"],["tasks","Tapşırıqlar"],["fixed","Sabit işlər"],["notes","Rəhbərin qeydləri"],["history","Keçmiş dövrlər"]];
  const taskTable = (rows:PerfTask[]) => rows.length ? <table><thead><tr><th>Tapşırıq</th><th>Son tarix</th><th>Vəziyyət</th><th>Qiymət</th></tr></thead><tbody>{rows.map(t => { const b = taskBucket(t, now); const tm = timing(t, now); return <tr key={t.id}>
    <td><b>{t.title}</b>{t.company_name && <small>{t.company_name}</small>}</td>
    <td>{dateOnly(t.due_at)}{handedIn(t) && <small className={tm === "late" ? "late" : ""}>Təqdim: {dateOnly(handedIn(t)!)}{tm === "late" ? " · gec" : ""}</small>}</td>
    <td><span className={`perfbadge ${BUCKET_CLASS[b]}`}>{b}</span></td>
    <td><div className="perfprogress"><span>{t.evaluation != null ? `${t.evaluation * 10}%` : "—"}</span><Meter value={t.evaluation != null ? t.evaluation*10 : 0} color={t.evaluation == null ? "#cbd5e1" : t.evaluation >= 8 ? "#22a35a" : t.evaluation >= 5 ? "#3b82f6" : "#ef5b2b"}/></div></td>
  </tr>; })}</tbody></table> : <small className="perfnone">Bu rübdə son tarixi olan tapşırıq yoxdur.</small>;
  const fixedTable = fixedRows.length ? <table><thead><tr><th>Sabit iş</th><th>Növ</th><th>Son tarix</th><th>Vəziyyət</th></tr></thead><tbody>{fixedRows.map(r => { const [text, cls] = STATE_TEXT[r.state] || [r.state, "muted"]; return <tr key={`${r.assignment.id}|${r.key}`}><td><b>{r.assignment.title}</b><small>{r.assignment.company_name}</small></td><td>{FREQUENCY_TITLES[r.assignment.frequency as FixedFrequency] || r.assignment.frequency}</td><td>{formatBakuDate(r.due)}</td><td><span className={`perfbadge ${cls}`}>{text}</span></td></tr>; })}</tbody></table> : <small className="perfnone">Bu rübdə son tarixi olan sabit iş yoxdur.</small>;
  const note = (t:PerfTask) => <div className="perfnote" key={t.id}><div className="who"><i>{t.evaluation}</i><div><b>{t.title}</b><small>Qiymət: {t.evaluation}/10{t.company_name ? ` · ${t.company_name}` : ""}</small></div>{t.completed_at && <time>{dateOnly(t.completed_at)}</time>}</div><p>“{t.evaluation_note}”</p></div>;
  return <div className="perfpage">
    {toolbar}
    <section className="panel perftop">
      <div className="perfprofile">
        {e.avatar_key ? <img src={`/api/file?key=${encodeURIComponent(e.avatar_key)}`} alt={e.name}/> : <span className="perfinitials">{e.name.split(" ").slice(0,2).map(x => x[0]).join("").toUpperCase()}</span>}
        <div><h2>{e.name}</h2>{pos?.title && <p className="role">{pos.title}</p>}{pos?.department && <p><Building2/>{pos.department}{pos.company_name ? ` · ${pos.company_name}` : ""}</p>}{e.email && <p><Mail/>{e.email}</p>}</div>
      </div>
      <div className="perfscore">
        <h3>Ümumi performans balı</h3>
        <div className="row"><b>{stats.score ?? "—"}</b><span>/ 100</span>
          {delta != null && <div className={`delta ${delta >= 0 ? "up" : "down"}`}><strong>{delta >= 0 ? <ArrowUp/> : <ArrowDown/>}{delta >= 0 ? `+${delta}` : delta}</strong><small>Əvvəlki dövrə görə</small></div>}
          <em className="target">Hədəf: {SCORE_TARGET}</em></div>
        {stats.score == null && <small>Bu rübdə hesablanacaq iş yoxdur.</small>}
      </div>
    </section>
    <div className="perfcards">{cards.map(c => <section className="panel" key={c.label}><i className="icon" style={{ background:c.tint, color:c.color }}>{c.icon}</i><div><small>{c.label}</small><p><b>{c.value}</b>{c.suffix && <span>{c.suffix}</span>}</p><Meter value={c.meter} color={c.color}/></div></section>)}</div>
    <nav className="perftabs">{tabs.map(([key, label]) => <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {tab === "summary" && <div className="perfgrid">
      <section className="panel trend"><h3>Performans trendi</h3><TrendChart points={history.slice(-7).map(h => ({ label:`Q${h.p.q} ${h.p.year}`, value:h.s.score }))}/></section>
      <section className="panel donut"><h3>Tapşırıq bölgüsü</h3>{stats.tasks.length ? <TaskDonut tasks={stats.tasks} now={now}/> : <small className="perfnone">Bu rübdə son tarixi olan tapşırıq yoxdur.</small>}</section>
      <section className="panel bars"><h3>Bal tərkibi</h3><ul className="perfbars">{parts.map(([label, v]) => <li key={label}><span>{label}</span><Meter value={v} color="#3b82f6"/><b>{v == null ? "—" : fmt(v)}</b></li>)}</ul><small className="perfweights">Ümumi bal: qiymət {SCORE_WEIGHTS.grade}% · vaxtında icra {SCORE_WEIGHTS.onTime}% · sabit işlər {SCORE_WEIGHTS.fixed}% · nöqsanlar {SCORE_WEIGHTS.discipline}%</small></section>
      <section className="panel table"><div className="head"><h3>Tapşırıqlar</h3><button onClick={() => setTab("tasks")}>Bütün tapşırıqları gör <ArrowRight/></button></div>{taskTable(stats.tasks.slice(0, 6))}</section>
      <section className="panel note"><h3>Rəhbərin qeydi</h3>{notes.length ? note(notes[0]) : <small className="perfnone">Təsdiqlənən tapşırıqlarda hələ qeyd yazılmayıb.</small>}</section>
      <section className="panel plan"><div className="head"><h3>Sabit işlər</h3><button onClick={() => setTab("fixed")}>Hamısını gör <ArrowRight/></button></div>{fixedRows.length ? <ul className="perfplan">{fixedRows.slice(0, 4).map(r => { const [text, cls] = STATE_TEXT[r.state] || [r.state, "muted"]; return <li key={`${r.assignment.id}|${r.key}`}><i><CalendarCheck/></i><div><b>{r.assignment.title}</b><small>{FREQUENCY_TITLES[r.assignment.frequency as FixedFrequency] || r.assignment.frequency} · {formatBakuDate(r.due)}</small></div><span className={`perfbadge ${cls}`}>{text}</span></li>; })}</ul> : <small className="perfnone">Bu rübdə son tarixi olan sabit iş yoxdur.</small>}</section>
    </div>}
    {tab === "tasks" && <section className="panel perflist">{taskTable(stats.tasks)}</section>}
    {tab === "fixed" && <section className="panel perflist">{fixedTable}</section>}
    {tab === "notes" && <section className="panel perflist perfnotes">{notes.length ? notes.slice(0, 20).map(note) : <small className="perfnone">Təsdiqlənən tapşırıqlarda hələ qeyd yazılmayıb.</small>}</section>}
    {tab === "history" && <section className="panel perflist"><table><thead><tr><th>Dövr</th><th>Ümumi bal</th><th>Tapşırıq icrası</th><th>Orta qiymət</th><th>Vaxtında icra</th><th>Sabit işlər</th><th>Nöqsanlar</th></tr></thead><tbody>{[...history].reverse().map(({ p, s }) => <tr key={`${p.year}-${p.q}`}><td><b>{quarterLabel(p)}</b></td><td><b>{s.score ?? "—"}</b></td><td>{s.tasks.filter(done).length} / {s.tasks.length}</td><td>{fmt(s.avg, 1)}</td><td>{s.onTime == null ? "—" : `${fmt(s.onTime)}%`}</td><td>{s.fixedOnTime} / {s.settledCount}</td><td>{s.violations.length}</td></tr>)}</tbody></table></section>}
  </div>;
}
