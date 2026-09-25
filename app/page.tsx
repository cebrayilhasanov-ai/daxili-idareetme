"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Bell, Briefcase, Inbox, Building2, CheckCircle2, CircleAlert, ClipboardList, Download, Eye, EyeOff, FileText, KeyRound, LayoutDashboard, LogOut, Menu, MessageCircle, Paperclip, Plus, RefreshCw, Send, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MONTH_NAMES, WEEKDAY_NAMES, bakuToday, dueDay, dueLabel, formatBakuDate, monthlyKey, overdueDays, periodState, periodWindow, weeksOfMonth } from "@/lib/fixed-periods";

type Employee = { id:number; name:string; position:string; email:string|null; active:number; created_at:string; company_ids:string|null; company_positions:string|null; main_company_id:number|null; avatar_key:string|null };
type Company = { id:number; name:string; voen:string|null; manager:string|null; active:number; created_at:string };
type Task = { id:number; employee_id:number; employee_name:string; employee_position:string; company_id:number|null; company_name:string|null; title:string; description:string|null; due_at:string; original_due_at:string|null; status:string; evaluation:number|null; evaluation_note:string|null; employee_status_changed:number; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; submission_attachment_key:string|null; submission_attachment_name:string|null; submission_attachment_size:number|null; submission_attachment_type:string|null; recurring_task_id:number|null; period_key:string|null; created_at:string; assigned_by:string|null };
type DateRequest = { id:number; task_id:number; task_title:string; employee_id:number; employee_name:string; proposed_due_at:string; reason:string|null; status:string; admin_note:string|null; created_at:string; resolved_at:string|null };
type Recurring = { id:number; employee_id:number; employee_name:string; title:string; description:string|null; due_day:number; frequency:"monthly"|"weekly"|"daily"; weekday:number|null; due_time:string; active:number };
type WorkItem = { id:number; title:string; description:string|null; frequency:"monthly"|"weekly"|"daily"; company_ids:string|null; due_day:number|null };
type WorkAssignment = { id:number; work_definition_id:number; title:string; description:string|null; frequency:"monthly"|"weekly"|"daily"; due_day:number|null; employee_id:number; employee_name:string; company_id:number; company_name:string; period_key:string; is_completed:number };
type WorkCompletion = { work_assignment_id:number; period_key:string; completed_at:string };
type Data = { employees:Employee[]; companies:Company[]; tasks:Task[]; recurring:Recurring[]; workItems:WorkItem[]; workAssignments:WorkAssignment[]; workCompletions:WorkCompletion[]; dateRequests:DateRequest[] };
type AppUser = { id:number; name:string; email:string; role:"admin"|"employee"; employeeId:number|null; active?:number; mustChangePassword?:boolean; backgroundKey?:string|null; avatarKey?:string|null };
type ManagedUser = { id:number; name:string; email:string; role:string; employee_id:number|null; active:number; must_change_password:number };
type Page = "dashboard"|"tasks"|"requests"|"chat"|"employees"|"companies"|"customers"|"audit"|"documents"|"hr";
type AuditItem = { id:number; actor_name:string; action:string; target_type:string; target_label:string|null; created_at:string };
type Violation = { id:number; employee_id:number; employee_name:string; company_id:number|null; company_name:string|null; title:string; note:string|null; created_by_name:string|null; created_at:string };
type EmployeeCompanyPosition = { company_id:number; position_id:number|null; position_title:string|null };
const parseCompanyPositions=(raw:string|null|undefined):EmployeeCompanyPosition[]=>{try{const list=JSON.parse(raw||"[]");return Array.isArray(list)?list:[]}catch{return []}};
const companyPositionsForm=(raw:string|null|undefined)=>JSON.stringify(Object.fromEntries(parseCompanyPositions(raw).filter(p=>p.position_id).map(p=>[String(p.company_id),p.position_id])));
type DelegateCandidate = { id:number; name:string; position_title:string|null };
type StructurePosition = { id:number; company_id:number; department:string; title:string; reports_to:string|null; sort_order:number; created_at:string };
type ChatThread = { id:number; type:"group"|"direct"; name:string; avatar_key:string|null; last_message:string|null; last_message_at:string|null; unread:number };
type ChatMessage = { id:number; thread_id:number; sender_user_id:number; sender_name:string; sender_avatar_key:string|null; body:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; created_at:string };
type ChatUser = { id:number; name:string; email:string; avatar_key:string|null };
type Customer = { id:number; entity_type:string|null; voen:string|null; name:string; legal_address:string|null; legal_address2:string|null; manager:string|null; created_at:string };
type ChecklistItem = { id:number; task_id:number; title:string; done:number; created_at:string; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null };
type ChecklistLikeItem = { id:number; title:string; done:number; delegated_task_id?:number|null; delegated_employee_name?:string|null; delegated_task_status?:string|null; attachment_key?:string|null; attachment_name?:string|null; attachment_size?:number|null; delegated_submission_attachment_key?:string|null; delegated_submission_attachment_name?:string|null; delegated_submission_attachment_size?:number|null };
type PersonalWork = { id:number; user_id:number; owner_name:string; title:string; description:string|null; company_id:number|null; company_name:string|null; due_at:string|null; status:string; created_at:string; completed_at:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; shared?:{employee_id:number;name:string;total:number;done:number}[] };
type WorkHistoryEvent = { id:number; actor_name:string; action:string; detail:string|null; created_at:string|null };
type PersonalWorkChecklistItem = { id:number; personal_work_id:number; title:string; done:number; created_at:string; delegated_task_id:number|null; delegated_employee_id:number|null; delegated_employee_name:string|null; delegated_task_status:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; delegated_submission_attachment_key:string|null; delegated_submission_attachment_name:string|null; delegated_submission_attachment_size:number|null };
type DocumentTemplate = { id:number; name:string; template1_key:string|null; template1_name:string|null; template1_size:number|null; template1_type:string|null; template2_key:string|null; template2_name:string|null; template2_size:number|null; template2_type:string|null; template3_key:string|null; template3_name:string|null; template3_size:number|null; template3_type:string|null; draft_folder_path:string|null; final_folder_path:string|null; created_at:string };
type OutgoingDocument = { id:number; outgoing_no:string; outgoing_date:string|null; incoming_no:string|null; incoming_date:string|null; sending_department:string|null; document_type:string|null; sending_method:string|null; delivered_by:string|null; copies:string|null; document_number:string|null; document_date:string|null; voen:string|null; organization_name:string|null; phone:string|null; note:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; created_at:string };
type WorkRequest = { id:number; company_id:number; company_name:string; from_user_id:number; from_name:string|null; from_department:string|null; to_department:string; assignee_employee_id:number|null; assignee_name:string|null; title:string; description:string|null; desired_due_at:string|null; agreed_due_at:string|null; status:string; reject_reason:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; created_at:string; box:"incoming"|"outgoing"|"oversight"; actionable:boolean; can:Record<"accept"|"reject"|"reassign"|"start"|"answer"|"close"|"reopen"|"remove"|"comment",boolean> };
type RequestsData = { items:WorkRequest[]; departments:Record<string,string[]>; members:Record<string,Array<{id:number;name:string;position_title:string}>>; myDepartments:Record<string,string|null> };
type ChatData = { threads:ChatThread[]; users:ChatUser[]; messages:ChatMessage[]; selectedThreadId:number; totalUnread:number; readUpTo:number };

const emptyData:Data={employees:[],companies:[],tasks:[],recurring:[],workItems:[],workAssignments:[],workCompletions:[],dateRequests:[]};
const weekdays=["Bazar ertəsi","Çərşənbə axşamı","Çərşənbə","Cümə axşamı","Cümə","Şənbə","Bazar"];
const frequencyLabel=(value:string)=>value==="daily"?"Günlük":value==="weekly"?"Həftəlik":"Aylıq";
const frequencyText=(value:string)=>value==="daily"?"hər gün":value==="weekly"?"hər həftə":"hər ay";

export default function Home(){
  const [user,setUser]=useState<AppUser|null>(null);
  const [authLoading,setAuthLoading]=useState(true);
  const [authForm,setAuthForm]=useState({email:"",password:""});
  const [data,setData]=useState<Data>(emptyData);
  const [page,setPage]=useState<Page>("dashboard");
  const [menu,setMenu]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [dialog,setDialog]=useState<"employee"|"company"|"task"|"recurring"|"evaluate"|"password"|"background"|"avatar"|null>(null);
  const [selectedTask,setSelectedTask]=useState<Task|null>(null);
  const [form,setForm]=useState<Record<string,string>>({});
  const [viewAs,setViewAs]=useState<Employee|null>(null);
  const [employeePhoto,setEmployeePhoto]=useState<File|null>(null);
  const [uploadingPhoto,setUploadingPhoto]=useState(false);
  const [backgroundFile,setBackgroundFile]=useState<File|null>(null);
  const [uploadingBackground,setUploadingBackground]=useState(false);
  const [ownAvatarFile,setOwnAvatarFile]=useState<File|null>(null);
  const [uploadingOwnAvatar,setUploadingOwnAvatar]=useState(false);
  const [chatUnread,setChatUnread]=useState(0);
  const [requestsPending,setRequestsPending]=useState(0);
  const [dashboardMenuOpen,setDashboardMenuOpen]=useState(false);
  const [tasksMenuOpen,setTasksMenuOpen]=useState(false);
  const [fixedTab,setFixedTab]=useState<"catalog"|"assignments">("catalog");
  const [taskSubTab,setTaskSubTab]=useState<"tasks"|"monthly"|"weekly">("tasks");
  const [tasksSection,setTasksSection]=useState<"manager"|"mine">("manager");
  const [documentsMenuOpen,setDocumentsMenuOpen]=useState(false);
  const [hrMenuOpen,setHrMenuOpen]=useState(false);
  const [documentSubTab,setDocumentSubTab]=useState<"templates"|"outgoing"|"incoming">("templates");
  const [notifOpen,setNotifOpen]=useState(false);
  const [seenOverdue,setSeenOverdue]=useState<number[]>([]);
  const [activeCompanyId,setActiveCompanyId]=useState<number|null>(null);

  const load=async()=>{setLoading(true);setError("");try{const response=await fetch("/api/data");const body=await response.json();if(!response.ok)throw new Error(body.error);setData(body)}catch(e){setError(e instanceof Error?e.message:"Xəta baş verdi.")}finally{setLoading(false)}};
  useEffect(()=>{let cancelled=false;void fetch("/api/auth").then(async response=>{if(!response.ok)return null;return (await response.json()).user as AppUser}).then(found=>{if(!cancelled)setUser(found)}).finally(()=>{if(!cancelled)setAuthLoading(false)});return()=>{cancelled=true}},[]);
  useEffect(()=>{if(!user)return;void load().then(()=>undefined)},[user]);
  useEffect(()=>{if(!user)return;const check=()=>void fetch("/api/chat?summary=1").then(r=>r.ok?r.json():null).then(v=>v&&setChatUnread(Number(v.totalUnread||0)));check();const timer=setInterval(check,10000);return()=>clearInterval(timer)},[user]);
  useEffect(()=>{if(!user)return;const check=()=>void fetch("/api/requests?summary=1").then(r=>r.ok?r.json():null).then(v=>v&&setRequestsPending(Number(v.actionable||0)));check();const timer=setInterval(check,30000);return()=>clearInterval(timer)},[user]);
  const signIn=async()=>{setError("");setAuthLoading(true);try{const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"login",...authForm})});const body=await response.json();if(!response.ok)throw new Error(body.error);setUser(body.user);setAuthForm({email:"",password:""})}catch(e){setError(e instanceof Error?e.message:"Giriş baş tutmadı.")}finally{setAuthLoading(false)}};
  const signOut=async()=>{await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"logout"})});setUser(null);setData(emptyData);setPage("dashboard");setViewAs(null)};
  const changeOwnPassword=async()=>{setError("");const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"change-password",currentPassword:form.currentPassword,newPassword:form.newPassword})});const body=await response.json();if(!response.ok){setError(body.error);return}setDialog(null);setForm({});setUser(current=>current?{...current,mustChangePassword:false}:current)};
  const saveBackground=async()=>{if(!backgroundFile)return;setError("");setUploadingBackground(true);try{if(backgroundFile.size>8*1024*1024)throw new Error("Fon şəklinin həcmi 8 MB-dan çox ola bilməz.");const upload=new FormData();upload.append("file",backgroundFile);const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});const uploadResult=await uploadResponse.json();if(!uploadResponse.ok)throw new Error(uploadResult.error||"Şəkil yüklənmədi.");const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"set-background",backgroundKey:uploadResult.key})});const body=await response.json();if(!response.ok)throw new Error(body.error);setUser(body.user);setDialog(null);setBackgroundFile(null)}catch(e){setError(e instanceof Error?e.message:"Fon şəkli yüklənmədi.")}finally{setUploadingBackground(false)}};
  const removeBackground=async()=>{setError("");try{const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"set-background",backgroundKey:null})});const body=await response.json();if(!response.ok)throw new Error(body.error);setUser(body.user);setDialog(null);setBackgroundFile(null)}catch(e){setError(e instanceof Error?e.message:"Fon şəkli silinmədi.")}};
  const saveOwnAvatar=async()=>{if(!ownAvatarFile)return;setError("");setUploadingOwnAvatar(true);try{if(ownAvatarFile.size>5*1024*1024)throw new Error("Şəklin həcmi 5 MB-dan çox ola bilməz.");const upload=new FormData();upload.append("file",ownAvatarFile);const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});const uploadResult=await uploadResponse.json();if(!uploadResponse.ok)throw new Error(uploadResult.error||"Şəkil yüklənmədi.");const response=await fetch("/api/data",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"self-avatar",avatarKey:uploadResult.key})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Şəkil yüklənmədi.");setData(result);setUser(current=>current?{...current,avatarKey:uploadResult.key}:current);setDialog(null);setOwnAvatarFile(null)}catch(e){setError(e instanceof Error?e.message:"Şəkil yüklənmədi.")}finally{setUploadingOwnAvatar(false)}};
  const removeOwnAvatar=async()=>{setError("");try{const response=await fetch("/api/data",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"self-avatar",avatarKey:null})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Şəkil silinmədi.");setData(result);setUser(current=>current?{...current,avatarKey:null}:current);setDialog(null);setOwnAvatarFile(null)}catch(e){setError(e instanceof Error?e.message:"Şəkil silinmədi.")}};
  const uploadPhotoIfAny=async()=>{if(!employeePhoto)return undefined;if(employeePhoto.size>5*1024*1024)throw new Error("Şəklin həcmi 5 MB-dan çox ola bilməz.");const upload=new FormData();upload.append("file",employeePhoto);const response=await fetch("/api/file",{method:"POST",body:upload});const result=await response.json();if(!response.ok)throw new Error(result.error||"Şəkil yüklənmədi.");return result.key as string};
  const createPersonnel=async()=>{setError("");setUploadingPhoto(Boolean(employeePhoto));try{const avatarKey=await uploadPhotoIfAny();const response=await fetch("/api/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...form,companyIds:(form.companyIds||"").split(",").filter(Boolean).map(Number),companyPositions:JSON.parse(form.companyPositions||"{}"),mainCompanyId:Number(form.mainCompanyId)||null,avatarKey})});const body=await response.json();if(!response.ok)throw new Error(body.error);setDialog(null);setForm({});setEmployeePhoto(null);location.reload()}catch(e){setError(e instanceof Error?e.message:"Personal yaradılmadı.")}finally{setUploadingPhoto(false)}};
  const saveEmployeeEdit=async()=>{setError("");setUploadingPhoto(Boolean(employeePhoto));try{const avatarKey=await uploadPhotoIfAny();await request("PATCH",{action:"employee",id:Number(form.id),name:form.name,email:form.email,companyIds:(form.companyIds||"").split(",").filter(Boolean).map(Number),companyPositions:JSON.parse(form.companyPositions||"{}"),mainCompanyId:Number(form.mainCompanyId)||null,...(avatarKey?{avatarKey}:{})});setEmployeePhoto(null)}catch(e){setError(e instanceof Error?e.message:"Personal yenilənmədi.")}finally{setUploadingPhoto(false)}};
  const request=async(method:"POST"|"PATCH",body:Record<string,unknown>)=>{setError("");try{const response=await fetch("/api/data",{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||"Əməliyyat baş tutmadı.");setData(result);setDialog(null);setForm({})}catch(e){setError(e instanceof Error?e.message:"Əməliyyat baş tutmadı.")}};
  const deleteWorker=async(employee:Employee)=>{if(!window.confirm(`${employee.name} adlı personalı tam silmək istəyirsiniz?`))return;setError("");try{const response=await fetch(`/api/data?employeeId=${employee.id}`,{method:"DELETE"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Personal silinmədi.");setData(result)}catch(e){setError(e instanceof Error?e.message:"Personal silinmədi.")}};
  const deleteTaskItem=async(task:Task)=>{if(!window.confirm(`“${task.title}” tapşırığını silmək istəyirsiniz?`))return;setError("");try{const response=await fetch(`/api/data?taskId=${task.id}`,{method:"DELETE"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Tapşırıq silinmədi.");setData(result)}catch(e){setError(e instanceof Error?e.message:"Tapşırıq silinmədi.")}};

  const isAdmin=user?.role==="admin";
  const employeeSelf=!isAdmin&&data.employees.find(e=>e.id===user?.employeeId)||null;
  const effectiveView=viewAs||employeeSelf;
  // Lets the admin (Cəbrayıl Həsənov), who is also his own Personal entry, jump straight into his own employee view from the sidebar — same "Personal görünüşü" mechanism, one click.
  const myOwnEmployee=isAdmin?data.employees.find(e=>e.name===user?.name||(user?.email&&e.email&&e.email.toLowerCase()===user.email.toLowerCase()))||null:null;
  const ownAvatarKey=employeeSelf?.avatar_key||user?.avatarKey||null;
  // Whoever is the "active identity" (a real non-admin login, OR an admin using Personal görünüşü — including on themselves) picks one active firma from the sidebar;
  // every company-linked section (tasks, works, HR, fixed works) then scopes to it. Plain admin (no viewAs) stays unscoped, seeing every firma.
  const companyScopeActive=Boolean(effectiveView);
  const myCompanies=effectiveView?data.companies.filter(c=>Boolean(c.active)&&(effectiveView.company_ids||"").split(",").filter(Boolean).map(Number).includes(c.id)):[];
  useEffect(()=>{
    if(!effectiveView){if(activeCompanyId!==null)setActiveCompanyId(null);return}
    let saved:number|null=null;
    try{const raw=localStorage.getItem(`activeCompany:${effectiveView.id}`);saved=raw?Number(raw):null}catch{saved=null}
    const next=myCompanies.some(c=>c.id===saved)?saved:(myCompanies[0]?.id??null);
    if(next!==activeCompanyId)setActiveCompanyId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[effectiveView?.id,myCompanies.map(c=>c.id).join(",")]);
  const pickCompany=(id:number)=>{setActiveCompanyId(id);if(effectiveView)try{localStorage.setItem(`activeCompany:${effectiveView.id}`,String(id))}catch{}};
  const visibleTasks=(effectiveView?data.tasks.filter(t=>t.employee_id===effectiveView.id):data.tasks).filter(t=>!companyScopeActive||!activeCompanyId||t.company_id===activeCompanyId);
  const activeTasks=visibleTasks.filter(t=>t.status!=="Təsdiqlənib");
  const overdue=activeTasks.filter(t=>new Date(t.due_at)<new Date());
  const pendingDateRequests=data.dateRequests.filter(r=>r.status==="Gözləyir");
  const unseenOverdue=overdue.filter(t=>!seenOverdue.includes(t.id));
  useEffect(()=>{if(!user)return;try{const raw=localStorage.getItem(`seenOverdue:${user.id}`);setSeenOverdue(raw?JSON.parse(raw):[])}catch{setSeenOverdue([])}},[user]);
  useEffect(()=>{if(!user||(!notifOpen&&page!=="tasks"))return;const ids=overdue.map(t=>t.id);if(ids.every(id=>seenOverdue.includes(id)))return;const next=Array.from(new Set([...seenOverdue,...ids]));setSeenOverdue(next);try{localStorage.setItem(`seenOverdue:${user.id}`,JSON.stringify(next))}catch{}},[user,notifOpen,page,overdue,seenOverdue]);
  const completed=visibleTasks.filter(t=>t.status==="Təsdiqlənib");
  const activeEmployees=data.employees.filter(e=>Boolean(e.active));
  const title:Record<Page,string>={dashboard:"İdarə paneli",tasks:"Tapşırıqlar",requests:"Sorğular",chat:"Çat",employees:"Personal",companies:"Firmalar",customers:"Müştəri siyahısı",audit:"Tarixçə",documents:"Sənədlər",hr:"HR"};
  const nav:[Page,string,React.ComponentType][]=[["dashboard","İdarə paneli",LayoutDashboard],["tasks","Tapşırıqlar",ClipboardList],["requests","Sorğular",Inbox],["documents","Sənədlər",FileText],["hr","HR",Briefcase],["chat","Çat",MessageCircle]];
  const open=(kind:typeof dialog,initial:Record<string,string>={})=>{setForm(initial);setDialog(kind)};

  if(authLoading&&!user)return <div className="authpage"><div className="authcard"><div className="authlogo">Dİ</div><h1>Daxili İdarəetmə</h1><p>Giriş yoxlanılır...</p></div></div>;
  if(!user)return <LoginScreen form={authForm} setForm={setAuthForm} error={error} loading={authLoading} onLogin={()=>void signIn()}/>;
  return <div className="shell">
    {menu&&<button className="shade" onClick={()=>setMenu(false)}/>}
    <aside className={menu?"side show":"side"}>
      <button className="close" onClick={()=>setMenu(false)}><X/></button>
      <div className="sidescroll">
      <div className="brand"><i>Dİ</i><div><b>Daxili İdarəetmə</b><small>İş və tapşırıq sistemi</small><small className="brandversion">Versiya 2.20</small></div></div>
      {companyScopeActive&&myCompanies.length>1&&<div className="companyswitcher"><label>Aktiv firma<select value={activeCompanyId??""} onChange={e=>pickCompany(Number(e.target.value))}>{myCompanies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>}
      <nav>{nav.filter(([id])=>isAdmin||id==="dashboard"||id==="tasks"||id==="requests"||id==="documents"||id==="hr"||id==="chat").filter(([id])=>!viewAs||id==="dashboard"||id==="tasks").map(([id,label,Icon])=>{
        if(id==="dashboard")return <Fragment key={id}><button className={page===id?"on":""} onClick={()=>{setPage(id);setMenu(false)}} onDoubleClick={()=>setDashboardMenuOpen(v=>!v)}><Icon/>{label}</button>{dashboardMenuOpen&&<div className="navchildren">{isAdmin&&!viewAs&&<button className={page==="companies"?"on":""} onClick={()=>{setPage("companies");setMenu(false)}}>Firmalar</button>}{!viewAs&&<button className={page==="customers"?"on":""} onClick={()=>{setPage("customers");setMenu(false)}}>Müştəri siyahısı</button>}{isAdmin&&!viewAs&&<button className={page==="employees"?"on":""} onClick={()=>{setPage("employees");setMenu(false)}}>Personal</button>}{isAdmin&&!viewAs&&<button className={page==="audit"?"on":""} onClick={()=>{setPage("audit");setMenu(false)}}>Tarixçə</button>}<button onClick={()=>{setForm({});setDialog("password");setMenu(false)}}>Şifrəni dəyiş</button><button onClick={()=>{setBackgroundFile(null);setDialog("background");setMenu(false)}}>Fon şəkli</button><button onClick={()=>{setOwnAvatarFile(null);setDialog("avatar");setMenu(false)}}>Profil şəkli</button></div>}</Fragment>;
        if(id==="tasks")return <Fragment key={id}><button className={page===id?"on":""} onClick={()=>{setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks");setMenu(false)}} onDoubleClick={()=>setTasksMenuOpen(v=>!v)}><Icon/>{label}{unseenOverdue.length>0&&<em>{unseenOverdue.length}</em>}</button>{tasksMenuOpen&&<div className="navchildren"><button className={page==="tasks"&&taskSubTab==="monthly"?"on":""} onClick={()=>{setTaskSubTab("monthly");setPage("tasks");setMenu(false)}}>Aylıq Sabit işlər</button><button className={page==="tasks"&&taskSubTab==="weekly"?"on":""} onClick={()=>{setTaskSubTab("weekly");setPage("tasks");setMenu(false)}}>Həftəlik Sabit işlər</button><button className={page==="tasks"&&taskSubTab==="tasks"&&tasksSection==="manager"?"on":""} onClick={()=>{setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks");setMenu(false)}}>Rəhbər tərəfindən göndərilən</button><button className={page==="tasks"&&taskSubTab==="tasks"&&tasksSection==="mine"?"on":""} onClick={()=>{setTaskSubTab("tasks");setTasksSection("mine");setPage("tasks");setMenu(false)}}>İşlərim</button></div>}</Fragment>;
        if(id==="documents")return <Fragment key={id}><button className={page===id?"on":""} onClick={()=>{setDocumentSubTab("templates");setPage("documents");setMenu(false)}} onDoubleClick={()=>setDocumentsMenuOpen(v=>!v)}><Icon/>{label}</button>{documentsMenuOpen&&<div className="navchildren"><button className={page==="documents"&&documentSubTab==="templates"?"on":""} onClick={()=>{setDocumentSubTab("templates");setPage("documents");setMenu(false)}}>Şablonlar</button><button className={page==="documents"&&documentSubTab==="outgoing"?"on":""} onClick={()=>{setDocumentSubTab("outgoing");setPage("documents");setMenu(false)}}>Çıxan Sənədlər</button><button className={page==="documents"&&documentSubTab==="incoming"?"on":""} onClick={()=>{setDocumentSubTab("incoming");setPage("documents");setMenu(false)}}>Daxil Olan Sənədlər</button></div>}</Fragment>;
        if(id==="hr")return <Fragment key={id}><button className={page===id?"on":""} onClick={()=>{setPage("hr");setMenu(false)}} onDoubleClick={()=>setHrMenuOpen(v=>!v)}><Icon/>{label}</button>{hrMenuOpen&&<div className="navchildren"><button className={page==="hr"?"on":""} onClick={()=>{setPage("hr");setMenu(false)}}>Noqsanlar</button></div>}</Fragment>;
        return <Fragment key={id}><button className={page===id?"on":""} onClick={()=>{setPage(id);setMenu(false)}}><Icon/>{label}{id==="chat"&&chatUnread>0&&<em>{chatUnread}</em>}{id==="requests"&&requestsPending>0&&<em>{requestsPending}</em>}</button></Fragment>;
      })}</nav>
      </div>
      <div className="admin"><span>{initials(viewAs?viewAs.name:user.name)}</span><div><b>{viewAs?viewAs.name:user.name}</b><small>{viewAs?"İstifadəçi":isAdmin?"Baş administrator":"İstifadəçi"}</small><small>{viewAs?(viewAs.email||"—"):user.email}</small></div>{isAdmin&&myOwnEmployee&&!viewAs&&<button className="switchuserbtn" title="İstifadəçi hesabına keç" onClick={()=>{setViewAs(myOwnEmployee);setPage("dashboard")}}><Users/></button>}<button className="logoutbtn" title="Çıxış" onClick={()=>void signOut()}><LogOut/></button></div>
    </aside>
    <main style={user.backgroundKey?{backgroundImage:`linear-gradient(rgba(246,248,255,.88),rgba(242,246,251,.88)), url(/api/file?key=${encodeURIComponent(user.backgroundKey)})`,backgroundSize:"cover",backgroundPosition:"center",backgroundAttachment:"fixed"}:undefined}>
      <header><button className="hamb" onClick={()=>setMenu(true)}><Menu/></button><div><h1>{title[page]}</h1><p>{effectiveView?`${effectiveView.name} tapşırıqları`:"Personalı, tapşırıqları və nəticələri vahid sistemdə idarə edin"}</p></div><div className="actions"><button onClick={()=>void load()} title="Yenilə"><RefreshCw/></button><div className="bellwrap">{notifOpen&&<button className="notifshade" aria-label="Bağla" onClick={()=>setNotifOpen(false)}/>}<button className="bellbtn" title="Bildirişlər" onClick={()=>setNotifOpen(v=>!v)}><Bell/>{(chatUnread+requestsPending+unseenOverdue.length+(isAdmin&&!viewAs?pendingDateRequests.length:0))>0&&<em className="headerbadge">{chatUnread+requestsPending+unseenOverdue.length+(isAdmin&&!viewAs?pendingDateRequests.length:0)}</em>}</button>{notifOpen&&<div className="notifpanel"><div className="notifsection"><b>Oxunmamış mesajlar</b><button onClick={()=>{setNotifOpen(false);setPage("chat")}}>{chatUnread>0?`${chatUnread} yeni mesaj`:"Yeni mesaj yoxdur"}</button></div><div className="notifsection"><b>Sorğular</b><button onClick={()=>{setNotifOpen(false);setPage("requests")}}>{requestsPending>0?`${requestsPending} sorğu sizi gözləyir`:"Gözləyən sorğu yoxdur"}</button></div><div className="notifsection"><b>Gecikən tapşırıqlar</b>{overdue.length?<>{overdue.slice(0,5).map(t=><button key={t.id} onClick={()=>{setNotifOpen(false);setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks")}}>{t.title} — {t.employee_name}</button>)}{overdue.length>5&&<small>+{overdue.length-5} daha</small>}</>:<small>Gecikən tapşırıq yoxdur</small>}</div>{isAdmin&&!viewAs&&<div className="notifsection"><b>Tarix dəyişikliyi tələbləri</b>{pendingDateRequests.length?<>{pendingDateRequests.slice(0,5).map(r=><button key={r.id} onClick={()=>{setNotifOpen(false);setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks")}}>{r.task_title} — {r.employee_name} → {formatDate(r.proposed_due_at)}</button>)}{pendingDateRequests.length>5&&<small>+{pendingDateRequests.length-5} daha</small>}</>:<small>Gözləyən tələb yoxdur</small>}</div>}</div>}</div></div></header>
      {viewAs&&<div className="viewasbar"><div><strong>{viewAs.name}</strong><span>Personal görünüşündəsiniz</span></div><button onClick={()=>{setViewAs(null);setPage("employees")}}>Admin görünüşünə qayıt</button></div>}
      {error&&<div className="errorbox">{error}</div>}
      {loading?<div className="loading">Məlumatlar yüklənir...</div>:<>
        {page==="dashboard"&&<Dashboard userName={user.name} avatarKey={ownAvatarKey} onEditAvatar={()=>{setOwnAvatarFile(null);setDialog("avatar")}} tasks={visibleTasks} active={activeTasks.length} overdue={overdue.length} completed={completed.length} employees={effectiveView?1:activeEmployees.length} goTasks={()=>{setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks")}} evaluationEmployees={effectiveView?[effectiveView]:data.employees} ownEmployeeId={effectiveView?effectiveView.id:null} activeCompanyId={activeCompanyId}/>}
        {page==="tasks"&&<>
        {taskSubTab==="tasks"&&<>
        {tasksSection==="manager"&&<TasksPage employeeView={Boolean(effectiveView)} tasks={visibleTasks} onDelete={task=>void deleteTaskItem(task)} onStatus={(task,status,extra)=>void request("PATCH",{action:"task",id:task.id,status,userMode:Boolean(effectiveView),...(extra||{})})} onEvaluate={(task)=>{setSelectedTask(task);open("evaluate",{evaluation:String(task.evaluation||10),evaluationNote:task.evaluation_note||""})}} dateRequests={data.dateRequests} onRequestDate={(taskId,proposedDueAt,reason)=>void request("POST",{action:"date-request",taskId,proposedDueAt,reason})} onResolveDateRequest={(id,approve,adminNote,finalDueAt)=>void request("PATCH",{action:"resolve-date-request",id,approve,adminNote,finalDueAt})} employees={data.employees} isAdmin={isAdmin}/>}
        {tasksSection==="mine"&&<PersonalWorksPage isAdmin={isAdmin} currentUserId={user.id} viewAsEmployeeId={viewAs?.id??null} companies={companyScopeActive?myCompanies:data.companies} employees={activeEmployees} activeCompanyId={activeCompanyId}/>}</>}
        {taskSubTab!=="tasks"&&<>{isAdmin&&!viewAs&&<div className="fixedsubtabs"><button className={fixedTab==="catalog"?"on":""} onClick={()=>setFixedTab("catalog")}>Sabit işlərin siyahısı</button><button className={fixedTab==="assignments"?"on":""} onClick={()=>setFixedTab("assignments")}>Personal sabit işlər</button></div>}<WorkList employeeView={Boolean(effectiveView)} tab={fixedTab} frequency={taskSubTab} items={data.workItems} assignments={(effectiveView?data.workAssignments.filter(a=>a.employee_id===effectiveView.id):data.workAssignments).filter(a=>!companyScopeActive||!activeCompanyId||a.company_id===activeCompanyId)} completions={data.workCompletions||[]} employees={activeEmployees} companies={data.companies.filter(c=>Boolean(c.active))} form={form} setForm={setForm} onAdd={()=>void request("POST",{action:"work-item",title:form.workTitle,description:form.workDescription,frequency:taskSubTab})} onDue={(item,dueDay)=>void request("PATCH",{action:"work-item",id:item.id,dueDay})} onAssign={()=>void request("POST",{action:"work-assignment",workDefinitionId:Number(form.assignWorkId),companyIds:(form.assignCompanyIds||"").split(",").filter(Boolean).map(Number),employeeId:Number(form.assignEmployeeId)})} onCatalogAssign={(workDefinitionId,companyId,employeeId)=>void request("POST",{action:"work-assignment",workDefinitionId,companyIds:[companyId],employeeId})} onComplete={(assignmentId,periodKey)=>void request("PATCH",{action:"work-completion",assignmentId,periodKey})}/></>}</>}
        {page==="requests"&&<RequestsPage isAdmin={isAdmin} companies={companyScopeActive?myCompanies:data.companies.filter(c=>Boolean(c.active))} activeCompanyId={companyScopeActive?activeCompanyId:null} onActionable={setRequestsPending}/>}
        {page==="chat"&&<ChatPage currentUser={user} onUnread={setChatUnread}/>}
        {page==="employees"&&<EmployeesPage employees={data.employees} companies={data.companies} tasks={data.tasks} onNew={()=>{setEmployeePhoto(null);open("employee")}} onEdit={e=>{setEmployeePhoto(null);open("employee",{id:String(e.id),name:e.name,email:e.email||"",companyIds:e.company_ids||"",companyPositions:companyPositionsForm(e.company_positions),mainCompanyId:e.main_company_id?String(e.main_company_id):""})}} onView={e=>{setViewAs(e);setPage("dashboard")}} onToggle={e=>void request("PATCH",{action:"employee",id:e.id,active:!Boolean(e.active)})} onDelete={e=>void deleteWorker(e)}/>}
        {page==="companies"&&<CompaniesPage companies={data.companies} tasks={data.tasks} onNew={()=>open("company")} onEdit={c=>open("company",{id:String(c.id),name:c.name,voen:c.voen||"",manager:c.manager||""})} onToggle={c=>void request("PATCH",{action:"company",id:c.id,active:!Boolean(c.active)})}/>}
        {page==="customers"&&<CustomersPage isAdmin={isAdmin}/>}
        {page==="audit"&&<AuditPage/>}
        {page==="documents"&&<>
        {documentSubTab==="templates"&&<DocumentsPage isAdmin={isAdmin}/>}
        {documentSubTab==="outgoing"&&<OutgoingDocumentsPage isAdmin={isAdmin}/>}
        {documentSubTab==="incoming"&&<PlaceholderPage title="Daxil Olan Sənədlər" text="Bu bölmə tezliklə hazırlanacaq."/>}</>}
        {page==="hr"&&<ViolationsPage isAdmin={isAdmin} employees={data.employees} companies={data.companies} activeCompanyId={activeCompanyId}/>}
      </>}
    </main>
    <Dialog open={dialog!==null} onOpenChange={v=>!v&&setDialog(null)}><DialogContent className="businessdialog" resizable>
      {dialog==="employee"&&<FormShell title={form.id?"Personal məlumatlarını redaktə et":"Yeni personal"} desc={form.id?"Ad, e-poçt, firmalar və hər firma üzrə vəzifəni yeniləyin.":"Personal, giriş hesabı və işləyəcəyi firmalar birlikdə təyin ediləcək."}><Field label="Ad və soyad" value={form.name||""} set={v=>setForm({...form,name:v})}/><Field label="E-poçt" type="email" value={form.email||""} set={v=>setForm({...form,email:v})}/><label className="field filefield">Şəkil (istəyə bağlı, maks. 5 MB)<Input type="file" accept="image/*" onChange={e=>setEmployeePhoto(e.target.files?.[0]||null)}/>{employeePhoto&&<small>{employeePhoto.name}</small>}</label>{!form.id&&<Field label="Müvəqqəti şifrə (ən az 8 simvol)" type="password" value={form.password||""} set={v=>setForm({...form,password:v})}/>}<label className="field">Əsas iş yeri<select value={form.mainCompanyId||""} onChange={e=>{const id=e.target.value;setForm(f=>{const ids=new Set((f.companyIds||"").split(",").filter(Boolean));if(id)ids.add(id);return {...f,mainCompanyId:id,companyIds:[...ids].join(",")}})}}><option value="">Firma seçin</option>{data.companies.filter(c=>Boolean(c.active)||String(c.id)===form.mainCompanyId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><EmployeeCompanyPicker companies={data.companies.filter(c=>Boolean(c.active))} companyIds={form.companyIds||""} companyPositions={form.companyPositions||"{}"} onChange={(companyIds,companyPositions)=>setForm(f=>({...f,companyIds,companyPositions,mainCompanyId:companyIds.split(",").includes(f.mainCompanyId||"")?f.mainCompanyId:""}))}/><Button disabled={uploadingPhoto||(form.id?(!form.name||!form.email):(!form.name||!form.email||(form.password||"").length<8))} onClick={()=>form.id?void saveEmployeeEdit():void createPersonnel()}>{uploadingPhoto?"Şəkil yüklənir...":form.id?"Dəyişiklikləri saxla":"Personalı və giriş hesabını yarat"}</Button></FormShell>}
      {dialog==="company"&&<FormShell title={form.id?"Firma məlumatlarını redaktə et":"Yeni firma"} desc="Firmanın əsas məlumatlarını daxil edin."><Field label="Firmanın adı" value={form.name||""} set={v=>setForm({...form,name:v})}/><Field label="VÖEN" value={form.voen||""} set={v=>setForm({...form,voen:v})}/><Field label="Rəhbər" value={form.manager||""} set={v=>setForm({...form,manager:v})}/><Button disabled={!form.name} onClick={()=>void request(form.id?"PATCH":"POST",{action:"company",id:form.id?Number(form.id):undefined,name:form.name,voen:form.voen||"",manager:form.manager||""})}>{form.id?"Dəyişiklikləri saxla":"Firmanı əlavə et"}</Button></FormShell>}
      {dialog==="evaluate"&&selectedTask&&<FormShell title="İşi yoxla" desc={`${selectedTask.employee_name} • ${selectedTask.title}`}><label className="field">Qiymət (1–10)<select value={form.evaluation||"10"} onChange={e=>setForm({...form,evaluation:e.target.value})}>{[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n} bal</option>)}</select></label><TextField label="Rəy / qeyd" value={form.evaluationNote||""} set={v=>setForm({...form,evaluationNote:v})}/><div className="inlineactions">{selectedTask.status==="Təqdim edilib"&&<button className="inlinecancel" disabled={!(form.evaluationNote||"").trim()} onClick={()=>void request("PATCH",{action:"task",id:selectedTask.id,status:"Geri qaytarılıb",evaluationNote:form.evaluationNote||""})}>Geri qaytar</button>}<Button onClick={()=>void request("PATCH",{action:"task",id:selectedTask.id,status:"Təsdiqlənib",evaluation:Number(form.evaluation||10),evaluationNote:form.evaluationNote||""})}>Təsdiqlə və qiymətləndir</Button></div></FormShell>}
      {dialog==="password"&&<FormShell title="Şifrəni dəyiş" desc="Cari şifrənizi daxil edin və yeni şifrə təyin edin."><Field label="Cari şifrə" type="password" value={form.currentPassword||""} set={v=>setForm({...form,currentPassword:v})}/><Field label="Yeni şifrə (ən az 8 simvol)" type="password" value={form.newPassword||""} set={v=>setForm({...form,newPassword:v})}/><Button disabled={!form.currentPassword||(form.newPassword||"").length<8} onClick={()=>void changeOwnPassword()}>Yeni şifrəni saxla</Button></FormShell>}
      {dialog==="background"&&<FormShell title="Fon şəkli" desc="Öz hesabınız üçün fon şəkli seçin — yalnız siz görəcəksiniz."><label className="field filefield">Şəkil (maks. 8 MB)<Input type="file" accept="image/*" onChange={e=>setBackgroundFile(e.target.files?.[0]||null)}/>{backgroundFile&&<small>{backgroundFile.name}</small>}</label><Button disabled={!backgroundFile||uploadingBackground} onClick={()=>void saveBackground()}>{uploadingBackground?"Yüklənir...":"Fon şəklini tətbiq et"}</Button>{user.backgroundKey&&<button className="inlinecancel" onClick={()=>void removeBackground()}>Fon şəklini sil</button>}</FormShell>}
      {dialog==="avatar"&&<FormShell title="Profil şəkli" desc="Şəkliniz idarə panelində, personal siyahısında və çatda adınızın yanında görünəcək.">{ownAvatarKey&&<div className="avatarpreview"><img src={`/api/file?key=${encodeURIComponent(ownAvatarKey)}`} alt={user.name}/></div>}<label className="field filefield">Yeni şəkil (maks. 5 MB)<Input type="file" accept="image/*" onChange={e=>setOwnAvatarFile(e.target.files?.[0]||null)}/>{ownAvatarFile&&<small>{ownAvatarFile.name}</small>}</label><Button disabled={!ownAvatarFile||uploadingOwnAvatar} onClick={()=>void saveOwnAvatar()}>{uploadingOwnAvatar?"Yüklənir...":"Şəkli yadda saxla"}</Button>{ownAvatarKey&&<button className="inlinecancel" onClick={()=>void removeOwnAvatar()}>Şəkli sil</button>}</FormShell>}
    </DialogContent></Dialog>
  </div>;
}

function LoginScreen({form,setForm,error,loading,onLogin}:{form:{email:string;password:string};setForm:React.Dispatch<React.SetStateAction<{email:string;password:string}>>;error:string;loading:boolean;onLogin:()=>void}){
  const [showPassword,setShowPassword]=useState(false);
  return <main className="authpage"><form className="authcard" onSubmit={e=>{e.preventDefault();onLogin()}}><div className="authlogo">Dİ</div><h1>Daxili İdarəetmə</h1><p>İş və tapşırıq sisteminə daxil olun</p>{error&&<div className="autherror">{error}</div>}<label>E-poçt<Input type="email" autoComplete="username" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Şifrə<div className="passwordfield"><Input type={showPassword?"text":"password"} autoComplete="current-password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><button type="button" aria-label={showPassword?"Şifrəni gizlət":"Şifrəni göstər"} onClick={()=>setShowPassword(v=>!v)}>{showPassword?<EyeOff/>:<Eye/>}</button></div></label><Button type="submit" disabled={loading||!form.email||!form.password}><KeyRound/>{loading?"Yoxlanılır...":"Daxil ol"}</Button></form></main>
}

function UsersPage(){
  const [users,setUsers]=useState<ManagedUser[]>([]);const [form,setForm]=useState({name:"",position:"",email:"",password:""});const [error,setError]=useState("");const [open,setOpen]=useState(false);
  const load=async()=>{const response=await fetch("/api/users");const body=await response.json();if(response.ok)setUsers(body.users||[])};
  useEffect(()=>{void load()},[]);
  const create=async()=>{setError("");const response=await fetch("/api/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)});const body=await response.json();if(!response.ok){setError(body.error);return}setUsers(body.users);setForm({name:"",position:"",email:"",password:""});setOpen(false)};
  const toggle=async(user:ManagedUser)=>{const response=await fetch("/api/users",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:user.id,active:!Boolean(user.active)})});const body=await response.json();if(response.ok)setUsers(body.users)};
  return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><small className="sectioneyebrow">GİRİŞ VƏ İCAZƏLƏR</small><h2>İstifadəçilər</h2><p>Yeni hesab yaradın və giriş icazələrini idarə edin</p></div><Button onClick={()=>setOpen(true)}><Plus/>Yeni istifadəçi</Button></div>{error&&<div className="errorbox">{error}</div>}<div className="usercards">{users.map(u=><article key={u.id}><i>{initials(u.name)}</i><div><h3>{u.name}</h3><p>{u.email}</p><small>{u.role==="admin"?"Baş administrator":"İstifadəçi"}</small></div><span className={u.active?"recordstatus active":"recordstatus inactive"}>{u.active?"Aktiv":"Deaktiv"}</span>{u.role!=="admin"&&<button className={u.active?"deactivatebtn":"activatebtn"} onClick={()=>void toggle(u)}>{u.active?"Deaktiv et":"Aktiv et"}</button>}</article>)}</div><Dialog open={open} onOpenChange={setOpen}><DialogContent className="businessdialog" resizable><FormShell title="Yeni istifadəçi" desc="İstifadəçi öz e-poçtu və müvəqqəti şifrəsi ilə daxil olacaq."><Field label="Ad və soyad" value={form.name} set={v=>setForm({...form,name:v})}/><Field label="Vəzifə" value={form.position} set={v=>setForm({...form,position:v})}/><Field label="E-poçt" type="email" value={form.email} set={v=>setForm({...form,email:v})}/><Field label="Müvəqqəti şifrə (ən az 8 simvol)" type="password" value={form.password} set={v=>setForm({...form,password:v})}/><Button disabled={!form.name||!form.email||form.password.length<8} onClick={()=>void create()}>Hesabı yarat</Button></FormShell></DialogContent></Dialog></section>
}

function ChatPage({currentUser,onUnread}:{currentUser:AppUser;onUnread:(value:number)=>void}){
  const [chat,setChat]=useState<ChatData|null>(null);
  const [selected,setSelected]=useState(0);
  const [message,setMessage]=useState("");
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [chatError,setChatError]=useState("");
  const [threadQuery,setThreadQuery]=useState("");
  const endRef=useRef<HTMLDivElement|null>(null);
  const loadChat=async(threadId=selected,quiet=false)=>{try{if(!quiet)setChatError("");const response=await fetch(`/api/chat${threadId?`?threadId=${threadId}`:""}`);const body=await response.json();if(!response.ok)throw new Error(body.error);setChat(body);setSelected(body.selectedThreadId);onUnread(Number(body.totalUnread||0));await fetch("/api/chat",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({threadId:body.selectedThreadId})});}catch(e){if(!quiet)setChatError(e instanceof Error?e.message:"Çat açıla bilmədi.")}};
  useEffect(()=>{void loadChat(0)},[]);
  useEffect(()=>{const timer=setInterval(()=>void loadChat(selected,true),5000);return()=>clearInterval(timer)},[selected]);
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth"})},[chat?.messages.length,selected]);
  const choose=async(id:number)=>{setSelected(id);await loadChat(id)};
  const startDirect=async(userId:number)=>{setBusy(true);setChatError("");try{const response=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"direct",userId})});const body=await response.json();if(!response.ok)throw new Error(body.error);setChat(body);setSelected(body.selectedThreadId);onUnread(Number(body.totalUnread||0))}catch(e){setChatError(e instanceof Error?e.message:"Söhbət yaradıla bilmədi.")}finally{setBusy(false)}};
  const send=async()=>{if((!message.trim()&&!file)||busy)return;setBusy(true);setChatError("");try{let attachment:Record<string,unknown>={};if(file){if(file.size>25*1024*1024)throw new Error("Faylın həcmi 25 MB-dan çox ola bilməz.");const form=new FormData();form.append("file",file);const uploaded=await fetch("/api/file",{method:"POST",body:form});const result=await uploaded.json();if(!uploaded.ok)throw new Error(result.error);attachment={attachmentKey:result.key,attachmentName:result.name,attachmentSize:result.size,attachmentType:result.type}}const response=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"send",threadId:selected,message,...attachment})});const body=await response.json();if(!response.ok)throw new Error(body.error);setChat(body);setMessage("");setFile(null);onUnread(Number(body.totalUnread||0))}catch(e){setChatError(e instanceof Error?e.message:"Mesaj göndərilmədi.")}finally{setBusy(false)}};
  const active=chat?.threads.find(t=>t.id===selected);
  const filteredThreads=(chat?.threads||[]).filter(t=>t.name.toLocaleLowerCase("az-AZ").includes(threadQuery.toLocaleLowerCase("az-AZ")));
  type TimelineItem={kind:"date";label:string;key:string}|{kind:"msg";message:ChatMessage;grouped:boolean;showName:boolean;mine:boolean;ticks:"sent"|"read"|null};
  const timeline:TimelineItem[]=[];
  (chat?.messages||[]).forEach((m,i)=>{
    const prev=chat?.messages[i-1];
    const sameDay=Boolean(prev)&&new Date(prev!.created_at).toDateString()===new Date(m.created_at).toDateString();
    if(!sameDay)timeline.push({kind:"date",label:dayLabel(m.created_at),key:`d-${m.id}`});
    const grouped=Boolean(prev&&sameDay&&prev!.sender_user_id===m.sender_user_id&&(new Date(m.created_at).getTime()-new Date(prev!.created_at).getTime())<3*60*1000);
    const mine=m.sender_user_id===currentUser.id;
    const showName=active?.type==="group"&&!mine&&!grouped;
    const ticks:"sent"|"read"|null=mine&&active?.type==="direct"?(m.id<=Number(chat?.readUpTo||0)?"read":"sent"):null;
    timeline.push({kind:"msg",message:m,grouped,showName,mine,ticks});
  });
  return <section className="panel chatpanel">
    <aside className="chatlist"><div className="chatlisthead"><div><span className="sectioneyebrow">DAXİLİ YAZIŞMA</span><h2>Söhbətlər</h2></div><MessageCircle/></div>
      <div className="chatsearch"><input placeholder="Axtarış..." value={threadQuery} onChange={e=>setThreadQuery(e.target.value)}/></div>
      <div className="threadlist">{filteredThreads.map(t=><button key={t.id} className={t.id===selected?"active":""} onClick={()=>void choose(t.id)}><i className={t.type!=="group"&&t.avatar_key?"hasphoto":""}>{t.type==="group"?<Users/>:avatarNode(t.avatar_key,t.name)}</i><span><b>{t.name}</b><small>{t.last_message||"Hələ mesaj yoxdur"}</small></span><span className="threadside">{t.last_message_at&&<time>{threadTime(t.last_message_at)}</time>}{Number(t.unread)>0&&<em>{t.unread}</em>}</span></button>)}</div>
      <div className="newchat"><strong>Yeni şəxsi söhbət</strong>{chat?.users.map(u=><button disabled={busy} key={u.id} onClick={()=>void startDirect(u.id)}><i className={u.avatar_key?"hasphoto":""}>{avatarNode(u.avatar_key,u.name)}</i><span>{u.name}<small>{u.email}</small></span><Plus/></button>)}</div>
    </aside>
    <div className="chatroom"><header className="chatroomhead"><i className={active&&active.type!=="group"&&active.avatar_key?"hasphoto":""}>{active?.type==="group"?<Users/>:active?avatarNode(active.avatar_key,active.name):<MessageCircle/>}</i><div><h2>{active?.name||"Çat yüklənir..."}</h2><p>{active?.type==="group"?"Bütün aktiv istifadəçilər":"Şəxsi yazışma"}</p></div></header>
      {chatError&&<div className="chaterror">{chatError}</div>}
      <div className="messages">{timeline.length?timeline.map(item=>item.kind==="date"?<div className="datedivider" key={item.key}><span>{item.label}</span></div>:<article key={item.message.id} className={`${item.mine?"mine":""}${item.grouped?" grouped":""}`}><div className="messagebubble">{item.showName&&<span className="msgsender"><i className={item.message.sender_avatar_key?"hasphoto":""}>{avatarNode(item.message.sender_avatar_key,item.message.sender_name)}</i><b>{item.message.sender_name}</b></span>}{item.message.body&&<p>{item.message.body}</p>}{item.message.attachment_key&&<a href={`/api/file?key=${encodeURIComponent(item.message.attachment_key)}`}><FileText/><span>{item.message.attachment_name||"Fayl"}<small>{chatFileSize(item.message.attachment_size||0)}</small></span><Download/></a>}<time>{new Intl.DateTimeFormat("az-AZ",{hour:"2-digit",minute:"2-digit"}).format(new Date(item.message.created_at))}{item.ticks&&<span className={`ticks ${item.ticks}`}>{item.ticks==="read"?"✓✓":"✓"}</span>}</time></div></article>):<div className="chatempty"><MessageCircle/><h3>İlk mesajı yazın</h3><p>Bu söhbətdə hələ mesaj yoxdur.</p></div>}<div ref={endRef}/></div>
      <div className="composer">{file&&<div className="selectedfile"><Paperclip/><span>{file.name}<small>{chatFileSize(file.size)}</small></span><button onClick={()=>setFile(null)}><X/></button></div>}<div><label title="Fayl əlavə et"><Paperclip/><input type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/></label><Textarea placeholder="Mesajınızı yazın..." value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send()}}}/><Button title={busy?"Göndərilir...":"Göndər"} disabled={busy||(!message.trim()&&!file)} onClick={()=>void send()}><Send/></Button></div></div>
    </div>
  </section>
}

function chatFileSize(size:number){if(!size)return "";if(size<1024)return `${size} B`;if(size<1024*1024)return `${(size/1024).toFixed(1)} KB`;return `${(size/1024/1024).toFixed(1)} MB`}
function threadTime(iso:string){const d=new Date(iso);const now=new Date();if(d.toDateString()===now.toDateString())return new Intl.DateTimeFormat("az-AZ",{hour:"2-digit",minute:"2-digit"}).format(d);const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);if(d.toDateString()===yesterday.toDateString())return "Dünən";return new Intl.DateTimeFormat("az-AZ",{day:"2-digit",month:"2-digit"}).format(d)}
function dayLabel(iso:string){const d=new Date(iso);const now=new Date();if(d.toDateString()===now.toDateString())return "Bugün";const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);if(d.toDateString()===yesterday.toDateString())return "Dünən";return new Intl.DateTimeFormat("az-AZ",{day:"2-digit",month:"long",year:"numeric"}).format(d)}

function Dashboard({userName,avatarKey,onEditAvatar,tasks,active,overdue,completed,employees,goTasks,evaluationEmployees,ownEmployeeId,activeCompanyId}:{userName:string;avatarKey:string|null;onEditAvatar:()=>void;tasks:Task[];active:number;overdue:number;completed:number;employees:number;goTasks:()=>void;evaluationEmployees:Employee[];ownEmployeeId:number|null;activeCompanyId?:number|null}){return <><section className="welcome"><div><small>{new Intl.DateTimeFormat("az-AZ",{day:"2-digit",month:"long",year:"numeric"}).format(new Date()).toUpperCase()}</small><h2>Salam, {userName}</h2><p>Bu gün komandanızın iş vəziyyətini buradan izləyə bilərsiniz.</p></div><div className="welcomeaside"><button className={avatarKey?"welcomephotobtn":"welcomephotobtn empty"} title={avatarKey?"Profil şəklini dəyiş":"Profil şəkli əlavə et"} onClick={onEditAvatar}>{avatarKey?<img className="welcomephoto" src={`/api/file?key=${encodeURIComponent(avatarKey)}`} alt={userName}/>:<span className="welcomephoto">{initials(userName)}</span>}</button><Bell/></div></section><EvaluationSection employees={evaluationEmployees} tasks={tasks}/><section className="stats"><Stat icon={<ClipboardList/>} tone="blue" label="Aktiv tapşırıq" value={active}/><Stat icon={<CircleAlert/>} tone="red" label="Gecikən" value={overdue}/><Stat icon={<CheckCircle2/>} tone="green" label="Tamamlanan" value={completed}/><Stat icon={<Users/>} tone="gold" label="Aktiv personal" value={employees}/></section>{ownEmployeeId&&<MyViolationsPanel employeeId={ownEmployeeId} activeCompanyId={activeCompanyId}/>}<div className="modulecharts"><TaskStatusChart tasks={tasks} onViewAll={goTasks}/><DocumentsOverviewChart/><ViolationsChart/></div></>}
function TaskStatusChart({tasks,onViewAll}:{tasks:Task[];onViewAll:()=>void}){
  const order:[string,string][]=[["Yeni","#64748b"],["İcradadır","#0C8599"],["Geri qaytarılıb","#7c3aed"],["Təqdim edilib","#f59e0b"],["Təsdiqlənib","#16a34a"],["Gecikib","#dc2626"]];
  const counts=Object.fromEntries(order.map(([label])=>[label,0])) as Record<string,number>;
  tasks.forEach(t=>{const label=displayStatus(t);if(label in counts)counts[label]++});
  const rows=order.filter(([label])=>counts[label]>0);
  const max=Math.max(...rows.map(([label])=>counts[label]),1);
  return <section className="panel modulepanel"><div className="head"><div><h3>Tapşırıqlar</h3><p>Status üzrə paylanma</p></div><button onClick={onViewAll}>Hamısına bax</button></div>
    {rows.length?<div className="trendbars">{rows.map(([label,color])=><div className="trendrow" key={label}><span className="trendname">{label}</span><div className="trendtrack"><span className="trendfill" style={{left:0,width:`${(counts[label]/max)*100}%`,background:color,borderRadius:6}}/></div><span className="trendcount">{counts[label]}</span></div>)}</div>:<Empty text="Hələ tapşırıq yoxdur."/>}
  </section>;
}
function DocumentsOverviewChart(){
  const [counts,setCounts]=useState<{templates:number;outgoing:number}|null>(null);
  useEffect(()=>{let cancelled=false;Promise.all([fetch("/api/documents").then(r=>r.ok?r.json():{items:[]}),fetch("/api/documents/outgoing").then(r=>r.ok?r.json():{items:[]})]).then(([tpl,out])=>{if(!cancelled)setCounts({templates:(tpl.items||[]).length,outgoing:(out.items||[]).length})}).catch(()=>{if(!cancelled)setCounts({templates:0,outgoing:0})});return()=>{cancelled=true}},[]);
  const rows:[string,number,string][]=[["Şablonlar",counts?.templates||0,"#0C8599"],["Çıxan sənədlər",counts?.outgoing||0,"#d97706"]];
  const max=Math.max(...rows.map(r=>r[1]),1);
  return <section className="panel modulepanel"><div className="head"><div><h3>Sənədlər</h3><p>Ümumi say üzrə</p></div></div>
    {!counts?<small className="checklistempty">Yüklənir...</small>:rows.some(r=>r[1]>0)?<div className="trendbars">{rows.map(([label,count,color])=><div className="trendrow" key={label}><span className="trendname">{label}</span><div className="trendtrack"><span className="trendfill" style={{left:0,width:`${(count/max)*100}%`,background:color,borderRadius:6}}/></div><span className="trendcount">{count}</span></div>)}</div>:<Empty text="Hələ sənəd yoxdur."/>}
  </section>;
}
function ViolationsChart(){
  const [items,setItems]=useState<Violation[]|null>(null);
  useEffect(()=>{let cancelled=false;fetch("/api/violations").then(r=>r.ok?r.json():{items:[]}).then(body=>{if(!cancelled)setItems(body.items||[])}).catch(()=>{if(!cancelled)setItems([])});return()=>{cancelled=true}},[]);
  const byEmployee=new Map<string,number>();
  (items||[]).forEach(v=>byEmployee.set(v.employee_name,(byEmployee.get(v.employee_name)||0)+1));
  const rows=[...byEmployee.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
  const max=Math.max(...rows.map(r=>r[1]),1);
  return <section className="panel modulepanel"><div className="head"><div><h3>HR</h3><p>Personal üzrə qeydə alınan noqsanlar</p></div></div>
    {items===null?<small className="checklistempty">Yüklənir...</small>:rows.length?<div className="trendbars">{rows.map(([name,count])=><div className="trendrow" key={name}><span className="trendname">{name}</span><div className="trendtrack"><span className="trendfill" style={{left:0,width:`${(count/max)*100}%`,background:"#dc2626",borderRadius:6}}/></div><span className="trendcount">{count}</span></div>)}</div>:<Empty text="Qeydə alınmış noqsan yoxdur."/>}
  </section>;
}
function MyViolationsPanel({employeeId,activeCompanyId}:{employeeId:number;activeCompanyId?:number|null}){
  const [items,setItems]=useState<Violation[]|null>(null);
  useEffect(()=>{let cancelled=false;void fetch("/api/violations").then(r=>r.ok?r.json():{items:[]}).then(body=>{if(cancelled)return;const own=(body.items||[]).filter((i:Violation)=>i.employee_id===employeeId&&(!activeCompanyId||i.company_id===activeCompanyId));setItems(own)}).catch(()=>{if(!cancelled)setItems([])});return()=>{cancelled=true}},[employeeId,activeCompanyId]);
  if(items===null)return null;
  return <section className="panel">
    <div className="head"><div><h3>Noqsanlarım</h3><p>{items.length?`Ümumi ${items.length} qeyd`:"Qeydə alınmış noqsan yoxdur"}</p></div></div>
    {items.length?<div className="auditlist">{items.slice(0,5).map(item=><article key={item.id}><b>{formatDate(item.created_at)}</b><span>{item.title}</span><span>{item.company_name||"—"}</span><span>{item.note||"—"}</span></article>)}</div>:<Empty text="Hələ qeydə alınmış noqsanınız yoxdur."/>}
  </section>;
}
function TasksPage({employeeView,tasks,onDelete,onStatus,onEvaluate,dateRequests,onRequestDate,onResolveDateRequest,employees,isAdmin}:{employeeView:boolean;tasks:Task[];onDelete:(t:Task)=>void;onStatus:(t:Task,s:string,extra?:Record<string,unknown>)=>void;onEvaluate:(t:Task)=>void;dateRequests:DateRequest[];onRequestDate:(taskId:number,proposedDueAt:string,reason:string)=>void;onResolveDateRequest:(id:number,approve:boolean,adminNote:string,finalDueAt:string)=>void;employees:Employee[];isAdmin:boolean}){
  return <section className="panel pagepanel">
    <div className="pageactions"><div><h2>{employeeView?"Mənim tapşırıqlarım":"Bütün tapşırıqlar"}</h2><p>{tasks.length} tapşırıq göstərilir</p></div></div>
    <TaskGrid tasks={tasks} employeeView={employeeView} onStatus={onStatus} onEvaluate={onEvaluate} onDelete={onDelete} dateRequests={dateRequests} onRequestDate={onRequestDate} onResolveDateRequest={onResolveDateRequest} employees={employees} isAdmin={isAdmin}/>
  </section>
}
function PersonalWorksPage({isAdmin,currentUserId,viewAsEmployeeId,companies,employees,activeCompanyId}:{isAdmin:boolean;currentUserId:number;viewAsEmployeeId?:number|null;companies:Company[];employees:Employee[];activeCompanyId?:number|null}){
  const worksUrl=(extra?:string)=>{const query=[viewAsEmployeeId?`employeeId=${viewAsEmployeeId}`:"",extra||""].filter(Boolean).join("&");return query?`/api/personal-works?${query}`:"/api/personal-works"};
  const [items,setItems]=useState<PersonalWork[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState<Record<string,string>>({title:"",description:"",companyId:"",dueAt:""});
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState<Record<string,string>>({});
  const [detailItem,setDetailItem]=useState<PersonalWork|null>(null);
  const [editingWork,setEditingWork]=useState(false);
  const [editFile,setEditFile]=useState<File|null>(null);
  const [editRemoveAttachment,setEditRemoveAttachment]=useState(false);
  const [checklist,setChecklist]=useState<PersonalWorkChecklistItem[]>([]);
  const [delegateCandidates,setDelegateCandidates]=useState<DelegateCandidate[]>([]);
  const [checklistLoading,setChecklistLoading]=useState(false);
  const [checklistTitle,setChecklistTitle]=useState("");
  const [checklistBusy,setChecklistBusy]=useState(false);
  const [checklistError,setChecklistError]=useState("");
  const [checklistAttachBusy,setChecklistAttachBusy]=useState<number|null>(null);
  const [history,setHistory]=useState<{workId:number;events:WorkHistoryEvent[]}|null>(null);
  // Quiet refresh (no loading flash) so the "Paylaşılıb" column updates right after a step is handed over.
  const reloadItems=async()=>{try{const response=await fetch(worksUrl());const body=await response.json();if(response.ok)setItems(body.items||[])}catch{}};
  const load=async()=>{setLoading(true);setError("");try{const response=await fetch(worksUrl());const body=await response.json();if(!response.ok)throw new Error(body.error);setItems(body.items||[])}catch(e){setError(e instanceof Error?e.message:"Siyahı açıla bilmədi.")}finally{setLoading(false)}};
  useEffect(()=>{void load()},[]);
  const create=async()=>{
    if(!form.title.trim())return;
    setBusy(true);setError("");
    try{
      let attachment:Record<string,unknown>={};
      if(file){
        if(file.size>25*1024*1024)throw new Error("Faylın həcmi 25 MB-dan çox ola bilməz.");
        const upload=new FormData();upload.append("file",file);
        const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});
        const uploadResult=await uploadResponse.json();
        if(!uploadResponse.ok)throw new Error(uploadResult.error||"Fayl yüklənmədi.");
        attachment={attachmentKey:uploadResult.key,attachmentName:uploadResult.name,attachmentSize:uploadResult.size,attachmentType:uploadResult.type};
      }
      const response=await fetch(worksUrl(),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:form.title,description:form.description,companyId:form.companyId||undefined,dueAt:form.dueAt?new Date(form.dueAt).toISOString():undefined,...attachment})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(body.items||[]);setForm({title:"",description:"",companyId:"",dueAt:""});setFile(null);setCreating(false);
    }catch(e){setError(e instanceof Error?e.message:"İş əlavə olunmadı.")}
    finally{setBusy(false)}
  };
  const advance=async(item:PersonalWork)=>{
    const next=item.status==="Yeni"?"İcradadır":"Tamamlanıb";
    setError("");
    try{
      const response=await fetch(worksUrl(),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,status:next})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(body.items||[]);
    }catch(e){setError(e instanceof Error?e.message:"İş yenilənmədi.")}
  };
  const remove=async(item:PersonalWork)=>{
    if(!window.confirm(`"${item.title}" işini silmək istəyirsiniz?`))return;
    setError("");
    try{
      const response=await fetch(worksUrl(`id=${item.id}`),{method:"DELETE"});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(body.items||[]);
    }catch(e){setError(e instanceof Error?e.message:"İş silinmədi.")}
  };
  const statusTone=(s:string)=>s==="Tamamlanıb"?"done":s==="İcradadır"?"inprogress":"";
  const isOwn=(item:PersonalWork)=>item.user_id===currentUserId;
  const openDetail=(item:PersonalWork)=>{setDetailItem(item);setEditingWork(false)};
  const startEditWork=(item:PersonalWork)=>{setForm({id:String(item.id),title:item.title,description:item.description||"",companyId:item.company_id?String(item.company_id):"",dueAt:item.due_at?toDateTimeLocal(item.due_at):""});setEditFile(null);setEditRemoveAttachment(false);setEditingWork(true)};
  const cancelEditWork=()=>{setEditingWork(false);setEditFile(null);setEditRemoveAttachment(false)};
  const saveWorkEdit=async()=>{
    if(!detailItem||!form.title.trim())return;
    setBusy(true);setError("");
    try{
      let attachment:Record<string,unknown>={};
      if(editFile){
        if(editFile.size>25*1024*1024)throw new Error("Faylın həcmi 25 MB-dan çox ola bilməz.");
        const upload=new FormData();upload.append("file",editFile);
        const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});
        const uploadResult=await uploadResponse.json();
        if(!uploadResponse.ok)throw new Error(uploadResult.error||"Fayl yüklənmədi.");
        attachment={attachmentKey:uploadResult.key,attachmentName:uploadResult.name,attachmentSize:uploadResult.size,attachmentType:uploadResult.type};
      }else if(editRemoveAttachment){
        attachment={removeAttachment:true};
      }
      const response=await fetch(worksUrl(),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:Number(form.id),title:form.title,description:form.description,companyId:form.companyId||undefined,dueAt:form.dueAt?new Date(form.dueAt).toISOString():undefined,...attachment})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(body.items||[]);
      const updated=(body.items||[]).find((i:PersonalWork)=>i.id===Number(form.id));
      if(updated)setDetailItem(updated);
      setEditingWork(false);setEditFile(null);setEditRemoveAttachment(false);setForm({title:"",description:"",companyId:"",dueAt:""});
    }catch(e){setError(e instanceof Error?e.message:"İş yenilənmədi.")}
    finally{setBusy(false)}
  };
  const set=(key:string,value:string)=>setSearch(current=>({...current,[key]:value}));
  const has=(value:string,key:string)=>value.toLocaleLowerCase("az-AZ").includes((search[key]||"").toLocaleLowerCase("az-AZ"));
  const personalWorkColumns:Array<{key:string;label:string;width:number;search:(item:PersonalWork)=>string;render:(item:PersonalWork)=>React.ReactNode}>=[
    {key:"status",label:"Status",width:120,search:i=>i.status,render:i=>workLate(i)?<><span className="tablestatus late">Gecikib</span><LateDays due={i.due_at}/></>:<span className={`tablestatus ${statusTone(i.status)}`}>{i.status}</span>},
    {key:"company",label:"Firma",width:140,search:i=>i.company_name||"",render:i=><b>{i.company_name||"—"}</b>},
    {key:"title",label:"İş",width:170,search:i=>i.title,render:i=><button className="taskdetailbtn" onClick={()=>openDetail(i)}>{i.title}</button>},
    {key:"description",label:"Açıqlama",width:220,search:i=>i.description||"—",render:i=><>{i.description||"—"}</>},
    {key:"document",label:"Əlavə olunan sənəd",width:150,search:i=>i.attachment_name||"Sənəd yoxdur",render:i=>i.attachment_key?<a className="filelink" href={`/api/file?key=${encodeURIComponent(i.attachment_key)}`}>{i.attachment_name}<small>{formatFileSize(i.attachment_size||0)}</small></a>:<span className="nodocument">Sənəd yoxdur</span>},
    {key:"created",label:"Yaranma tarixi",width:140,search:i=>formatDate(i.created_at),render:i=><time>{formatDate(i.created_at)}</time>},
    {key:"due",label:"Son tarix",width:150,search:i=>i.due_at?formatDate(i.due_at):"—",render:i=>i.due_at?<time>{formatDate(i.due_at)}</time>:"—"},
    {key:"shared",label:"Paylaşılıb",width:180,search:i=>(i.shared||[]).map(s=>s.name).join(" ")||"—",render:i=>i.shared?.length?<div className="sharedlist">{i.shared.map(s=><span key={s.employee_id} className={s.done>=s.total?"sharedname done":"sharedname"} title={s.done>=s.total?"Tamamlayıb, ✓ qoyulub":"İcra edir"}>{s.name}{s.total>1&&<small> ({s.done}/{s.total})</small>}</span>)}</div>:<span className="nodocument">—</span>},
  ];
  const {order,widths,setWidth,moveColumn}=useTableColumns("personalworks2",personalWorkColumns.map(c=>c.key));
  const resize=useEdgeResize(setWidth,60);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(personalWorkColumns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(personalWorkColumns.map(c=>[c.key,c.width]));
  const scopeCompany=!isAdmin||Boolean(viewAsEmployeeId);
  const filtered=items.filter(item=>(!scopeCompany||!activeCompanyId||item.company_id===activeCompanyId)&&personalWorkColumns.every(c=>has(c.search(item),c.key)));
  const current=detailItem&&items.find(i=>i.id===detailItem.id)||detailItem;
  const currentOwn=Boolean(current&&isOwn(current));
  const unfinishedSteps=checklist.filter(i=>!i.done).length;
  // Every change in the dialog (status, steps, files, hand-overs) replaces `checklist` or `status`, so the history refreshes with it.
  const currentId=current?.id;
  const currentStatus=current?.status;
  useEffect(()=>{if(!currentId)return;let cancelled=false;void fetch(`/api/personal-work-history?personalWorkId=${currentId}`).then(r=>r.ok?r.json():{events:[]}).then(body=>{if(!cancelled)setHistory({workId:currentId,events:body.events||[]})});return()=>{cancelled=true}},[currentId,currentStatus,checklist]);
    useEffect(()=>{if(!current){setChecklist([]);setChecklistError("");return}let cancelled=false;setChecklistLoading(true);void fetch(`/api/personal-work-checklist?personalWorkId=${current.id}`).then(r=>r.ok?r.json():{items:[]}).then(body=>{if(!cancelled){setChecklist(body.items||[]);setDelegateCandidates(body.candidates||[])}}).finally(()=>{if(!cancelled)setChecklistLoading(false)});return()=>{cancelled=true}},[current?.id,current?.company_id]);
  const addChecklistItem=async()=>{
    if(!current||!checklistTitle.trim())return;
    setChecklistBusy(true);setChecklistError("");
    try{
      const response=await fetch("/api/personal-work-checklist",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({personalWorkId:current.id,title:checklistTitle})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);setChecklistTitle("");
    }catch(e){setChecklistError(e instanceof Error?e.message:"Addım əlavə olunmadı.")}
    finally{setChecklistBusy(false)}
  };
  const toggleChecklistDone=async(item:ChecklistLikeItem)=>{
    setChecklistError("");
    try{
      const response=await fetch("/api/personal-work-checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,done:!item.done})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);
      void reloadItems();
    }catch(e){setChecklistError(e instanceof Error?e.message:"Addım yenilənmədi.")}
  };
  const removeChecklistItem=async(item:ChecklistLikeItem)=>{
    try{
      const response=await fetch(`/api/personal-work-checklist?id=${item.id}`,{method:"DELETE"});
      const body=await response.json();
      if(response.ok)setChecklist(body.items||[]);
    }catch{}
  };
  const delegateChecklistItem=async(item:ChecklistLikeItem,employeeId:string,comment:string)=>{
    if(!employeeId)return;
    setChecklistError("");
    try{
      const response=await fetch("/api/personal-work-checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,delegateEmployeeId:employeeId,comment})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);
      void reloadItems();
    }catch(e){setChecklistError(e instanceof Error?e.message:"Həvalə edilmədi.")}
  };
  const attachChecklistFile=async(item:ChecklistLikeItem,file:File)=>{
    if(file.size>25*1024*1024){setChecklistError("Faylın həcmi 25 MB-dan çox ola bilməz.");return}
    setChecklistError("");setChecklistAttachBusy(item.id);
    try{
      const upload=new FormData();upload.append("file",file);
      const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});
      const uploaded=await uploadResponse.json();
      if(!uploadResponse.ok)throw new Error(uploaded.error||"Fayl yüklənmədi.");
      const response=await fetch("/api/personal-work-checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,attachmentKey:uploaded.key,attachmentName:uploaded.name,attachmentSize:uploaded.size,attachmentType:uploaded.type})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);
    }catch(e){setChecklistError(e instanceof Error?e.message:"Fayl əlavə olunmadı.")}
    finally{setChecklistAttachBusy(null)}
  };
  const detachChecklistFile=async(item:ChecklistLikeItem)=>{
    setChecklistError("");
    try{
      const response=await fetch("/api/personal-work-checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,removeAttachment:true})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);
    }catch(e){setChecklistError(e instanceof Error?e.message:"Fayl silinmədi.")}
  };
  return <section className="panel pagepanel">
    <div className="pageactions"><div><h2>İşlərim</h2><p>{viewAsEmployeeId?`${employees.find(e=>e.id===viewAsEmployeeId)?.name||"Personal"} adına ${filtered.length} iş göstərilir`:`${filtered.length} iş göstərilir`}</p></div><Button onClick={()=>{if(!creating&&activeCompanyId)setForm(f=>({...f,companyId:f.companyId||String(activeCompanyId)}));setCreating(v=>!v)}}><Plus/>Yeni iş</Button></div>
    {creating&&<div className="inlinetaskrow personalworkrow"><Field label="İşin adı" value={form.title||""} set={v=>setForm({...form,title:v})}/><SelectCompany companies={companies.filter(c=>Boolean(c.active))} value={form.companyId||""} set={v=>setForm({...form,companyId:v})}/><Field label="Açıqlama (istəyə bağlı)" value={form.description||""} set={v=>setForm({...form,description:v})}/><DateTimeField label="Son tarix (istəyə bağlı)" value={form.dueAt||""} set={v=>setForm({...form,dueAt:v})}/><label className="field filefield">Əlavə fayl (istəyə bağlı, maks. 25 MB)<Input type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/>{file&&<small>{file.name} • {formatFileSize(file.size)}</small>}</label><div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>setCreating(false)}>Ləğv et</button><Button disabled={busy||!form.title.trim()} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable personalworktable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} extraKeys={["actions"]}/><thead><tr>{order.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}><input aria-label={`${col.label} üzrə axtarış`} placeholder="Axtar..." value={search[key]||""} onChange={e=>set(key,e.target.value)}/><span>{col.label}</span></SortableTh>})}<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader hasSearch/></th></tr></thead><tbody>{filtered.map(item=><tr key={item.id}>
      {order.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      <td data-label="Əməliyyat"><button type="button" className="openbtn" onClick={()=>openDetail(item)}>Aç</button></td>
    </tr>)}</tbody></table>{!filtered.length&&<Empty text={items.length?"Axtarışa uyğun iş tapılmadı.":"Hələ öz işinizi əlavə etməmisiniz."}/>}</div>}
    <Dialog open={Boolean(current)} onOpenChange={v=>{if(!v){setDetailItem(null);setEditingWork(false)}}}><DialogContent className="businessdialog" resizable>{current&&<FormShell title={current.title} desc={currentOwn?"Öz işim":current.owner_name} formClass="taskdetailform"><div className="taskdetailleft">{editingWork?<div className="taskdetailinfo edititem"><Field label="İşin adı" value={form.title||""} set={v=>setForm({...form,title:v})}/><SelectCompany companies={companies.filter(c=>Boolean(c.active))} value={form.companyId||""} set={v=>setForm({...form,companyId:v})}/><Field label="Açıqlama (istəyə bağlı)" value={form.description||""} set={v=>setForm({...form,description:v})}/><DateTimeField label="Son tarix (istəyə bağlı)" value={form.dueAt||""} set={v=>setForm({...form,dueAt:v})}/><label className="field filefield">Əlavə fayl (istəyə bağlı, maks. 25 MB){current.attachment_key&&!editFile&&!editRemoveAttachment&&<span className="checklistfile"><a className="checklistfilelink" href={`/api/file?key=${encodeURIComponent(current.attachment_key)}`}>{current.attachment_name}</a><button type="button" className="checklistremove" title="Sənədi sil" onClick={()=>setEditRemoveAttachment(true)}>✕</button></span>}<Input type="file" onChange={e=>{setEditFile(e.target.files?.[0]||null);setEditRemoveAttachment(false)}}/>{editFile&&<small>{editFile.name} • {formatFileSize(editFile.size)}</small>}</label>{error&&<div className="errorbox">{error}</div>}<div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={cancelEditWork}>Ləğv et</button><Button disabled={busy||!form.title.trim()} onClick={()=>void saveWorkEdit()}>{busy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div>:<div className="taskdetailinfo"><p><b>Açıqlama</b><span>{current.description||"—"}</span></p><p><b>Firma</b><span>{current.company_name||"—"}</span></p><p><b>Yaranma tarixi</b><span>{formatDate(current.created_at)}</span></p><p><b>Son tarix</b><span>{current.due_at?formatDate(current.due_at):"—"}</span></p>{current.attachment_key&&<p><b>Əlavə olunan sənəd</b><span><a className="filelink" href={`/api/file?key=${encodeURIComponent(current.attachment_key)}`}>{current.attachment_name}<small>{formatFileSize(current.attachment_size||0)}</small></a></span></p>}</div>}<div className="field"><span>Status</span>{workLate(current)?<><strong className="detailstatus late">Gecikib</strong><LateDays due={current.due_at}/></>:<strong className={`detailstatus ${statusTone(current.status)}`}>{current.status}</strong>}{!editingWork&&currentOwn&&current.status!=="Tamamlanıb"&&<Button disabled={current.status==="İcradadır"&&(checklistLoading||unfinishedSteps>0)} onClick={()=>void advance(current)}>{current.status==="Yeni"?"İcraya al":"Tamamla"}</Button>}{currentOwn&&current.status==="İcradadır"&&!checklistLoading&&unfinishedSteps>0&&<small className="completehint">Tamamlamaq üçün iş axınındakı bütün addımlarda ✓ olmalıdır ({unfinishedSteps} addım qalıb).</small>}</div>{!editingWork&&currentOwn&&current.status!=="Tamamlanıb"&&<button type="button" className="editcompanybtn" onClick={()=>startEditWork(current)}>Redaktə et</button>}{!editingWork&&currentOwn&&current.status==="Yeni"&&<button className="deletetaskbtn detaildelete" onClick={()=>{setDetailItem(null);void remove(current)}}>İşi sil</button>}</div><div className="taskdetailright"><ChecklistSection employeeView={currentOwn} checklist={checklist} loading={checklistLoading} title={checklistTitle} setTitle={setChecklistTitle} busy={checklistBusy} error={checklistError} onAdd={()=>void addChecklistItem()} onToggle={item=>void toggleChecklistDone(item)} onRemove={item=>void removeChecklistItem(item)} locked={current.status==="Tamamlanıb"} stepsActionable={current.status==="İcradadır"} canDelegate={currentOwn} delegateEmployees={delegateCandidates} onDelegate={(item,employeeId,comment)=>void delegateChecklistItem(item,employeeId,comment)} onAttach={(item,file)=>void attachChecklistFile(item,file)} onDetach={item=>void detachChecklistFile(item)} attachBusyId={checklistAttachBusy}/><WorkHistory events={history?.workId===current.id?history.events:null}/></div></FormShell>}</DialogContent></Dialog>
  </section>;
}
function TaskGrid({tasks,employeeView,onStatus,onEvaluate,onDelete,dateRequests,onRequestDate,onResolveDateRequest,employees,isAdmin}:{tasks:Task[];employeeView:boolean;onStatus:(t:Task,s:string,extra?:Record<string,unknown>)=>void;onEvaluate:(t:Task)=>void;onDelete:(t:Task)=>void;dateRequests:DateRequest[];onRequestDate:(taskId:number,proposedDueAt:string,reason:string)=>void;onResolveDateRequest:(id:number,approve:boolean,adminNote:string,finalDueAt:string)=>void;employees:Employee[];isAdmin:boolean}){
  const [search,setSearch]=useState<Record<string,string>>({});
  const [dateOpen,setDateOpen]=useState(false);
  const [dateForm,setDateForm]=useState({proposedDueAt:"",reason:""});
  const [resolveNote,setResolveNote]=useState("");
  const [resolveDate,setResolveDate]=useState("");
  const [detailTask,setDetailTask]=useState<Task|null>(null);
  const [submitFile,setSubmitFile]=useState<File|null>(null);
  const [submitBusy,setSubmitBusy]=useState(false);
  const [submitError,setSubmitError]=useState("");
  const [checklist,setChecklist]=useState<ChecklistItem[]>([]);
  const [delegateCandidates,setDelegateCandidates]=useState<DelegateCandidate[]>([]);
  const [checklistLoading,setChecklistLoading]=useState(false);
  const [checklistTitle,setChecklistTitle]=useState("");
  const [checklistBusy,setChecklistBusy]=useState(false);
  const [checklistError,setChecklistError]=useState("");
  const [checklistAttachBusy,setChecklistAttachBusy]=useState<number|null>(null);
  const set=(key:string,value:string)=>setSearch(current=>({...current,[key]:value}));
  const has=(value:string,key:string)=>value.toLocaleLowerCase("az-AZ").includes((search[key]||"").toLocaleLowerCase("az-AZ"));
  const hasPendingRequest=(t:Task)=>dateRequests.some(r=>r.task_id===t.id&&r.status==="Gözləyir");
  const rowStatusLabel=(t:Task)=>hasPendingRequest(t)?"Dəyişiklik tələb olunur":displayStatus(t);
  const rowStatusClass=(t:Task)=>hasPendingRequest(t)?"changerequested":statusClass(t);
  const openDetail=(t:Task)=>{setSubmitFile(null);setSubmitError("");setDateOpen(false);setDateForm({proposedDueAt:"",reason:""});setResolveNote("");setResolveDate("");setDetailTask(t)};
  const taskColumns:Array<{key:string;label:string;width:number;search:(t:Task)=>string;render:(t:Task)=>React.ReactNode}>=[
    {key:"status",label:"Status",width:120,search:t=>rowStatusLabel(t),render:t=><><button className={`tablestatus statusopen ${rowStatusClass(t)}`} onClick={()=>openDetail(t)}>{rowStatusLabel(t)}</button>{statusClass(t)==="late"&&<LateDays due={t.due_at}/>}</>},
    {key:"company",label:"Firma",width:140,search:t=>t.company_name||"",render:t=><b>{t.company_name||"—"}</b>},
    {key:"employee",label:"Personal",width:150,search:t=>t.employee_name,render:t=><>{t.employee_name}</>},
    {key:"assignedBy",label:"Tapşırığı verən",width:170,search:t=>t.assigned_by||"",render:t=><>{t.assigned_by||"—"}</>},
    {key:"position",label:"Vəzifəsi",width:140,search:t=>t.employee_position,render:t=><>{t.employee_position}</>},
    {key:"title",label:"Tapşırıq",width:170,search:t=>t.title,render:t=><button className="taskdetailbtn" onClick={()=>openDetail(t)}>{t.title}</button>},
    {key:"description",label:"Tapşırığın açıqlaması",width:220,search:t=>t.description||"",render:t=><>{t.description||"—"}</>},
    {key:"document",label:"Əlavə olunan sənəd",width:150,search:t=>t.attachment_name||"Sənəd yoxdur",render:t=>t.attachment_key?<a className="filelink" href={`/api/file?key=${encodeURIComponent(t.attachment_key)}`}>{t.attachment_name}<small>{formatFileSize(t.attachment_size||0)}</small></a>:<span className="nodocument">Sənəd yoxdur</span>},
    {key:"created",label:"Yaranma tarixi",width:140,search:t=>formatDate(t.created_at),render:t=><time>{formatDate(t.created_at)}</time>},
    {key:"due",label:"Tapşırığın son tarixi",width:150,search:t=>formatDate(t.due_at),render:t=><time>{formatDate(t.due_at)}</time>},
    {key:"evaluation",label:"Qiymətləndirmə",width:160,search:t=>t.evaluation?`${t.evaluation} bal`:displayStatus(t),render:t=><div className="tableactions"><RatingCell evaluation={t.evaluation} note={t.evaluation_note} compact twoRows/>{!employeeView&&t.status==="Təqdim edilib"?<button className="evaluatebtn" onClick={()=>onEvaluate(t)}>Qiymətləndir</button>:!t.evaluation&&!t.evaluation_note&&<span>—</span>}{!employeeView&&t.status==="Yeni"&&<button className="deletetaskbtn" onClick={()=>onDelete(t)}>Sil</button>}</div>},
  ];
  const {order,widths,setWidth,moveColumn}=useTableColumns("tasks2",taskColumns.map(c=>c.key));
  const resize=useEdgeResize(setWidth,60);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(taskColumns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(taskColumns.map(c=>[c.key,c.width]));
  const filtered=tasks.filter(t=>taskColumns.every(c=>has(c.search(t),c.key)));
  const current=detailTask&&tasks.find(t=>t.id===detailTask.id)||detailTask;
  useEffect(()=>{if(!current){setChecklist([]);setChecklistError("");return}let cancelled=false;setChecklistLoading(true);void fetch(`/api/checklist?taskId=${current.id}`).then(r=>r.ok?r.json():{items:[]}).then(body=>{if(!cancelled){setChecklist(body.items||[]);setDelegateCandidates(body.candidates||[])}}).finally(()=>{if(!cancelled)setChecklistLoading(false)});return()=>{cancelled=true}},[current?.id]);
  const nextStatus=current?.status==="Yeni"?"İcradadır":(current?.status==="İcradadır"||current?.status==="Geri qaytarılıb")?"Təqdim edilib":null;
  const needsSubmissionFile=Boolean(current&&current.attachment_key&&!current.submission_attachment_key);
  const pendingRequest=current?dateRequests.find(r=>r.task_id===current.id&&r.status==="Gözləyir"):undefined;
  const taskRequest=current?dateRequests.find(r=>r.task_id===current.id):undefined;
  const submitDateRequest=()=>{if(!current||!dateForm.proposedDueAt)return;onRequestDate(current.id,new Date(dateForm.proposedDueAt).toISOString(),dateForm.reason);setDateOpen(false);setDateForm({proposedDueAt:"",reason:""})};
  const resolveDateRequest=(approve:boolean)=>{if(!pendingRequest)return;const finalDueAt=approve?new Date(resolveDate||toDateTimeLocal(pendingRequest.proposed_due_at)).toISOString():pendingRequest.proposed_due_at;onResolveDateRequest(pendingRequest.id,approve,resolveNote,finalDueAt);setResolveNote("");setResolveDate("")};
  const submitTask=async()=>{
    if(!current)return;
    setSubmitError("");
    if(needsSubmissionFile&&!submitFile){setSubmitError("Doldurulmuş faylı yükləyin.");return}
    setSubmitBusy(true);
    try{
      let extra:Record<string,unknown>={};
      let uploaded:{key:string;name:string;size:number;type:string}|null=null;
      if(submitFile){
        if(submitFile.size>25*1024*1024)throw new Error("Faylın həcmi 25 MB-dan çox ola bilməz.");
        const upload=new FormData();upload.append("file",submitFile);
        const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});
        const uploadResult=await uploadResponse.json();
        if(!uploadResponse.ok)throw new Error(uploadResult.error||"Fayl yüklənmədi.");
        uploaded=uploadResult;
        extra={submissionAttachmentKey:uploadResult.key,submissionAttachmentName:uploadResult.name,submissionAttachmentSize:uploadResult.size,submissionAttachmentType:uploadResult.type};
      }
      onStatus(current,"Təqdim edilib",extra);
      setDetailTask({...current,status:"Təqdim edilib",employee_status_changed:Number(current.employee_status_changed)+1,...(uploaded?{submission_attachment_key:uploaded.key,submission_attachment_name:uploaded.name,submission_attachment_size:uploaded.size,submission_attachment_type:uploaded.type}:{})});
      setSubmitFile(null);
    }catch(e){setSubmitError(e instanceof Error?e.message:"Fayl yüklənmədi.")}
    finally{setSubmitBusy(false)}
  };
  const addChecklistItem=async()=>{
    if(!current||!checklistTitle.trim())return;
    setChecklistBusy(true);setChecklistError("");
    try{
      const response=await fetch("/api/checklist",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({taskId:current.id,title:checklistTitle})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);setChecklistTitle("");
    }catch(e){setChecklistError(e instanceof Error?e.message:"Addım əlavə olunmadı.")}
    finally{setChecklistBusy(false)}
  };
  const toggleChecklistDone=async(item:ChecklistLikeItem)=>{
    try{
      const response=await fetch("/api/checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,done:!item.done})});
      const body=await response.json();
      if(response.ok)setChecklist(body.items||[]);
    }catch{}
  };
  const removeChecklistItem=async(item:ChecklistLikeItem)=>{
    try{
      const response=await fetch(`/api/checklist?id=${item.id}`,{method:"DELETE"});
      const body=await response.json();
      if(response.ok)setChecklist(body.items||[]);
    }catch{}
  };
  const attachChecklistFile=async(item:ChecklistLikeItem,file:File)=>{
    if(file.size>25*1024*1024){setChecklistError("Faylın həcmi 25 MB-dan çox ola bilməz.");return}
    setChecklistError("");setChecklistAttachBusy(item.id);
    try{
      const upload=new FormData();upload.append("file",file);
      const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});
      const uploaded=await uploadResponse.json();
      if(!uploadResponse.ok)throw new Error(uploaded.error||"Fayl yüklənmədi.");
      const response=await fetch("/api/checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,attachmentKey:uploaded.key,attachmentName:uploaded.name,attachmentSize:uploaded.size,attachmentType:uploaded.type})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);
    }catch(e){setChecklistError(e instanceof Error?e.message:"Fayl əlavə olunmadı.")}
    finally{setChecklistAttachBusy(null)}
  };
  const detachChecklistFile=async(item:ChecklistLikeItem)=>{
    setChecklistError("");
    try{
      const response=await fetch("/api/checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,removeAttachment:true})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);
    }catch(e){setChecklistError(e instanceof Error?e.message:"Fayl silinmədi.")}
  };
  const delegateChecklistItem=async(item:ChecklistLikeItem,employeeId:string,comment:string)=>{
    if(!employeeId)return;
    setChecklistError("");
    try{
      const response=await fetch("/api/checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,action:"delegate",employeeId,comment})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);
    }catch(e){setChecklistError(e instanceof Error?e.message:"Ötürülmədi.")}
  };
  // The task's owner hands steps to their subordinates (per the company structure); the admin can do it on the owner's behalf.
  const canDelegateTask=isAdmin||employeeView;
    return <><div className="tasktablewrap"><table className="tasktable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} extraKeys={["actions"]}/><thead><tr>{order.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}><input aria-label={`${col.label} üzrə axtarış`} placeholder="Axtar..." value={search[key]||""} onChange={e=>set(key,e.target.value)}/><span>{col.label}</span></SortableTh>})}<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader hasSearch/></th></tr></thead><tbody>{filtered.map(t=><tr key={t.id}>
      {order.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(t)}</td>})}
      <td data-label="Əməliyyat"><button type="button" className="openbtn" onClick={()=>openDetail(t)}>Aç</button></td>
    </tr>)}</tbody></table>{!filtered.length&&<Empty text={tasks.length?"Axtarışa uyğun tapşırıq tapılmadı.":"Hələ tapşırıq yaradılmayıb."}/>}</div>
    <Dialog open={Boolean(current)} onOpenChange={v=>!v&&setDetailTask(null)}><DialogContent className="businessdialog" resizable>{current&&<FormShell title={current.title} desc={`${current.employee_name} • ${current.company_name||"Firma qeyd edilməyib"}`} formClass="taskdetailform"><div className="taskdetailleft"><div className="taskdetailinfo"><p><b>Tapşırıq</b><span>{current.description||"—"}</span></p><p><b>Yaranma tarixi</b><span>{formatDate(current.created_at)}</span></p><p><b>Son icra tarixi</b><span>{formatDate(current.due_at)}{current.original_due_at&&current.original_due_at!==current.due_at&&<small className="daterequestnote"> (ilkin tarix: {formatDate(current.original_due_at)})</small>}</span></p>{current.attachment_key&&<p><b>Tapşırıqla göndərilən fayl</b><span><a className="filelink" href={`/api/file?key=${encodeURIComponent(current.attachment_key)}`}>{current.attachment_name}<small>{formatFileSize(current.attachment_size||0)}</small></a></span></p>}{current.submission_attachment_key&&<p><b>İşlənib təqdim olunan fayl</b><span><a className="filelink" href={`/api/file?key=${encodeURIComponent(current.submission_attachment_key)}`}>{current.submission_attachment_name}<small>{formatFileSize(current.submission_attachment_size||0)}</small></a></span></p>}</div>{employeeView?<div className="field"><span>Status</span><strong className={`detailstatus ${pendingRequest?"changerequested":statusClass(current)}`}>{pendingRequest?"Dəyişiklik tələb olunur":displayStatus(current)}</strong><RatingCell evaluation={current.evaluation} note={current.evaluation_note} twoRows/>{nextStatus&&Number(current.employee_status_changed)<2&&<>{nextStatus==="Təqdim edilib"&&<label className="field filefield">İşlənmiş fayl{needsSubmissionFile?" (mütləqdir)":" (istəyə bağlı)"}<Input type="file" onChange={e=>setSubmitFile(e.target.files?.[0]||null)}/>{submitFile&&<small>{submitFile.name} • {formatFileSize(submitFile.size)}</small>}</label>}{submitError&&<div className="errorbox">{submitError}</div>}<Button disabled={submitBusy} onClick={()=>nextStatus==="İcradadır"?(onStatus(current,nextStatus),setDetailTask({...current,status:nextStatus,employee_status_changed:Number(current.employee_status_changed)+1})):void submitTask()}>{submitBusy?"Göndərilir...":nextStatus==="İcradadır"?"İcraya al":"Təqdim et"}</Button></>}</div>:<div className="field"><span>Status</span><strong className={`detailstatus ${pendingRequest?"changerequested":statusClass(current)}`}>{pendingRequest?"Dəyişiklik tələb olunur":displayStatus(current)}</strong><RatingCell evaluation={current.evaluation} note={current.evaluation_note} twoRows/></div>}<DateRequestSection employeeView={employeeView} current={current} pendingRequest={pendingRequest} taskRequest={taskRequest} dateOpen={dateOpen} setDateOpen={setDateOpen} dateForm={dateForm} setDateForm={setDateForm} onSubmit={submitDateRequest} resolveNote={resolveNote} setResolveNote={setResolveNote} resolveDate={resolveDate} setResolveDate={setResolveDate} onResolve={resolveDateRequest}/>{!employeeView&&current.status==="Təqdim edilib"&&<Button onClick={()=>onEvaluate(current)}>Qiymətləndir</Button>}{!employeeView&&current.status==="Yeni"&&<button className="deletetaskbtn detaildelete" onClick={()=>{setDetailTask(null);onDelete(current)}}>Tapşırığı sil</button>}</div><div className="taskdetailright"><ChecklistSection employeeView={employeeView} checklist={checklist} loading={checklistLoading} title={checklistTitle} setTitle={setChecklistTitle} busy={checklistBusy} error={checklistError} onAdd={()=>void addChecklistItem()} onToggle={item=>void toggleChecklistDone(item)} onRemove={item=>void removeChecklistItem(item)} locked={current.status==="Təqdim edilib"||current.status==="Təsdiqlənib"} canDelegate={canDelegateTask} delegateEmployees={delegateCandidates} onDelegate={(item,employeeId,comment)=>void delegateChecklistItem(item,employeeId,comment)} onAttach={(item,file)=>void attachChecklistFile(item,file)} onDetach={item=>void detachChecklistFile(item)} attachBusyId={checklistAttachBusy}/></div></FormShell>}</DialogContent></Dialog>
  </>
}
function EmployeesPage({employees,companies,tasks,onNew,onEdit,onView,onDelete}:{employees:Employee[];companies:Company[];tasks:Task[];onNew:()=>void;onEdit:(e:Employee)=>void;onView:(e:Employee)=>void;onToggle:(e:Employee)=>void;onDelete:(e:Employee)=>void}){
  const [accounts,setAccounts]=useState<ManagedUser[]>([]);const [reset,setReset]=useState<ManagedUser|null>(null);const [password,setPassword]=useState("");const [error,setError]=useState("");
  const loadAccounts=async()=>{const response=await fetch("/api/users");const body=await response.json();if(response.ok)setAccounts(body.users||[])};
  useEffect(()=>{void loadAccounts()},[]);
  const toggle=async(account:ManagedUser)=>{const response=await fetch("/api/users",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:account.id,active:!Boolean(account.active)})});const body=await response.json();if(response.ok){setAccounts(body.users);location.reload()}else setError(body.error)};
  const savePassword=async()=>{if(!reset)return;const response=await fetch("/api/users",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:reset.id,password})});const body=await response.json();if(!response.ok){setError(body.error);return}setAccounts(body.users);setReset(null);setPassword("")};
  return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><span className="sectioneyebrow">PERSONAL VƏ GİRİŞ HESABLARI</span><h2>Personal reyestri</h2><p>Personal məlumatları və proqrama giriş icazələri vahid bölmədə idarə olunur</p></div><Button onClick={onNew}><Plus/>Yeni personal</Button></div>{error&&<div className="errorbox">{error}</div>}<div className="employeecards officialcards">{employees.length?employees.map(e=>{const own=tasks.filter(t=>t.employee_id===e.id);const done=own.filter(t=>t.status==="Təsdiqlənib");const activeCount=own.filter(t=>t.status!=="Təsdiqlənib").length;const rated=done.filter(t=>t.evaluation);const avg=rated.length?(rated.reduce((s,t)=>s+(t.evaluation||0),0)/rated.length).toFixed(1):"—";const account=accounts.find(a=>a.employee_id===e.id);const active=account?Boolean(account.active):Boolean(e.active);return <article key={e.id} className={!active?"inactivecard":""}><div className="identityblock"><i className={e.avatar_key?"hasphoto":""}>{e.avatar_key?<img src={`/api/file?key=${encodeURIComponent(e.avatar_key)}`} alt={e.name}/>:initials(e.name)}</i><div><div className="identitytitle"><h3>{e.name}</h3><span className={active?"recordstatus active":"recordstatus inactive"}>{active?"Aktiv":"Deaktiv"}</span></div>{(()=>{const main=e.main_company_id?companies.find(c=>c.id===e.main_company_id):null;const title=e.main_company_id?parseCompanyPositions(e.company_positions).find(p=>p.company_id===e.main_company_id)?.position_title:null;return <><p><b>Əsas iş yeri:</b> {main?.name||"Seçilməyib"}</p><p><b>Vəzifə:</b> {title||"Seçilməyib"}</p></>})()}<p><b>E-poçt və giriş adı:</b> {e.email||"Qeyd edilməyib"}</p><p><b>Giriş hesabı:</b> {account?"Yaradılıb":"Yaradılmayıb"}</p></div></div><div className="recordmetrics"><span><small>Ümumi tapşırıq</small><b>{own.length}</b></span><span><small>İcrada</small><b>{activeCount}</b></span><span><small>Tamamlanıb</small><b>{done.length}</b></span><span><small>Orta qiymət</small><b>{avg}</b></span></div><div className="employeeactions recordactions"><button className="editcompanybtn" onClick={()=>onEdit(e)}>Redaktə et</button>{active&&<button className="viewasbtn" onClick={()=>onView(e)}>Personal görünüşü</button>}{account&&<button className="editcompanybtn" onClick={()=>{setReset(account);setPassword("")}}>Şifrəni yenilə</button>}{account&&<button className={active?"deactivatebtn":"activatebtn"} onClick={()=>{if(!active||window.confirm(`${e.name} adlı personalı deaktiv etmək istəyirsiniz?`))void toggle(account)}}>{active?"Deaktiv et":"Aktiv et"}</button>}{!active&&own.length===0&&<button className="deleteworkerbtn" onClick={()=>onDelete(e)}>Sil</button>}</div></article>}):<Empty text="İlk personalı əlavə edin."/>}</div><Dialog open={Boolean(reset)} onOpenChange={v=>!v&&setReset(null)}><DialogContent className="businessdialog" resizable>{reset&&<FormShell title="Personalın şifrəsini yenilə" desc={`${reset.name} üçün yeni müvəqqəti şifrə təyin edin.`}><Field label="Yeni şifrə (ən az 8 simvol)" type="password" value={password} set={setPassword}/><Button disabled={password.length<8} onClick={()=>void savePassword()}>Şifrəni yenilə</Button></FormShell>}</DialogContent></Dialog></section>
}
function CompaniesPage({companies,tasks,onNew,onEdit,onToggle}:{companies:Company[];tasks:Task[];onNew:()=>void;onEdit:(c:Company)=>void;onToggle:(c:Company)=>void}){
  const [structureCompany,setStructureCompany]=useState<Company|null>(null);
  return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><span className="sectioneyebrow">TƏŞKİLATİ MƏLUMATLAR</span><h2>Firmalar reyestri</h2><p>Tapşırıqların aid olduğu hüquqi şəxslər və əsas rekvizitlər</p></div><Button onClick={onNew}><Plus/>Yeni firma</Button></div><div className="companylist officialcards">{companies.length?companies.map(c=>{const own=tasks.filter(t=>t.company_id===c.id);const activeCount=own.filter(t=>t.status!=="Təsdiqlənib").length;const completed=own.filter(t=>t.status==="Təsdiqlənib").length;return <article key={c.id} className={!c.active?"inactivecard":""}><div className="identityblock companyidentity"><i><Building2/></i><div><div className="identitytitle"><h3>{c.name}</h3><span className={c.active?"recordstatus active":"recordstatus inactive"}>{c.active?"Aktiv":"Deaktiv"}</span></div><p><b>VÖEN:</b> {c.voen||"Qeyd edilməyib"}</p><p><b>Rəhbər:</b> {c.manager||"Qeyd edilməyib"}</p></div></div><div className="recordmetrics companymetrics"><span><small>Ümumi tapşırıq</small><b>{own.length}</b></span><span><small>Aktiv iş</small><b>{activeCount}</b></span><span><small>Tamamlanıb</small><b>{completed}</b></span></div><div className="companyactions recordactions"><button className="editcompanybtn" onClick={()=>onEdit(c)}>Məlumatları redaktə et</button><button className="editcompanybtn" onClick={()=>setStructureCompany(c)}>Struktur</button><button className={c.active?"deactivatebtn":"activatebtn"} onClick={()=>onToggle(c)}>{c.active?"Deaktiv et":"Aktiv et"}</button></div></article>}):<Empty text="İlk firmanı əlavə edin."/>}</div>
  <CompanyStructureDialog company={structureCompany} onClose={()=>setStructureCompany(null)}/>
  </section>}
function EmployeeCompanyPicker({companies,companyIds,companyPositions,onChange}:{companies:Company[];companyIds:string;companyPositions:string;onChange:(companyIds:string,companyPositions:string)=>void}){
  const selected=new Set(companyIds.split(",").filter(Boolean));
  const positions:Record<string,number>=(()=>{try{return JSON.parse(companyPositions||"{}")}catch{return {}}})();
  const [structures,setStructures]=useState<Record<string,StructurePosition[]|"loading"|"error">>({});
  const loadStructure=(id:string)=>{if(structures[id])return;setStructures(s=>({...s,[id]:"loading"}));fetch(`/api/company-structure?companyId=${id}`).then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error);setStructures(s=>({...s,[id]:body.items||[]}))}).catch(()=>setStructures(s=>({...s,[id]:"error"})))};
  useEffect(()=>{selected.forEach(loadStructure)},[companyIds]);// eslint-disable-line react-hooks/exhaustive-deps
  const toggle=(id:string,checked:boolean)=>{const next=new Set(selected);const nextPositions={...positions};if(checked)next.add(id);else{next.delete(id);delete nextPositions[id]}onChange([...next].join(","),JSON.stringify(nextPositions))};
  const setPosition=(id:string,value:string)=>{const nextPositions={...positions};if(value)nextPositions[id]=Number(value);else delete nextPositions[id];onChange(companyIds,JSON.stringify(nextPositions))};
  return <div className="fixedcompanies employeecompanies"><b>Bu personal hansı firmalar üzrə tapşırıq ala bilər və həmin firmada vəzifəsi</b><div>{companies.map(c=>{const id=String(c.id);const checked=selected.has(id);const structure=structures[id];const departments=Array.isArray(structure)?[...new Set(structure.map(p=>p.department))]:[];return <div key={c.id} className={checked?"companypick on":"companypick"}><label><input type="checkbox" checked={checked} onChange={e=>toggle(id,e.target.checked)}/><span>✓</span>{c.name}</label>{checked&&(structure==="loading"||!structure?<small>Struktur yüklənir...</small>:structure==="error"?<small className="pickerror">Struktur açıla bilmədi.</small>:!structure.length?<small>Bu firmanın strukturu qurulmayıb — "Firmalar → Struktur" bölməsindən vəzifələri əlavə edin.</small>:<select aria-label={`${c.name} üzrə vəzifə`} value={positions[id]?String(positions[id]):""} onChange={e=>setPosition(id,e.target.value)}><option value="">Vəzifə seçin</option>{departments.map(d=><optgroup key={d} label={d}>{structure.filter(p=>p.department===d).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</optgroup>)}</select>)}</div>})}</div>{!companies.length&&<small>Əvvəlcə "Firmalar" bölməsindən ən azı bir firma əlavə edin.</small>}</div>
}

function ReportsToPicker({candidates,value,onChange}:{candidates:StructurePosition[];value:string;onChange:(next:string)=>void}){
  const [open,setOpen]=useState(false);
  const parts=value.split("/").map(s=>s.trim()).filter(Boolean);
  return <div className="reportstopickerwrap">
    <button type="button" className="reportstopickertrigger" onClick={()=>setOpen(v=>!v)}>{parts.length?parts.join(", "):"Ən yuxarı (heç kimə)"}</button>
    {open&&<div className="reportstopickerpanel"><select multiple autoFocus size={Math.max(candidates.length,1)} value={parts} onChange={e=>onChange(Array.from(e.target.selectedOptions).map(o=>o.value).join("/"))} onBlur={()=>setOpen(false)}>{candidates.map(i=><option key={i.id} value={i.title}>{i.title}</option>)}</select></div>}
  </div>;
}
function CompanyStructureDialog({company,onClose}:{company:Company|null;onClose:()=>void}){
  const [items,setItems]=useState<StructurePosition[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [editingId,setEditingId]=useState<number|null>(null);
  const [editForm,setEditForm]=useState<Record<string,string>>({});
  const [editBusy,setEditBusy]=useState(false);
  const [search,setSearch]=useState({department:"",title:"",reportsTo:""});
  const setQuery=(key:"department"|"title"|"reportsTo",value:string)=>setSearch(current=>({...current,[key]:value}));
  const has=(value:string,query:string)=>value.toLocaleLowerCase("az-AZ").includes(query.toLocaleLowerCase("az-AZ"));
  const load=async()=>{if(!company)return;setLoading(true);setError("");try{const response=await fetch(`/api/company-structure?companyId=${company.id}`);const body=await response.json();if(!response.ok)throw new Error(body.error);setItems(body.items||[])}catch(e){setError(e instanceof Error?e.message:"Struktur açıla bilmədi.")}finally{setLoading(false)}};
  useEffect(()=>{if(company){setCreating(false);setForm({});setEditingId(null);void load()}else setItems([])},[company?.id]);
  const departments=Array.from(new Set(items.map(i=>i.department)));
  const requiredFilled=(values:Record<string,string>)=>Boolean((values.department||"").trim()&&(values.title||"").trim());
  const isDuplicateTitle=(title:string,excludeId?:number)=>items.some(i=>i.id!==excludeId&&i.title.trim().toLocaleLowerCase("az-AZ")===title.trim().toLocaleLowerCase("az-AZ"));
  const fields=(values:Record<string,string>,set:(next:Record<string,string>)=>void)=>{
    const candidates=items.filter(i=>String(i.id)!==values.editId);
    return <>
      <label className="field" key="department">Şöbə<Input list="structuredepartments" value={values.department||""} onChange={e=>set({...values,department:e.target.value})}/></label>
      <label className="field" key="title">Vəzifə<Input value={values.title||""} onChange={e=>set({...values,title:e.target.value})}/></label>
      <label className="field" key="reportsTo">Tabe olduğu<ReportsToPicker candidates={candidates} value={values.reportsTo||""} onChange={next=>set({...values,reportsTo:next})}/></label>
    </>;
  };
  const create=async()=>{
    if(!company||!requiredFilled(form))return;
    if(isDuplicateTitle(form.title)){setError("Bu vəzifə artıq siyahıdadır — hər vəzifə yalnız bir dəfə əlavə oluna bilər.");return}
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/company-structure",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({companyId:company.id,department:form.department,title:form.title,reportsTo:form.reportsTo||null})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(body.items||[]);setForm({department:form.department});setCreating(false);
    }catch(e){setError(e instanceof Error?e.message:"Vəzifə əlavə olunmadı.")}
    finally{setBusy(false)}
  };
  const startEdit=(item:StructurePosition)=>{setEditingId(item.id);setEditForm({department:item.department,title:item.title,reportsTo:item.reports_to||"",editId:String(item.id)})};
  const cancelEdit=()=>{setEditingId(null);setEditForm({})};
  const saveEdit=async(id:number)=>{
    if(!requiredFilled(editForm))return;
    if(isDuplicateTitle(editForm.title,id)){setError("Bu vəzifə artıq siyahıdadır — hər vəzifə yalnız bir dəfə əlavə oluna bilər.");return}
    setEditBusy(true);setError("");
    try{
      const response=await fetch("/api/company-structure",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,department:editForm.department,title:editForm.title,reportsTo:editForm.reportsTo||null})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(body.items||[]);setEditingId(null);setEditForm({});
    }catch(e){setError(e instanceof Error?e.message:"Vəzifə yenilənmədi.")}
    finally{setEditBusy(false)}
  };
  const remove=async(item:StructurePosition)=>{
    if(!window.confirm(`"${item.title}" vəzifəsini silmək istəyirsiniz?`))return;
    setError("");
    try{
      const response=await fetch(`/api/company-structure?id=${item.id}`,{method:"DELETE"});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(body.items||[]);
    }catch(e){setError(e instanceof Error?e.message:"Vəzifə silinmədi.")}
  };
  const filtered=items.filter(item=>has(item.department,search.department)&&has(item.title,search.title)&&has(item.reports_to||"",search.reportsTo));
  // Group rows by şöbə (in first-seen order) so the Şöbə column can render as one merged cell per group — and grows automatically as new vəzifə join that şöbə.
  const departmentOrder:string[]=[];
  for(const item of items)if(!departmentOrder.includes(item.department))departmentOrder.push(item.department);
  const grouped=filtered.slice().sort((a,b)=>{const da=departmentOrder.indexOf(a.department),db=departmentOrder.indexOf(b.department);return da!==db?da-db:a.sort_order-b.sort_order});
  const editingDepartment=editingId?items.find(i=>i.id===editingId)?.department:null;
  const deptCounts=new Map<string,number>();
  for(const item of grouped)deptCounts.set(item.department,(deptCounts.get(item.department)||0)+1);
  const seenDept=new Set<string>();
  const deptPalette=["#E3FAFD","#e8f8ee","#fff3d7","#f5f3ff","#feecec","#eef2ff","#fde8f0","#e6f4ea","#fdf2e9"];
  const deptColor=(department:string)=>deptPalette[departmentOrder.indexOf(department)%deptPalette.length];
  return <Dialog open={Boolean(company)} onOpenChange={v=>!v&&onClose()}><DialogContent className="businessdialog structuredialog" resizable>{company&&<FormShell title={`${company.name} — Təşkilati struktur`} desc="Şöbələr, vəzifələr və tabeçilik münasibətləri." formClass="structureform">
    <datalist id="structuredepartments">{departments.map(d=><option key={d} value={d}/>)}</datalist>
    <div className="pageactions directoryhead"><div>{filtered.length} vəzifə göstərilir</div><Button onClick={()=>setCreating(v=>!v)}><Plus/>Əlavə et</Button></div>
    {creating&&<div className="inlinetaskrow documentrow customerrow">{fields(form,setForm)}<div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>{setCreating(false);setForm({})}}>Ləğv et</button><Button disabled={busy||!requiredFilled(form)} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable structuretable"><thead><tr>
      <th><input aria-label="Şöbə üzrə axtarış" placeholder="Axtar..." value={search.department} onChange={e=>setQuery("department",e.target.value)}/><span>Şöbə</span></th>
      <th><input aria-label="Vəzifə üzrə axtarış" placeholder="Axtar..." value={search.title} onChange={e=>setQuery("title",e.target.value)}/><span>Vəzifə</span></th>
      <th><input aria-label="Tabe olduğu üzrə axtarış" placeholder="Axtar..." value={search.reportsTo} onChange={e=>setQuery("reportsTo",e.target.value)}/><span>Tabe olduğu</span></th>
      <th className="opencolumn"><ActionsHeader hasSearch/></th>
    </tr></thead><tbody>{grouped.map(item=>{
      const firstOfGroup=!seenDept.has(item.department);
      if(firstOfGroup)seenDept.add(item.department);
      const unmerged=item.department===editingDepartment;
      const rowSpan=deptCounts.get(item.department)||1;
      if(editingId===item.id)return <tr key={item.id}>
        {!unmerged&&firstOfGroup&&<td rowSpan={rowSpan} className="structuredeptcell" style={{background:deptColor(item.department)}}>{item.department}</td>}
        <td colSpan={unmerged?4:3}><div className="inlinetaskrow documentrow customerrow documenteditrow">{fields(editForm,setEditForm)}<div className="inlineactions"><button className="inlinecancel" disabled={editBusy} onClick={cancelEdit}>Ləğv et</button><Button disabled={editBusy||!requiredFilled(editForm)} onClick={()=>void saveEdit(item.id)}>{editBusy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div></td>
      </tr>;
      const rowTint=deptColor(item.department);
      return <tr key={item.id}>
        {unmerged?<td className="structuredeptcell" style={{background:rowTint}}>{item.department}</td>:firstOfGroup&&<td rowSpan={rowSpan} className="structuredeptcell" style={{background:rowTint}}>{item.department}</td>}
        <td data-label="Vəzifə" style={{background:rowTint}}>{item.title}</td>
        <td data-label="Tabe olduğu" style={{background:rowTint}}>{item.reports_to?<div className="structurereportslist">{item.reports_to.split("/").map(s=>s.trim()).filter(Boolean).map(part=><span key={part}>{part}</span>)}</div>:"Ən yuxarı vəzifə"}</td>
        <td data-label="Əməliyyat" style={{background:rowTint}}><div className="tableactions"><button className="editcompanybtn" onClick={()=>startEdit(item)}>Redaktə et</button><button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button></div></td>
      </tr>;
    })}</tbody></table>{!filtered.length&&<Empty text={items.length?"Axtarışa uyğun vəzifə tapılmadı.":"Bu firma üçün hələ struktur qurulmayıb."}/>}</div>}
  </FormShell>}</DialogContent></Dialog>;
}
const customerColumns:Array<{key:string;label:string;width:number;search:(item:Customer)=>string;render:(item:Customer)=>React.ReactNode}>=[
  {key:"status",label:"Statusu",width:130,search:i=>i.entity_type||"",render:i=><>{i.entity_type||"—"}</>},
  {key:"voen",label:"VÖEN/FİN",width:100,search:i=>i.voen||"",render:i=><>{i.voen||"—"}</>},
  {key:"name",label:"Müştərinin adı",width:200,search:i=>i.name||"",render:i=><b>{i.name}</b>},
  {key:"address",label:"Hüquqi ünvan",width:340,search:i=>i.legal_address||"",render:i=><>{i.legal_address||"—"}</>},
  {key:"manager",label:"Rəhbər",width:160,search:i=>i.manager||"",render:i=><>{i.manager||"—"}</>},
];
// Open to every user (the companies are all in one group): everyone can view and add customers; editing and deleting stay admin-only.
function CustomersPage({isAdmin}:{isAdmin:boolean}){
  const {order,widths,setWidth,moveColumn}=useTableColumns("customers2",customerColumns.map(c=>c.key));
  const resize=useEdgeResize(setWidth,60);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(customerColumns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(customerColumns.map(c=>[c.key,c.width]));
  const [items,setItems]=useState<Customer[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [editingId,setEditingId]=useState<number|null>(null);
  const [editForm,setEditForm]=useState<Record<string,string>>({});
  const [editBusy,setEditBusy]=useState(false);
  const [search,setSearch]=useState<Record<string,string>>({});
  const setQuery=(key:string,value:string)=>setSearch(current=>({...current,[key]:value}));
  const has=(value:string,key:string)=>value.toLocaleLowerCase("az-AZ").includes((search[key]||"").toLocaleLowerCase("az-AZ"));
  const load=async()=>{setLoading(true);setError("");try{const response=await fetch("/api/customers");const body=await response.json();if(!response.ok)throw new Error(body.error);setItems(body.items||[])}catch(e){setError(e instanceof Error?e.message:"Siyahı açıla bilmədi.")}finally{setLoading(false)}};
  useEffect(()=>{void load()},[]);
  const requiredFilled=(values:Record<string,string>)=>Boolean((values.entityType||"").trim()&&(values.voen||"").trim()&&(values.name||"").trim()&&(values.legalAddress||"").trim()&&(values.manager||"").trim());
  const create=async()=>{
    if(!requiredFilled(form))return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/customers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setForm({});setCreating(false);
    }catch(e){setError(e instanceof Error?e.message:"Müştəri əlavə olunmadı.")}
    finally{setBusy(false)}
  };
  const startEdit=(item:Customer)=>{setEditingId(item.id);setEditForm({entityType:item.entity_type||"",voen:item.voen||"",name:item.name||"",legalAddress:item.legal_address||"",manager:item.manager||""})};
  const cancelEdit=()=>{setEditingId(null);setEditForm({})};
  const saveEdit=async(id:number)=>{
    if(!requiredFilled(editForm))return;
    setEditBusy(true);setError("");
    try{
      const response=await fetch("/api/customers",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({...editForm,id})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setEditingId(null);setEditForm({});
    }catch(e){setError(e instanceof Error?e.message:"Müştəri yenilənmədi.")}
    finally{setEditBusy(false)}
  };
  const remove=async(item:Customer)=>{
    if(!window.confirm(`"${item.name}" müştərisini silmək istəyirsiniz?`))return;
    setError("");
    try{
      const response=await fetch(`/api/customers?id=${item.id}`,{method:"DELETE"});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);
    }catch(e){setError(e instanceof Error?e.message:"Müştəri silinmədi.")}
  };
  const entityTypeOptions=["Hüquqi şəxs","Fərdi sahibkar","Fiziki şəxs"];
  const voenRule=(entityType:string):{length:number;charPattern:RegExp;hint:string}|null=>{
    if(entityType==="Hüquqi şəxs"||entityType==="Fərdi sahibkar")return {length:10,charPattern:/[0-9]/,hint:"10 rəqəm"};
    if(entityType==="Fiziki şəxs")return {length:7,charPattern:/[A-Za-z0-9]/,hint:"7 simvol (hərf və rəqəm)"};
    return null;
  };
  const sanitizeVoen=(value:string,entityType:string)=>{
    const rule=voenRule(entityType);
    if(!rule)return value;
    return value.split("").filter(ch=>rule.charPattern.test(ch)).join("").slice(0,rule.length);
  };
  const fieldRenderers:Record<string,(values:Record<string,string>,set:(next:Record<string,string>)=>void)=>React.ReactNode>={
    status:(values,set)=><label className="field statusfield" key="status">Statusu<select value={values.entityType||""} onChange={e=>set({...values,entityType:e.target.value,voen:sanitizeVoen(values.voen||"",e.target.value)})}><option value="">Seçin</option>{entityTypeOptions.map(o=><option key={o} value={o}>{o}</option>)}</select></label>,
    voen:(values,set)=>{const rule=voenRule(values.entityType||"");return <label className="field voenfield" key="voen">VÖEN/FİN{rule&&<small className="voenhint">{rule.hint}</small>}<Input value={values.voen||""} maxLength={rule?.length} onChange={e=>set({...values,voen:sanitizeVoen(e.target.value,values.entityType||"")})}/></label>},
    name:(values,set)=><label className="field" key="name">Müştərinin adı<Input value={values.name||""} onChange={e=>set({...values,name:e.target.value})}/></label>,
    address:(values,set)=><label className="field addressfield" key="address">Hüquqi ünvan<Input value={values.legalAddress||""} onChange={e=>set({...values,legalAddress:e.target.value})} onBlur={e=>set({...values,legalAddress:properCase(e.target.value)})}/></label>,
    manager:(values,set)=><label className="field" key="manager">Rəhbər<Input value={values.manager||""} onChange={e=>set({...values,manager:e.target.value})} onBlur={e=>set({...values,manager:properCase(e.target.value)})}/></label>,
  };
  const fields=(values:Record<string,string>,set:(next:Record<string,string>)=>void)=><>{order.map(key=>fieldRenderers[key](values,set))}</>;
  const filtered=items.filter(item=>customerColumns.every(c=>has(c.search(item),c.key)));
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>Müştəri siyahısı</h2><p>{filtered.length} müştəri göstərilir</p></div><Button onClick={()=>setCreating(v=>!v)}><Plus/>Yeni müştəri</Button></div>
    {creating&&<div className="inlinetaskrow documentrow customerrow">{fields(form,setForm)}<div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>{setCreating(false);setForm({})}}>Ləğv et</button><Button disabled={busy||!requiredFilled(form)} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable documenttable customertable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} extraKeys={["actions"]}/><thead><tr>{order.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}><input aria-label={`${col.label} üzrə axtarış`} placeholder="Axtar..." value={search[key]||""} onChange={e=>setQuery(key,e.target.value)}/><span>{col.label}</span></SortableTh>})}<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader hasSearch/></th></tr></thead><tbody>{filtered.map(item=>editingId===item.id?<tr key={item.id}><td colSpan={order.length+1}><div className="inlinetaskrow documentrow customerrow documenteditrow">{fields(editForm,setEditForm)}<div className="inlineactions"><button className="inlinecancel" disabled={editBusy} onClick={cancelEdit}>Ləğv et</button><Button disabled={editBusy||!requiredFilled(editForm)} onClick={()=>void saveEdit(item.id)}>{editBusy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div></td></tr>:<tr key={item.id}>
      {order.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      <td data-label="Əməliyyat">{isAdmin&&<div className="tableactions"><button className="editcompanybtn" onClick={()=>startEdit(item)}>Redaktə et</button><button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button></div>}</td>
    </tr>)}</tbody></table>{!filtered.length&&<Empty text={items.length?"Axtarışa uyğun müştəri tapılmadı.":"Hələ müştəri əlavə edilməyib."}/>}</div>}
  </section>;
}
function AuditPage(){
  const [items,setItems]=useState<AuditItem[]>([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  useEffect(()=>{void(async()=>{try{const response=await fetch("/api/audit");const body=await response.json();if(!response.ok)throw new Error(body.error);setItems(body.items||[])}catch(e){setError(e instanceof Error?e.message:"Tarixçə yüklənmədi.")}finally{setLoading(false)}})()},[]);
  return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><span className="sectioneyebrow">ADMİN ƏMƏLİYYATLARI</span><h2>Tarixçə</h2><p>Son admin əməliyyatları xronoloji ardıcıllıqla</p></div></div>{error&&<div className="errorbox">{error}</div>}{loading?<div className="loading">Tarixçə yüklənir...</div>:<div className="auditlist">{items.length?items.map(item=><article key={item.id}><b>{formatDate(item.created_at)}</b><span>{item.actor_name}</span><span>{item.action}</span><span>{item.target_label||"—"}</span></article>):<Empty text="Hələ qeyd yoxdur."/>}</div>}</section>
}
const violationColumns:Array<{key:string;label:string;width:number;search:(item:Violation)=>string;render:(item:Violation)=>React.ReactNode}>=[
  {key:"date",label:"Tarix",width:130,search:i=>formatDate(i.created_at),render:i=><time>{formatDate(i.created_at)}</time>},
  {key:"employee",label:"İşçi",width:170,search:i=>i.employee_name||"",render:i=><b>{i.employee_name}</b>},
  {key:"company",label:"Firma",width:190,search:i=>i.company_name||"",render:i=><>{i.company_name||"—"}</>},
  {key:"title",label:"Noqsanın başlığı",width:220,search:i=>i.title||"",render:i=><>{i.title}</>},
  {key:"note",label:"Qeyd",width:220,search:i=>i.note||"",render:i=><>{i.note||"—"}</>},
  {key:"author",label:"Qeyd edən",width:160,search:i=>i.created_by_name||"",render:i=><>{i.created_by_name||"—"}</>},
];
function ViolationsPage({isAdmin,employees,companies,activeCompanyId}:{isAdmin:boolean;employees:Employee[];companies:Company[];activeCompanyId?:number|null}){
  const {order,widths,setWidth,moveColumn}=useTableColumns("violations2",violationColumns.map(c=>c.key));
  const resize=useEdgeResize(setWidth,60);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(violationColumns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(violationColumns.map(c=>[c.key,c.width]));
  const [items,setItems]=useState<Violation[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState<Record<string,string>>({});
  const setQuery=(key:string,value:string)=>setSearch(current=>({...current,[key]:value}));
  const has=(value:string,key:string)=>value.toLocaleLowerCase("az-AZ").includes((search[key]||"").toLocaleLowerCase("az-AZ"));
  const load=async()=>{setLoading(true);setError("");try{const response=await fetch("/api/violations");const body=await response.json();if(!response.ok)throw new Error(body.error);setItems(body.items||[])}catch(e){setError(e instanceof Error?e.message:"Qeydlər yüklənmədi.")}finally{setLoading(false)}};
  useEffect(()=>{void load()},[]);
  const create=async()=>{
    if(!form.employeeId||!(form.title||"").trim())return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/violations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employeeId:Number(form.employeeId),companyId:form.companyId?Number(form.companyId):undefined,title:form.title,note:form.note})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setForm({});setCreating(false);
    }catch(e){setError(e instanceof Error?e.message:"Qeyd saxlanmadı.")}
    finally{setBusy(false)}
  };
  const remove=async(item:Violation)=>{
    if(!window.confirm(`"${item.title}" qeydini silmək istəyirsiniz?`))return;
    setError("");
    try{
      const response=await fetch(`/api/violations?id=${item.id}`,{method:"DELETE"});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);
    }catch(e){setError(e instanceof Error?e.message:"Qeyd silinmədi.")}
  };
  const counts=Object.values(items.reduce((acc,item)=>{
    const existing=acc[item.employee_id];
    if(existing){existing.count+=1;if(item.created_at>existing.last)existing.last=item.created_at}
    else acc[item.employee_id]={employeeId:item.employee_id,name:item.employee_name,count:1,last:item.created_at};
    return acc;
  },{} as Record<number,{employeeId:number;name:string;count:number;last:string}>)).sort((a,b)=>b.count-a.count);
  const filtered=items.filter(item=>(isAdmin||!activeCompanyId||item.company_id===activeCompanyId)&&violationColumns.every(c=>has(c.search(item),c.key)));
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">PERSONAL NƏZARƏTİ</span><h2>Noqsanlar</h2><p>{isAdmin?`${filtered.length} qeyd göstərilir`:"Sizin adınıza qeydə alınmış noqsanlar"}</p></div>{isAdmin&&<Button onClick={()=>setCreating(v=>!v)}><Plus/>Yeni qeyd</Button>}</div>
    {creating&&<div className="inlinetaskrow documentrow customerrow">
      <label className="field">İşçi<select value={form.employeeId||""} onChange={e=>setForm({...form,employeeId:e.target.value})}><option value="">Seçin</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label className="field">Firma (istəyə bağlı)<select value={form.companyId||""} onChange={e=>setForm({...form,companyId:e.target.value})}><option value="">Seçin</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="field">Noqsanın başlığı<Input value={form.title||""} onChange={e=>setForm({...form,title:e.target.value})}/></label>
      <label className="field">Qeyd (istəyə bağlı)<Input value={form.note||""} onChange={e=>setForm({...form,note:e.target.value})}/></label>
      <div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>{setCreating(false);setForm({})}}>Ləğv et</button><Button disabled={busy||!form.employeeId||!(form.title||"").trim()} onClick={()=>void create()}>{busy?"Saxlanılır...":"Əlavə et"}</Button></div>
    </div>}
    {error&&<div className="errorbox">{error}</div>}
    {isAdmin&&!loading&&<div className="employeecards officialcards">{counts.length?counts.map(c=><article key={c.employeeId}><div className="identityblock"><i>{initials(c.name)}</i><div><div className="identitytitle"><h3>{c.name}</h3></div><p><b>Son qeyd:</b> {formatDate(c.last)}</p></div></div><div className="recordmetrics"><span><small>Noqsan sayı</small><b>{c.count}</b></span></div></article>):<Empty text="Hələ heç bir noqsan qeydə alınmayıb."/>}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable documenttable customertable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} extraKeys={isAdmin?["actions"]:[]}/><thead><tr>{order.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}><input aria-label={`${col.label} üzrə axtarış`} placeholder="Axtar..." value={search[key]||""} onChange={e=>setQuery(key,e.target.value)}/><span>{col.label}</span></SortableTh>})}{isAdmin&&<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader hasSearch/></th>}</tr></thead><tbody>{filtered.map(item=><tr key={item.id}>
      {order.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      {isAdmin&&<td data-label="Əməliyyat"><div className="tableactions"><button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button></div></td>}
    </tr>)}</tbody></table>{!filtered.length&&<Empty text={items.length?"Axtarışa uyğun qeyd tapılmadı.":"Hələ qeyd yoxdur."}/>}</div>}
  </section>;
}
function DocumentsPage({isAdmin}:{isAdmin:boolean}){
  const [items,setItems]=useState<DocumentTemplate[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [creating,setCreating]=useState(false);
  const [name,setName]=useState("");
  const [file1,setFile1]=useState<File|null>(null);
  const [file2,setFile2]=useState<File|null>(null);
  const [file3,setFile3]=useState<File|null>(null);
  const [draftFolderPath,setDraftFolderPath]=useState("");
  const [finalFolderPath,setFinalFolderPath]=useState("");
  const [busy,setBusy]=useState(false);
  const [editingId,setEditingId]=useState<number|null>(null);
  const [editName,setEditName]=useState("");
  const [editFile1,setEditFile1]=useState<File|null>(null);
  const [editFile2,setEditFile2]=useState<File|null>(null);
  const [editFile3,setEditFile3]=useState<File|null>(null);
  const [editDraftFolderPath,setEditDraftFolderPath]=useState("");
  const [editFinalFolderPath,setEditFinalFolderPath]=useState("");
  const [editBusy,setEditBusy]=useState(false);
  const load=async()=>{setLoading(true);setError("");try{const response=await fetch("/api/documents");const body=await response.json();if(!response.ok)throw new Error(body.error);setItems(body.items||[])}catch(e){setError(e instanceof Error?e.message:"Siyahı açıla bilmədi.")}finally{setLoading(false)}};
  useEffect(()=>{void load()},[]);
  const uploadFile=async(file:File)=>{
    if(file.size>25*1024*1024)throw new Error("Faylın həcmi 25 MB-dan çox ola bilməz.");
    const upload=new FormData();upload.append("file",file);
    const response=await fetch("/api/file",{method:"POST",body:upload});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||"Fayl yüklənmədi.");
    return result as {key:string;name:string;size:number;type:string};
  };
  const create=async()=>{
    if(!name.trim())return;
    setBusy(true);setError("");
    try{
      const body:Record<string,unknown>={name,draftFolderPath,finalFolderPath};
      if(file1){const uploaded=await uploadFile(file1);body.template1Key=uploaded.key;body.template1Name=uploaded.name;body.template1Size=uploaded.size;body.template1Type=uploaded.type}
      if(file2){const uploaded=await uploadFile(file2);body.template2Key=uploaded.key;body.template2Name=uploaded.name;body.template2Size=uploaded.size;body.template2Type=uploaded.type}
      if(file3){const uploaded=await uploadFile(file3);body.template3Key=uploaded.key;body.template3Name=uploaded.name;body.template3Size=uploaded.size;body.template3Type=uploaded.type}
      const response=await fetch("/api/documents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setName("");setFile1(null);setFile2(null);setFile3(null);setDraftFolderPath("");setFinalFolderPath("");setCreating(false);
    }catch(e){setError(e instanceof Error?e.message:"Sənəd əlavə olunmadı.")}
    finally{setBusy(false)}
  };
  const startEdit=(item:DocumentTemplate)=>{setEditingId(item.id);setEditName(item.name);setEditFile1(null);setEditFile2(null);setEditFile3(null);setEditDraftFolderPath(item.draft_folder_path||"");setEditFinalFolderPath(item.final_folder_path||"")};
  const cancelEdit=()=>{setEditingId(null);setEditFile1(null);setEditFile2(null);setEditFile3(null)};
  const saveEdit=async(item:DocumentTemplate)=>{
    setEditBusy(true);setError("");
    try{
      const body:Record<string,unknown>={id:item.id,name:editName,draftFolderPath:editDraftFolderPath,finalFolderPath:editFinalFolderPath};
      if(editFile1){const uploaded=await uploadFile(editFile1);body.template1Key=uploaded.key;body.template1Name=uploaded.name;body.template1Size=uploaded.size;body.template1Type=uploaded.type}
      if(editFile2){const uploaded=await uploadFile(editFile2);body.template2Key=uploaded.key;body.template2Name=uploaded.name;body.template2Size=uploaded.size;body.template2Type=uploaded.type}
      if(editFile3){const uploaded=await uploadFile(editFile3);body.template3Key=uploaded.key;body.template3Name=uploaded.name;body.template3Size=uploaded.size;body.template3Type=uploaded.type}
      const response=await fetch("/api/documents",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setEditingId(null);setEditFile1(null);setEditFile2(null);setEditFile3(null);
    }catch(e){setError(e instanceof Error?e.message:"Sənəd yenilənmədi.")}
    finally{setEditBusy(false)}
  };
  const remove=async(item:DocumentTemplate)=>{
    if(!window.confirm(`"${item.name}" sənədini silmək istəyirsiniz?`))return;
    setError("");
    try{
      const response=await fetch(`/api/documents?id=${item.id}`,{method:"DELETE"});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);
    }catch(e){setError(e instanceof Error?e.message:"Sənəd silinmədi.")}
  };
  const templateLink=(key:string|null,name:string|null,size:number|null)=>key?<a className="filelink" href={`/api/file?key=${encodeURIComponent(key)}`}>{name}<small>{formatFileSize(size||0)}</small></a>:<span className="nodocument">Yoxdur</span>;
  const templateLabel=(n:number)=><span className="templatelabel">Sənədin şablonu<br/>{n}</span>;
  const documentColumns:Array<{key:string;label:string;width:number;headerContent:React.ReactNode;render:(item:DocumentTemplate)=>React.ReactNode}>=[
    {key:"name",label:"Sənədin adı",width:240,headerContent:<span>Sənədin adı</span>,render:item=><b>{item.name}</b>},
    {key:"template1",label:"Sənədin şablonu 1",width:220,headerContent:templateLabel(1),render:item=>templateLink(item.template1_key,item.template1_name,item.template1_size)},
    {key:"template2",label:"Sənədin şablonu 2",width:220,headerContent:templateLabel(2),render:item=>templateLink(item.template2_key,item.template2_name,item.template2_size)},
    {key:"template3",label:"Sənədin şablonu 3",width:220,headerContent:templateLabel(3),render:item=>templateLink(item.template3_key,item.template3_name,item.template3_size)},
    {key:"draftFolder",label:"İlkin sənəd papkası",width:220,headerContent:<span>İlkin sənəd papkası</span>,render:item=>item.draft_folder_path?<span className="folderpath" title={item.draft_folder_path}>{item.draft_folder_path}</span>:<span className="nodocument">Qeyd edilməyib</span>},
    {key:"finalFolder",label:"Hazır sənəd papkası",width:220,headerContent:<span>Hazır sənəd papkası</span>,render:item=>item.final_folder_path?<span className="folderpath" title={item.final_folder_path}>{item.final_folder_path}</span>:<span className="nodocument">Qeyd edilməyib</span>},
  ];
  const {order,widths,setWidth,moveColumn}=useTableColumns("templates2",documentColumns.map(c=>c.key));
  const resize=useEdgeResize(setWidth,60);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(documentColumns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(documentColumns.map(c=>[c.key,c.width]));
  const createFieldRenderers:Record<string,()=>React.ReactNode>={
    name:()=><Field key="name" label="Sənədin adı" value={name} set={setName}/>,
    template1:()=><label className="field filefield" key="template1">{templateLabel(1)}<Input type="file" onChange={e=>setFile1(e.target.files?.[0]||null)}/>{file1&&<small>{file1.name} • {formatFileSize(file1.size)}</small>}</label>,
    template2:()=><label className="field filefield" key="template2">{templateLabel(2)}<Input type="file" onChange={e=>setFile2(e.target.files?.[0]||null)}/>{file2&&<small>{file2.name} • {formatFileSize(file2.size)}</small>}</label>,
    template3:()=><label className="field filefield" key="template3">{templateLabel(3)}<Input type="file" onChange={e=>setFile3(e.target.files?.[0]||null)}/>{file3&&<small>{file3.name} • {formatFileSize(file3.size)}</small>}</label>,
    draftFolder:()=><Field key="draftFolder" label="İlkin sənəd papkası" value={draftFolderPath} set={setDraftFolderPath}/>,
    finalFolder:()=><Field key="finalFolder" label="Hazır sənəd papkası" value={finalFolderPath} set={setFinalFolderPath}/>,
  };
  const editFieldRenderers=(item:DocumentTemplate):Record<string,()=>React.ReactNode>=>({
    name:()=><Field key="name" label="Sənədin adı" value={editName} set={setEditName}/>,
    template1:()=><label className="field filefield" key="template1">{templateLabel(1)} (əvəz etmək üçün seçin){item.template1_name&&<small>Hazırkı: {item.template1_name}</small>}<Input type="file" onChange={e=>setEditFile1(e.target.files?.[0]||null)}/>{editFile1&&<small>{editFile1.name} • {formatFileSize(editFile1.size)}</small>}</label>,
    template2:()=><label className="field filefield" key="template2">{templateLabel(2)} (əvəz etmək üçün seçin){item.template2_name&&<small>Hazırkı: {item.template2_name}</small>}<Input type="file" onChange={e=>setEditFile2(e.target.files?.[0]||null)}/>{editFile2&&<small>{editFile2.name} • {formatFileSize(editFile2.size)}</small>}</label>,
    template3:()=><label className="field filefield" key="template3">{templateLabel(3)} (əvəz etmək üçün seçin){item.template3_name&&<small>Hazırkı: {item.template3_name}</small>}<Input type="file" onChange={e=>setEditFile3(e.target.files?.[0]||null)}/>{editFile3&&<small>{editFile3.name} • {formatFileSize(editFile3.size)}</small>}</label>,
    draftFolder:()=><Field key="draftFolder" label="İlkin sənəd papkası" value={editDraftFolderPath} set={setEditDraftFolderPath}/>,
    finalFolder:()=><Field key="finalFolder" label="Hazır sənəd papkası" value={editFinalFolderPath} set={setEditFinalFolderPath}/>,
  });
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>Sənədlər</h2><p>Sənəd adları və şablonları (3 versiyada)</p></div>{isAdmin&&<Button onClick={()=>setCreating(v=>!v)}><Plus/>Yeni sənəd</Button>}</div>
    {creating&&<div className="inlinetaskrow documentrow">{order.map(key=>createFieldRenderers[key]())}<div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>setCreating(false)}>Ləğv et</button><Button disabled={busy||!name.trim()} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable documenttable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} extraKeys={isAdmin?["actions"]:[]}/><thead><tr>{order.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}>{col.headerContent}</SortableTh>})}{isAdmin&&<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader/></th>}</tr></thead><tbody>{items.map(item=>editingId===item.id?<tr key={item.id}><td colSpan={order.length+(isAdmin?1:0)}><div className="inlinetaskrow documentrow documenteditrow">{order.map(key=>editFieldRenderers(item)[key]())}<div className="inlineactions"><button className="inlinecancel" disabled={editBusy} onClick={cancelEdit}>Ləğv et</button><Button disabled={editBusy||!editName.trim()} onClick={()=>void saveEdit(item)}>{editBusy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div></td></tr>:<tr key={item.id}>
      {order.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      {isAdmin&&<td data-label="Əməliyyat"><div className="tableactions"><button className="editcompanybtn" onClick={()=>startEdit(item)}>Redaktə et</button><button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button></div></td>}
    </tr>)}</tbody></table>{!items.length&&<Empty text="Hələ sənəd əlavə edilməyib."/>}</div>}
  </section>;
}
function OutgoingDocumentsPage({isAdmin}:{isAdmin:boolean}){
  const [items,setItems]=useState<OutgoingDocument[]>([]);
  const [templates,setTemplates]=useState<DocumentTemplate[]>([]);
  const [customers,setCustomers]=useState<Customer[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState<Record<string,string>>({});
  const [newFile,setNewFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [editingId,setEditingId]=useState<number|null>(null);
  const [editForm,setEditForm]=useState<Record<string,string>>({});
  const [editFile,setEditFile]=useState<File|null>(null);
  const [editBusy,setEditBusy]=useState(false);
  const load=async()=>{setLoading(true);setError("");try{const [outgoingResponse,templateResponse,customerResponse]=await Promise.all([fetch("/api/documents/outgoing"),fetch("/api/documents"),fetch("/api/customers")]);const outgoingBody=await outgoingResponse.json();if(!outgoingResponse.ok)throw new Error(outgoingBody.error);setItems(outgoingBody.items||[]);const templateBody=await templateResponse.json();if(templateResponse.ok)setTemplates(templateBody.items||[]);const customerBody=await customerResponse.json();if(customerResponse.ok)setCustomers(customerBody.items||[])}catch(e){setError(e instanceof Error?e.message:"Siyahı açıla bilmədi.")}finally{setLoading(false)}};
  useEffect(()=>{void load()},[]);
  const uploadFile=async(file:File)=>{
    if(file.size>25*1024*1024)throw new Error("Faylın həcmi 25 MB-dan çox ola bilməz.");
    const upload=new FormData();upload.append("file",file);
    const response=await fetch("/api/file",{method:"POST",body:upload});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||"Fayl yüklənmədi.");
    return result as {key:string;name:string;size:number;type:string};
  };
  const create=async()=>{
    const voenValue=(form.voen||"").trim();
    if(voenValue&&!customers.some(c=>c.voen===voenValue)){setError("Bu VÖEN müştəri siyahısında tapılmadı. Zəhmət olmasa düzgün VÖEN daxil edin.");return}
    setBusy(true);setError("");
    try{
      let attachment:Record<string,unknown>={};
      if(newFile){const uploaded=await uploadFile(newFile);attachment={attachmentKey:uploaded.key,attachmentName:uploaded.name,attachmentSize:uploaded.size,attachmentType:uploaded.type}}
      const response=await fetch("/api/documents/outgoing",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...form,...attachment})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setForm({});setNewFile(null);setCreating(false);
    }catch(e){setError(e instanceof Error?e.message:"Sənəd əlavə olunmadı.")}
    finally{setBusy(false)}
  };
  const startEdit=(item:OutgoingDocument)=>{setEditingId(item.id);setEditFile(null);setEditForm({outgoingDate:item.outgoing_date||"",incomingNo:item.incoming_no||"",incomingDate:item.incoming_date||"",sendingDepartment:item.sending_department||"",documentType:item.document_type||"",sendingMethod:item.sending_method||"",deliveredBy:item.delivered_by||"",copies:item.copies||"",documentDate:item.document_date||"",voen:item.voen||"",organizationName:item.organization_name||"",phone:item.phone||"",note:item.note||""})};
  const cancelEdit=()=>{setEditingId(null);setEditForm({});setEditFile(null)};
  const saveEdit=async(id:number)=>{
    const voenValue=(editForm.voen||"").trim();
    if(voenValue&&!customers.some(c=>c.voen===voenValue)){setError("Bu VÖEN müştəri siyahısında tapılmadı. Zəhmət olmasa düzgün VÖEN daxil edin.");return}
    setEditBusy(true);setError("");
    try{
      let attachment:Record<string,unknown>={};
      if(editFile){const uploaded=await uploadFile(editFile);attachment={attachmentKey:uploaded.key,attachmentName:uploaded.name,attachmentSize:uploaded.size,attachmentType:uploaded.type}}
      const response=await fetch("/api/documents/outgoing",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({...editForm,...attachment,id})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setEditingId(null);setEditForm({});setEditFile(null);
    }catch(e){setError(e instanceof Error?e.message:"Sənəd yenilənmədi.")}
    finally{setEditBusy(false)}
  };
  const remove=async(item:OutgoingDocument)=>{
    if(!window.confirm(`"${item.outgoing_no}" nömrəli sənədi silmək istəyirsiniz?`))return;
    setError("");
    try{
      const response=await fetch(`/api/documents/outgoing?id=${item.id}`,{method:"DELETE"});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);
    }catch(e){setError(e instanceof Error?e.message:"Sənəd silinmədi.")}
  };
  const sendingMethodOptions=["Kağız-Əldən","Adoc-Vergidən"];
  const copiesOptions=["1","2","3","4","5"];
  const templateFor=(typeName:string)=>templates.find(t=>t.name.trim().toLocaleLowerCase("az-AZ")===typeName.trim().toLocaleLowerCase("az-AZ"));
  const fieldRenderers:Record<string,(values:Record<string,string>,set:(next:Record<string,string>)=>void)=>React.ReactNode>={
    outgoingDate:(values,set)=><Field key="outgoingDate" label="Çıxış tarixi" type="date" value={values.outgoingDate||""} set={v=>set({...values,outgoingDate:v})}/>,
    incomingNo:(values,set)=><Field key="incomingNo" label="Daxil olma No" value={values.incomingNo||""} set={v=>set({...values,incomingNo:v})}/>,
    incomingDate:(values,set)=><Field key="incomingDate" label="Daxil olma tarixi" type="date" value={values.incomingDate||""} set={v=>set({...values,incomingDate:v})}/>,
    sendingDepartment:(values,set)=><Field key="sendingDepartment" label="Göndərən şöbə" value={values.sendingDepartment||""} set={v=>set({...values,sendingDepartment:v})}/>,
    documentType:(values,set)=><label className="field" key="documentType">Sənədin tipi<Input list="documentTypeOptions" value={values.documentType||""} onChange={e=>set({...values,documentType:e.target.value})}/></label>,
    sendingMethod:(values,set)=><label className="field" key="sendingMethod">Göndərilmə Şəkli<select value={values.sendingMethod||""} onChange={e=>set({...values,sendingMethod:e.target.value})}><option value="">Seçin</option>{sendingMethodOptions.map(o=><option key={o} value={o}>{o}</option>)}</select></label>,
    deliveredBy:(values,set)=><Field key="deliveredBy" label="Sənədi Götürən Şəxs" value={values.deliveredBy||""} set={v=>set({...values,deliveredBy:v})}/>,
    copies:(values,set)=><label className="field" key="copies">Sənədin nüsxəsi<select value={values.copies||""} onChange={e=>set({...values,copies:e.target.value})}><option value="">Seçin</option>{copiesOptions.map(o=><option key={o} value={o}>{o}</option>)}</select></label>,
    documentDate:(values,set)=><Field key="documentDate" label="Sənədin tarixi" type="date" value={values.documentDate||""} set={v=>set({...values,documentDate:v})}/>,
    voen:(values,set)=><label className="field" key="voen">Voeni<Input value={values.voen||""} onChange={e=>set({...values,voen:e.target.value})} onBlur={e=>{const trimmed=e.target.value.trim();const match=customers.find(c=>c.voen===trimmed);set({...values,voen:trimmed,organizationName:match?match.name:""})}}/></label>,
    organizationName:(values)=><label className="field" key="organizationName">Təşkilatın adı<Input value={values.organizationName||""} readOnly placeholder="Əvvəlcə VÖEN daxil edin"/></label>,
    phone:(values,set)=><Field key="phone" label="Müştərinin Telefonu" value={values.phone||""} set={v=>set({...values,phone:v})}/>,
    note:(values,set)=><Field key="note" label="Əlavə Qeydlər" value={values.note||""} set={v=>set({...values,note:v})}/>,
  };
  const fields=(values:Record<string,string>,set:(next:Record<string,string>)=>void)=><>{order.filter(key=>fieldRenderers[key]).map(key=>fieldRenderers[key](values,set))}</>;
  const templateAndFileBlock=(values:Record<string,string>,fileValue:File|null,setFileValue:(f:File|null)=>void)=>{
    const matched=values.documentType?templateFor(values.documentType):undefined;
    const templateSlots=matched?[{n:1,key:matched.template1_key,name:matched.template1_name},{n:2,key:matched.template2_key,name:matched.template2_name},{n:3,key:matched.template3_key,name:matched.template3_name}]:[];
    return <>
      {matched&&<div className="templateusepanel"><b>Şablondan istifadə et</b><p>Şablonu yükləyib doldurun, sonra aşağıdan hazır sənədi əlavə edin.</p><div className="templateuseslots">{templateSlots.map(t=><div className="templateuseslot" key={t.n}><span className="templatelabel">Sənədin şablonu<br/>{t.n}</span>{t.key?<a className="filelink" href={`/api/file?key=${encodeURIComponent(t.key)}`} target="_blank" rel="noreferrer">{t.name}</a>:<span className="nodocument">Yoxdur</span>}</div>)}</div></div>}
      <label className="field filefield">Doldurulmuş sənəd (istəyə bağlı)<Input type="file" onChange={e=>setFileValue(e.target.files?.[0]||null)}/>{fileValue&&<small>{fileValue.name} • {formatFileSize(fileValue.size)}</small>}</label>
    </>;
  };
  const outgoingColumns:Array<{key:string;label:string;width:number;search:(item:OutgoingDocument)=>string;render:(item:OutgoingDocument)=>React.ReactNode}>=[
    {key:"outgoingNo",label:"Çıxış No",width:110,search:item=>item.outgoing_no,render:item=><b>{item.outgoing_no}</b>},
    {key:"outgoingDate",label:"Çıxış tarixi",width:110,search:item=>formatDateOnly(item.outgoing_date),render:item=><>{formatDateOnly(item.outgoing_date)}</>},
    {key:"incomingNo",label:"Daxil olma No",width:130,search:item=>item.incoming_no||"",render:item=><>{item.incoming_no||"—"}</>},
    {key:"incomingDate",label:"Daxil olma tarixi",width:130,search:item=>formatDateOnly(item.incoming_date),render:item=><>{formatDateOnly(item.incoming_date)}</>},
    {key:"sendingDepartment",label:"Göndərən şöbə",width:150,search:item=>item.sending_department||"",render:item=><>{item.sending_department||"—"}</>},
    {key:"documentType",label:"Sənədin tipi",width:130,search:item=>item.document_type||"",render:item=><>{item.document_type||"—"}</>},
    {key:"sendingMethod",label:"Göndərilmə Şəkli",width:140,search:item=>item.sending_method||"",render:item=><>{item.sending_method||"—"}</>},
    {key:"deliveredBy",label:"Sənədi Götürən Şəxs",width:160,search:item=>item.delivered_by||"",render:item=><>{item.delivered_by||"—"}</>},
    {key:"copies",label:"Sənədin nüsxəsi",width:110,search:item=>item.copies||"",render:item=><>{item.copies||"—"}</>},
    {key:"documentNumber",label:"Sənədin Nömrəsi",width:130,search:item=>item.document_number||"",render:item=><>{item.document_number||"—"}</>},
    {key:"documentDate",label:"Sənədin tarixi",width:110,search:item=>formatDateOnly(item.document_date),render:item=><>{formatDateOnly(item.document_date)}</>},
    {key:"voen",label:"Voeni",width:100,search:item=>item.voen||"",render:item=><>{item.voen||"—"}</>},
    {key:"organizationName",label:"Təşkilatın adı",width:170,search:item=>item.organization_name||"",render:item=><>{item.organization_name||"—"}</>},
    {key:"phone",label:"Müştərinin Telefonu",width:140,search:item=>item.phone||"",render:item=><>{item.phone||"—"}</>},
    {key:"note",label:"Əlavə Qeydlər",width:180,search:item=>item.note||"",render:item=><>{item.note||"—"}</>},
    {key:"file",label:"Sənəd faylı",width:150,search:item=>item.attachment_name||"Sənəd yoxdur",render:item=>item.attachment_key?<a className="filelink" href={`/api/file?key=${encodeURIComponent(item.attachment_key)}`} target="_blank" rel="noreferrer">{item.attachment_name||"Fayl"}<small>{formatFileSize(item.attachment_size||0)}</small></a>:<span className="nodocument">Yoxdur</span>},
  ];
  const {order,widths,setWidth,moveColumn}=useTableColumns("outgoing2",outgoingColumns.map(c=>c.key));
  const resize=useEdgeResize(setWidth,60);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(outgoingColumns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(outgoingColumns.map(c=>[c.key,c.width]));
  const [outgoingSearch,setOutgoingSearch]=useState<Record<string,string>>({});
  const setOutgoingFilter=(key:string,value:string)=>setOutgoingSearch(current=>({...current,[key]:value}));
  const matchesOutgoingFilter=(value:string,key:string)=>value.toLocaleLowerCase("az-AZ").includes((outgoingSearch[key]||"").toLocaleLowerCase("az-AZ"));
  const filteredOutgoing=items.filter(item=>outgoingColumns.every(c=>matchesOutgoingFilter(c.search(item),c.key)));
  return <section className="panel pagepanel directorypanel">
    <datalist id="documentTypeOptions">{templates.map(t=><option key={t.id} value={t.name}/>)}</datalist>
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>Çıxan Sənədlər</h2><p>Təşkilatdan göndərilən sənədlərin qeydiyyatı</p></div>{isAdmin&&<Button onClick={()=>setCreating(v=>!v)}><Plus/>Yeni sənəd</Button>}</div>
    {creating&&<div className="inlinetaskrow documentrow outgoingrow">{fields(form,setForm)}{templateAndFileBlock(form,newFile,setNewFile)}<div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>{setCreating(false);setForm({});setNewFile(null)}}>Ləğv et</button><Button disabled={busy} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable documenttable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} extraKeys={isAdmin?["actions"]:[]}/><thead><tr>{order.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}><input aria-label={`${col.label} üzrə axtarış`} placeholder="Axtar..." value={outgoingSearch[key]||""} onChange={e=>setOutgoingFilter(key,e.target.value)}/><span>{col.label}</span></SortableTh>})}{isAdmin&&<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader hasSearch/></th>}</tr></thead><tbody>{filteredOutgoing.map(item=>editingId===item.id?<tr key={item.id}><td colSpan={order.length+(isAdmin?1:0)}><div className="inlinetaskrow documentrow outgoingrow documenteditrow">{fields(editForm,setEditForm)}{templateAndFileBlock(editForm,editFile,setEditFile)}<div className="inlineactions"><button className="inlinecancel" disabled={editBusy} onClick={cancelEdit}>Ləğv et</button><Button disabled={editBusy} onClick={()=>void saveEdit(item.id)}>{editBusy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div></td></tr>:<tr key={item.id}>
      {order.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      {isAdmin&&<td data-label="Əməliyyat"><div className="tableactions"><button className="editcompanybtn" onClick={()=>startEdit(item)}>Redaktə et</button><button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button></div></td>}
    </tr>)}</tbody></table>{!filteredOutgoing.length&&<Empty text={items.length?"Axtarışa uyğun sənəd tapılmadı.":"Hələ çıxan sənəd qeydə alınmayıb."}/>}</div>}
  </section>;
}
const requestStatusTone=(s:string)=>s==="Bağlandı"?"done":s==="İmtina edildi"?"late":s==="Cavablandı"?"review":s==="İcra olunur"||s==="Qəbul edildi"?"inprogress":"";
const requestDue=(i:WorkRequest)=>i.agreed_due_at||i.desired_due_at;
const requestColumns:Array<{key:string;label:string;width:number;search:(item:WorkRequest)=>string;render:(item:WorkRequest)=>React.ReactNode}>=[
  {key:"id",label:"№",width:60,search:i=>String(i.id),render:i=><>{i.actionable?<b className="requestdot" title="Sizdən əməliyyat gözlənilir"/>:null}{i.id}</>},
  {key:"title",label:"Mövzu",width:240,search:i=>i.title,render:i=><b>{i.title}</b>},
  {key:"from",label:"Kimdən",width:190,search:i=>`${i.from_name||""} ${i.from_department||""}`,render:i=><>{i.from_name||"—"}{i.from_department&&<small className="requestsub">{i.from_department}</small>}</>},
  {key:"to",label:"Kimə",width:190,search:i=>`${i.to_department} ${i.assignee_name||""}`,render:i=><>{i.to_department}{i.assignee_name&&<small className="requestsub">İcraçı: {i.assignee_name}</small>}</>},
  {key:"company",label:"Firma",width:150,search:i=>i.company_name,render:i=>i.company_name},
  {key:"due",label:"Tarix",width:120,search:i=>formatDateOnly(requestDue(i)),render:i=><>{formatDateOnly(requestDue(i))}{!["Bağlandı","İmtina edildi","Cavablandı"].includes(i.status)&&<LateDays due={requestDue(i)?`${requestDue(i)}T23:59:59`:null}/>}</>},
  {key:"status",label:"Status",width:130,search:i=>i.status,render:i=><span className={`tablestatus ${requestStatusTone(i.status)}`}>{i.status}</span>},
];
function RequestsPage({isAdmin,companies,activeCompanyId,onActionable}:{isAdmin:boolean;companies:Company[];activeCompanyId:number|null;onActionable:(n:number)=>void}){
  const {order,widths,setWidth,moveColumn}=useTableColumns("requests1",requestColumns.map(c=>c.key));
  const resize=useEdgeResize(setWidth,50);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(requestColumns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(requestColumns.map(c=>[c.key,c.width]));
  const [data,setData]=useState<RequestsData>({items:[],departments:{},members:{},myDepartments:{}});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [box,setBox]=useState<"incoming"|"outgoing"|"oversight">("incoming");
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState<Record<string,string>>({});
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState<Record<string,string>>({});
  const [openId,setOpenId]=useState<number|null>(null);
  const [events,setEvents]=useState<WorkHistoryEvent[]|null>(null);
  const [act,setAct]=useState<Record<string,string>>({});
  const [actError,setActError]=useState("");
  const apply=(body:RequestsData)=>{setData({items:body.items||[],departments:body.departments||{},members:body.members||{},myDepartments:body.myDepartments||{}});onActionable((body.items||[]).filter(i=>i.actionable).length)};
  const load=async()=>{setLoading(true);setError("");try{const response=await fetch("/api/requests");const body=await response.json();if(!response.ok)throw new Error(body.error);apply(body)}catch(e){setError(e instanceof Error?e.message:"Sorğular yüklənmədi.")}finally{setLoading(false)}};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void load()},[]);
  const scoped=data.items.filter(i=>isAdmin||!activeCompanyId||i.company_id===activeCompanyId);
  const counts={incoming:scoped.filter(i=>i.box==="incoming").length,outgoing:scoped.filter(i=>i.box==="outgoing").length,oversight:scoped.filter(i=>i.box==="oversight").length};
  const pending={incoming:scoped.filter(i=>i.box==="incoming"&&i.actionable).length,outgoing:scoped.filter(i=>i.box==="outgoing"&&i.actionable).length};
  const has=(value:string,key:string)=>value.toLocaleLowerCase("az-AZ").includes((search[key]||"").toLocaleLowerCase("az-AZ"));
  const filtered=scoped.filter(i=>i.box===box&&requestColumns.every(c=>has(c.search(i),c.key)));
  const formCompanyId=Number(form.companyId||activeCompanyId||companies[0]?.id||0);
  const myDepartment=data.myDepartments[String(formCompanyId)]||null;
  const departmentOptions=(data.departments[String(formCompanyId)]||[]).filter(d=>d!==myDepartment);
  const create=async()=>{
    if(!formCompanyId||!form.toDepartment||!(form.title||"").trim())return;
    setBusy(true);setError("");
    try{
      let attachment:Record<string,unknown>={};
      if(file){const upload=new FormData();upload.append("file",file);const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});const uploaded=await uploadResponse.json();if(!uploadResponse.ok)throw new Error(uploaded.error||"Fayl yüklənmədi.");attachment={attachmentKey:uploaded.key,attachmentName:uploaded.name,attachmentSize:uploaded.size,attachmentType:uploaded.type}}
      const response=await fetch("/api/requests",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({companyId:formCompanyId,toDepartment:form.toDepartment,title:form.title,description:form.description,desiredDueAt:form.desiredDueAt,...attachment})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      apply(body);setForm({});setFile(null);setCreating(false);setBox("outgoing");
    }catch(e){setError(e instanceof Error?e.message:"Sorğu göndərilmədi.")}
    finally{setBusy(false)}
  };
  const current=data.items.find(i=>i.id===openId)||null;
  const openDetail=async(item:WorkRequest)=>{setOpenId(item.id);setEvents(null);setActError("");setAct({assigneeId:item.assignee_employee_id?String(item.assignee_employee_id):"",agreedDueAt:requestDue(item)||""});try{const response=await fetch(`/api/requests?events=${item.id}`);const body=await response.json();setEvents(response.ok?body.events||[]:[])}catch{setEvents([])}};
  const run=async(action:string,extra:Record<string,unknown>={})=>{
    if(!current)return;
    setBusy(true);setActError("");
    try{
      const response=await fetch("/api/requests",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:current.id,action,...extra})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      apply(body);setEvents(body.events||[]);setAct(a=>({...a,text:"",mode:""}));
    }catch(e){setActError(e instanceof Error?e.message:"Əməliyyat alınmadı.")}
    finally{setBusy(false)}
  };
  const remove=async(item:WorkRequest)=>{
    if(!window.confirm(`“${item.title}” sorğusunu silmək istəyirsiniz?`))return;
    setActError("");
    try{const response=await fetch(`/api/requests?id=${item.id}`,{method:"DELETE"});const body=await response.json();if(!response.ok)throw new Error(body.error);apply(body);setOpenId(null)}catch(e){setActError(e instanceof Error?e.message:"Sorğu silinmədi.")}
  };
  const members=current?data.members[`${current.company_id}|${current.to_department}`]||[]:[];
  const textMode=act.mode||"";
  const textModes:Record<string,{label:string;button:string;required:boolean}>={reject:{label:"İmtinanın səbəbi",button:"İmtina et",required:true},answer:{label:"Cavab (istəyə bağlı)",button:"Cavablandı",required:false},reopen:{label:"Nə çatışmır?",button:"Yenidən aç",required:true},close:{label:"Qeyd (istəyə bağlı)",button:"Bağla",required:false}};
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">ŞÖBƏLƏRARASI</span><h2>Sorğular</h2><p>Başqa şöbəyə iş tələbi və ya məlumat sorğusu göndərin</p></div><Button onClick={()=>setCreating(v=>!v)}><Plus/>Yeni sorğu</Button></div>
    {creating&&<div className="inlinetaskrow requestrow">
      {(isAdmin||companies.length>1)&&<label className="field">Firma<select value={String(formCompanyId||"")} onChange={e=>setForm({...form,companyId:e.target.value,toDepartment:""})}>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      <label className="field">Hansı şöbəyə<select value={form.toDepartment||""} onChange={e=>setForm({...form,toDepartment:e.target.value})}><option value="">Şöbə seçin</option>{departmentOptions.map(d=><option key={d} value={d}>{d}</option>)}</select></label>
      <Field label="Mövzu" value={form.title||""} set={v=>setForm({...form,title:v})}/>
      <label className="field">İstədiyiniz tarix (istəyə bağlı)<Input type="date" value={form.desiredDueAt||""} onChange={e=>setForm({...form,desiredDueAt:e.target.value})}/></label>
      <label className="field requestdesc">Təsvir<Textarea value={form.description||""} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <label className="field filefield">Fayl (istəyə bağlı, maks. 25 MB)<Input type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/>{file&&<small>{file.name} • {formatFileSize(file.size)}</small>}</label>
      {!loading&&!departmentOptions.length&&<small className="requestsub">Bu firmanın strukturunda şöbə tapılmadı — admin əvvəlcə firmanın strukturunu doldurmalıdır.</small>}
      <div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>{setCreating(false);setForm({});setFile(null)}}>Ləğv et</button><Button disabled={busy||!form.toDepartment||!(form.title||"").trim()} onClick={()=>void create()}>{busy?"Göndərilir...":"Göndər"}</Button></div>
    </div>}
    {error&&<div className="errorbox">{error}</div>}
    <div className="fixedsubtabs"><button className={box==="incoming"?"on":""} onClick={()=>setBox("incoming")}>Gələnlər ({counts.incoming}){pending.incoming>0&&<em className="requestbadge">{pending.incoming}</em>}</button><button className={box==="outgoing"?"on":""} onClick={()=>setBox("outgoing")}>Göndərdiklərim ({counts.outgoing}){pending.outgoing>0&&<em className="requestbadge">{pending.outgoing}</em>}</button>{counts.oversight>0&&<button className={box==="oversight"?"on":""} onClick={()=>setBox("oversight")}>Şöbəmin sorğuları ({counts.oversight})</button>}</div>
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable requesttable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} extraKeys={["actions"]}/><thead><tr>{order.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}><input aria-label={`${col.label} üzrə axtarış`} placeholder="Axtar..." value={search[key]||""} onChange={e=>setSearch(s=>({...s,[key]:e.target.value}))}/><span>{col.label}</span></SortableTh>})}<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader hasSearch/></th></tr></thead><tbody>{filtered.map(item=><tr key={item.id} className={item.actionable?"requestpending":undefined}>
      {order.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      <td data-label="Əməliyyat"><button type="button" className="openbtn" onClick={()=>void openDetail(item)}>Aç</button></td>
    </tr>)}</tbody></table>{!filtered.length&&<Empty text={box==="incoming"?"Gələn sorğu yoxdur.":box==="outgoing"?"Hələ sorğu göndərməmisiniz.":"Şöbənizin sorğusu yoxdur."}/>}</div>}
    <Dialog open={Boolean(current)} onOpenChange={v=>{if(!v)setOpenId(null)}}><DialogContent className="businessdialog" resizable>{current&&<FormShell title={current.title} desc={`Sorğu №${current.id} • ${current.company_name}`} formClass="taskdetailform">
      <div className="taskdetailleft requestside">
        <div className="field"><span>Status</span><strong className={`detailstatus ${requestStatusTone(current.status)}`}>{current.status}</strong></div>
        {(current.can.accept||current.can.reassign)&&<div className="requestblock"><label className="field">{current.can.accept?"İcraçı":"İcraçını dəyiş"}<select value={act.assigneeId||""} onChange={e=>setAct({...act,assigneeId:e.target.value})}><option value="">Əməkdaş seçin</option>{members.map(m=><option key={m.id} value={m.id}>{m.name} — {m.position_title}</option>)}</select></label>
          {current.can.accept&&<label className="field">Razılaşdırılmış tarix<Input type="date" value={act.agreedDueAt||""} onChange={e=>setAct({...act,agreedDueAt:e.target.value})}/></label>}
          {!members.length&&<small className="requestsub">Bu şöbədə vəzifəyə təyin olunmuş əməkdaş yoxdur.</small>}
          <Button disabled={busy||!act.assigneeId||(!current.can.accept&&act.assigneeId===String(current.assignee_employee_id))} onClick={()=>void run(current.can.accept?"accept":"reassign",{assigneeId:Number(act.assigneeId),agreedDueAt:act.agreedDueAt})}>{current.can.accept?"Qəbul et":"İcraçını dəyiş"}</Button></div>}
        <div className="requestbuttons">
          {current.can.start&&<Button disabled={busy} onClick={()=>void run("start")}>İcraya al</Button>}
          {current.can.answer&&<Button disabled={busy} onClick={()=>setAct({...act,mode:"answer",text:""})}>Cavablandır</Button>}
          {current.can.close&&<Button disabled={busy} onClick={()=>setAct({...act,mode:"close",text:""})}>Bağla ✓</Button>}
          {current.can.reopen&&<button className="inlinecancel" disabled={busy} onClick={()=>setAct({...act,mode:"reopen",text:""})}>Cavab qane etmir</button>}
          {current.can.reject&&<button className="inlinecancel" disabled={busy} onClick={()=>setAct({...act,mode:"reject",text:""})}>İmtina et</button>}
          {current.can.remove&&<button className="deletetaskbtn" disabled={busy} onClick={()=>void remove(current)}>Sil</button>}
        </div>
        {textMode&&textModes[textMode]&&<div className="requestblock"><label className="field">{textModes[textMode].label}<Textarea value={act.text||""} onChange={e=>setAct({...act,text:e.target.value})}/></label><div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>setAct({...act,mode:"",text:""})}>Ləğv et</button><Button disabled={busy||(textModes[textMode].required&&!(act.text||"").trim())} onClick={()=>void run(textMode,{text:act.text})}>{textModes[textMode].button}</Button></div></div>}
        {current.can.comment&&!textMode&&<div className="requestblock"><label className="field">Şərh yaz<Textarea value={act.text||""} onChange={e=>setAct({...act,text:e.target.value})}/></label><Button disabled={busy||!(act.text||"").trim()} onClick={()=>void run("comment",{text:act.text})}>Göndər</Button></div>}
        {actError&&<div className="errorbox">{actError}</div>}
      </div>
      <div className="taskdetailright"><div className="taskdetailinfo">
        <p><b>Kimdən</b><span>{current.from_name||"—"}{current.from_department?` — ${current.from_department}`:""}</span></p>
        <p><b>Kimə</b><span>{current.to_department}{current.assignee_name?` — icraçı: ${current.assignee_name}`:""}</span></p>
        {current.description&&<p><b>Təsvir</b><span className="requesttext">{current.description}</span></p>}
        <p><b>İstənilən tarix</b><span>{formatDateOnly(current.desired_due_at)}{current.agreed_due_at&&current.agreed_due_at!==current.desired_due_at?` → razılaşdırılmış: ${formatDateOnly(current.agreed_due_at)}`:""}</span></p>
        {current.attachment_key&&<p><b>Əlavə olunan fayl</b><span><a className="filelink" href={`/api/file?key=${encodeURIComponent(current.attachment_key)}`}>{current.attachment_name}<small>{formatFileSize(current.attachment_size||0)}</small></a></span></p>}
        {current.reject_reason&&<p><b>İmtinanın səbəbi</b><span className="requesttext">{current.reject_reason}</span></p>}
        <p><b>Göndərilib</b><span>{formatDate(current.created_at)}</span></p>
      </div>
      <WorkHistory events={events} title="Sorğunun tarixçəsi"/></div>
    </FormShell>}</DialogContent></Dialog>
  </section>;
}
function PlaceholderPage({title,text}:{title:string;text:string}){
  return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>{title}</h2><p>Bu bölmə hazırlanma mərhələsindədir</p></div></div><Empty text={text}/></section>;
}
function WorkList({employeeView,tab,frequency,items,assignments,completions,employees,companies,form,setForm,onAdd,onDue,onAssign,onCatalogAssign,onComplete}:{employeeView:boolean;tab:"catalog"|"assignments";frequency:"monthly"|"weekly";items:WorkItem[];assignments:WorkAssignment[];completions:WorkCompletion[];employees:Employee[];companies:Company[];form:Record<string,string>;setForm:React.Dispatch<React.SetStateAction<Record<string,string>>>;onAdd:()=>void;onDue:(item:WorkItem,dueDay:number)=>void;onAssign:()=>void;onCatalogAssign:(workDefinitionId:number,companyId:number,employeeId:number)=>void;onComplete:(assignmentId:number,periodKey:string)=>void}){const [creating,setCreating]=useState(false);const [catalogCompanyFilter,setCatalogCompanyFilter]=useState("all");const [catalogEmployeeFilter,setCatalogEmployeeFilter]=useState("all");
  const today=bakuToday();
  const [year,setYear]=useState(today.year);
  const [month,setMonth]=useState(today.month);
  // One company filter for both admin tables: it narrows the company columns as well as the rows.
  const shownCompanies=catalogCompanyFilter==="all"?companies:companies.filter(c=>String(c.id)===catalogCompanyFilter);const assignmentView=employeeView||tab==="assignments";const [catalogWidths,setCatalogWidth]=useSimpleColumnWidths("workcatalog4");const resizeCatalog=useEdgeResize(setCatalogWidth,40);const [periodWidths,setPeriodWidth]=useSimpleColumnWidths("workperiods2");const resizePeriod=useEdgeResize(setPeriodWidth,40);
  // The header and every row are separate grids. Each gets the same explicit min-width (sum of the column widths) instead of the
  // CSS max-content one — max-content counts a long description as one unwrapped line, which widened that row alone and pushed its
  // cells out from under their headers. Only "description" is flexible, so it soaks up spare width identically in every row.
  const colTemplate=(cols:[string,number][],widths:Record<string,number>)=>{const px=cols.map(([key,def])=>widths[key]||def);return {gridTemplateColumns:cols.map(([key],i)=>key==="description"?`minmax(${px[i]}px,1fr)`:`${px[i]}px`).join(" "),minWidth:px.reduce((sum,w)=>sum+w,0)}};
  const catalogColumns=colTemplate([["no",56],["title",260],["description",320],["due",frequency==="weekly"?150:110],...shownCompanies.map(c=>[`c${c.id}`,120] as [string,number])],catalogWidths);const selectedCompanies=new Set((form.assignCompanyIds||"").split(",").filter(Boolean).map(Number));const toggleAssignCompany=(id:number,checked:boolean)=>{const next=new Set(selectedCompanies);checked?next.add(id):next.delete(id);setForm({...form,assignCompanyIds:[...next].join(",")})};const filteredCatalogItems=items.filter(item=>(catalogCompanyFilter==="all"&&catalogEmployeeFilter==="all")||assignments.some(a=>a.work_definition_id===item.id&&(catalogCompanyFilter==="all"||String(a.company_id)===catalogCompanyFilter)&&(catalogEmployeeFilter==="all"||String(a.employee_id)===catalogEmployeeFilter)));
  const catalogAllowedEmployees=(companyId:number)=>employees.filter(employee=>(employee.company_ids||"").split(",").filter(Boolean).map(Number).includes(companyId));
  const dueEditor=(item:WorkItem)=><label className="catalogdue"><select aria-label={`${item.title}: son tarix`} value={dueDay(item)} onChange={e=>onDue(item,Number(e.target.value))}>{item.frequency==="weekly"?WEEKDAY_NAMES.map((name,i)=><option key={name} value={i+1}>{name}</option>):Array.from({length:31},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label>;
  const dueHeader=<>Son tarix{frequency==="monthly"&&<small className="headnote">(növbəti ay)</small>}</>;
  const catalogGroup=(freq:"monthly"|"weekly"|"daily")=>{
    const list=filteredCatalogItems.filter(item=>item.frequency===freq);
    if(!list.length)return <Empty text="Bu dövr üzrə sabit iş tapılmadı."/>;
    return <div className="workmatrix"><div className="workmatrixhead" style={catalogColumns}><span {...resizeCatalog("no")}>№</span><span {...resizeCatalog("title")}>İşlərin siyahısı</span><span {...resizeCatalog("description")}>İşin açıqlaması</span><span {...resizeCatalog("due")}>{dueHeader}</span>{shownCompanies.map(c=><span key={c.id} {...resizeCatalog(`c${c.id}`)}>{c.name}</span>)}</div>{list.map((item,index)=><article key={item.id} style={catalogColumns}><b className="rownumber">{index+1}</b><h3>{item.title}</h3><p className="workdescription">{item.description||"—"}</p>{dueEditor(item)}{shownCompanies.map(c=>{const assigned=assignments.find(a=>a.work_definition_id===item.id&&a.company_id===c.id);const allowedEmployees=catalogAllowedEmployees(c.id);return <label className={assigned?"catalogassignee assignedname":"catalogassignee"} key={c.id}><select aria-label={`${c.name} üçün istifadəçi`} value={assigned?.employee_id||""} onChange={e=>e.target.value&&onCatalogAssign(item.id,c.id,Number(e.target.value))}><option value="">Seçin</option>{allowedEmployees.map(employee=><option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>})}</article>)}</div>;
  };
  // Year table: one row per assignment (work + company + person), one column per month — or, for weekly works, per week of the chosen month.
  const rows=assignments.filter(a=>a.frequency===frequency&&(catalogCompanyFilter==="all"||String(a.company_id)===catalogCompanyFilter)).sort((a,b)=>a.title.localeCompare(b.title,"az")||a.company_name.localeCompare(b.company_name,"az")||a.employee_name.localeCompare(b.employee_name,"az"));
  const showCompany=employeeView?new Set(rows.map(r=>r.company_id)).size>1:catalogCompanyFilter==="all";
  const periods=frequency==="monthly"?MONTH_NAMES.map((label,i)=>({key:monthlyKey(year,i),label,col:`m${i}`})):weeksOfMonth(year,month).map((week,i)=>({...week,col:`w${i}`}));
  const periodColumns=colTemplate([["no",48],["title",240],["description",260],...(showCompany?[["company",150] as [string,number]]:[]),...(employeeView?[]:[["user",150] as [string,number]]),["due",frequency==="weekly"?130:90],...periods.map(p=>[p.col,frequency==="monthly"?70:104] as [string,number])],periodWidths);
  const completedAt=new Map(completions.map(c=>[`${c.work_assignment_id}|${c.period_key}`,c.completed_at]));
  const years=Array.from({length:today.year+2-Math.min(2026,today.year)},(_,i)=>Math.min(2026,today.year)+i);
  const periodCell=(a:WorkAssignment,p:{key:string;label:string})=>{
    const done=completedAt.get(`${a.id}|${p.key}`);
    const state=periodState(a,p.key,done);
    const span=periodWindow(a,p.key);
    const hint=span?`${p.label} — açılır: ${formatBakuDate(span.start)}, son tarix: ${formatBakuDate(span.due-1)}${done?`, icra: ${formatDate(done)}`:""}`:p.label;
    const open=state==="active"||state==="overdue";
    return <button type="button" key={p.key} title={hint} aria-label={hint} disabled={!open} className={`periodcell ${state}`} onClick={()=>{if(span&&confirm(`"${a.title}" — ${p.label}: icra edildi kimi işarələnsin?`))onComplete(a.id,p.key)}}>{done?<span className="completioncheck">✓</span>:state==="overdue"?<><b>Gecikib</b><small>{overdueDays(a,p.key)} gün</small></>:null}</button>;
  };
  const periodGroup=()=>rows.length?<><div className="workmatrix periodmatrix"><div className="workmatrixhead" style={periodColumns}><span {...resizePeriod("no")}>№</span><span {...resizePeriod("title")}>İşlərin siyahısı</span><span {...resizePeriod("description")}>İşin açıqlaması</span>{showCompany&&<span {...resizePeriod("company")}>Firma</span>}{!employeeView&&<span {...resizePeriod("user")}>İstifadəçi</span>}<span {...resizePeriod("due")}>{dueHeader}</span>{periods.map(p=><span key={p.key} {...resizePeriod(p.col)}>{p.label}</span>)}</div>{rows.map((a,index)=><article key={a.id} style={periodColumns}><b className="rownumber">{index+1}</b><h3 title={a.title}>{a.title}</h3><p className="workdescription" title={a.description||""}>{a.description||"—"}</p>{showCompany&&<span className="matrixuser" title={a.company_name}>{a.company_name}</span>}{!employeeView&&<span className="matrixuser" title={a.employee_name}>{a.employee_name}</span>}<span className="matrixuser">{dueLabel(a)}</span>{periods.map(p=>periodCell(a,p))}</article>)}</div><div className="periodlegend"><span><i className="periodcell active"/>Açıqdır — icra etmək vaxtıdır</span><span><i className="periodcell done"/>Vaxtında icra edilib</span><span><i className="periodcell late-done"/>Gecikməklə icra edilib</span><span><i className="periodcell overdue"/>Gecikib</span><span><i className="periodcell future"/>Hələ açılmayıb</span></div></>:<Empty text={employeeView?"Sizə hələ sabit iş təyin edilməyib.":"Hələ personala sabit iş təyin edilməyib."}/>;
  const frequencyEyebrow=frequency==="monthly"?"AYLIQ SABİT İŞLƏR":"HƏFTƏLİK SABİT İŞLƏR";
  return <section className={`panel pagepanel recurringpage ${frequency}`}><div className="pageactions recurringhead"><div><span className="sectioneyebrow">{frequencyEyebrow}</span><h2>{employeeView?"Mənim sabit işlərim":assignmentView?"Personal sabit işlər":"Sabit işlərin siyahısı"}</h2><p>{employeeView?"Sizə sabit olaraq həvalə edilmiş işlər və firmalar":assignmentView?"Sabit işlərin personal və firmalar üzrə bölgüsü":"Sabit işlərin ümumi siyahısı"}</p></div>{!employeeView&&assignmentView&&<Button onClick={()=>setCreating(v=>!v)}><Plus/>Sabit iş yarat</Button>}</div>{!assignmentView?<><div className="catalogfilters"><label><span>Firma</span><select value={catalogCompanyFilter} onChange={e=>setCatalogCompanyFilter(e.target.value)}><option value="all">Bütün firmalar</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label><span>İstifadəçi</span><select value={catalogEmployeeFilter} onChange={e=>setCatalogEmployeeFilter(e.target.value)}><option value="all">Bütün istifadəçilər</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div><div className="workadd catalogadd"><Input placeholder="Yeni sabit işin adını yazın" value={form.workTitle||""} onChange={e=>setForm({...form,workTitle:e.target.value})}/><Input placeholder="İşin açıqlamasını yazın" value={form.workDescription||""} onChange={e=>setForm({...form,workDescription:e.target.value})}/><Button disabled={!form.workTitle?.trim()} onClick={onAdd}><Plus/>Siyahıya əlavə et</Button></div>{filteredCatalogItems.length?catalogGroup(frequency):<Empty text={items.length?"Seçilmiş filtrlərə uyğun sabit iş tapılmadı.":"Sabit işlərin siyahısı hələ boşdur."}/>}</>:<><div className="periodfilters">{!employeeView&&<label><span>Firma</span><select value={catalogCompanyFilter} onChange={e=>setCatalogCompanyFilter(e.target.value)}><option value="all">Bütün firmalar</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}<label><span>İl</span><select value={year} onChange={e=>setYear(Number(e.target.value))}>{years.map(y=><option key={y} value={y}>{y}</option>)}</select></label>{frequency==="weekly"&&<label><span>Ay</span><select value={month} onChange={e=>setMonth(Number(e.target.value))}>{MONTH_NAMES.map((name,i)=><option key={name} value={i}>{name}</option>)}</select></label>}</div>{creating&&<div className="fixedtaskcreate"><div className="fixedtaskfields"><label>Sabit iş<select value={form.assignWorkId||""} onChange={e=>setForm({...form,assignWorkId:e.target.value})}><option value="">Sabit işi seçin</option>{items.filter(i=>i.frequency===frequency).map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></label><label>İstifadəçi<select value={form.assignEmployeeId||""} onChange={e=>setForm({...form,assignEmployeeId:e.target.value})}><option value="">İstifadəçini seçin</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div><div className="fixedcompanies"><b>Firmaları seçin</b><div>{companies.map(c=><label key={c.id}><input type="checkbox" checked={selectedCompanies.has(c.id)} onChange={e=>toggleAssignCompany(c.id,e.target.checked)}/><span>✓</span>{c.name}</label>)}</div></div><div className="fixedtaskactions"><button onClick={()=>setCreating(false)}>Ləğv et</button><Button disabled={!form.assignWorkId||!form.assignEmployeeId||!selectedCompanies.size} onClick={()=>{onAssign();setCreating(false)}}>Sabit işi yarat</Button></div></div>}{periodGroup()}</>}</section>}
function EvaluationSection({employees,tasks}:{employees:Employee[];tasks:Task[]}){
  const now=Date.now();
  return <section className="panel evalpanel"><div className="head"><div><h3>Qiymətləndirmə</h3><p>Təsdiqlənmiş işlər üzrə nəticələr</p></div></div><div className="evaluationrows">{employees.map((e,index)=>{
    const own=tasks.filter(t=>t.employee_id===e.id);
    const rated=own.filter(t=>t.evaluation);
    if(!rated.length)return null;
    const avgNum=rated.reduce((s,t)=>s+(t.evaluation||0),0)/rated.length;
    const avg=avgNum.toFixed(1);
    const tier=scoreTier(avgNum);
    const inProgress=own.filter(t=>t.status==="İcradadır").length;
    const pending=own.filter(t=>t.status==="Yeni").length;
    const late=own.filter(t=>t.status!=="Təsdiqlənib"&&t.status!=="Geri qaytarılıb"&&new Date(t.due_at).getTime()<now).length;
    return <article key={e.id} className={`hue${index%4}`}>
      <i>{initials(e.name)}</i>
      <div>
        <div className="evalrowtop"><h3>{e.name}</h3><RatingStars value={Math.round(avgNum)}/><strong className={`scorepill ${tier}`}>{avg}<small>/10</small></strong></div>
        <div className="evalmetrics"><span className="rated">Qiymətləndirilmiş<b>{rated.length}</b></span><span className="given">Verilmiş<b>{own.length}</b></span><span className="progress">İcrada<b>{inProgress}</b></span><span className="pending">Qalan<b>{pending}</b></span><span className={late?"warn":"ontime"}>Gecikən<b>{late}</b></span></div>
      </div>
    </article>;
  })}</div>{!tasks.some(t=>t.evaluation)&&<Empty text="Hələ qiymətləndirilmiş iş yoxdur."/>}</section>;
}
function ChecklistFileButton({busy,onPick}:{busy:boolean;onPick:(file:File)=>void}){
  const input=useRef<HTMLInputElement>(null);
  return <span className="checklistattach"><button type="button" className="checklistattachbtn" title="Fayl əlavə et (maks. 25 MB)" disabled={busy} onClick={()=>input.current?.click()}><Paperclip/>{busy?"Yüklənir...":"Fayl"}</button><input ref={input} type="file" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)onPick(file)}}/></span>;
}
function historyTone(action:string){
  const a=action.toLocaleLowerCase("az-AZ");
  if(a.includes("silindi")||a.includes("imtina")||a.includes("qəbul edilmədi")||a.includes("ləğv")||a.includes("geri qaytarıldı")||a.includes("götürüldü"))return "bad";
  if(a.includes("tamamlandı")||a.includes("təsdiqləndi")||a.includes("bağlandı")||a.includes("cavablandı"))return "good";
  if(a.includes("işçi"))return "share";
  if(a.includes("fayl"))return "file";
  return "info";
}
function WorkHistory({events,title="İşin tarixçəsi"}:{events:WorkHistoryEvent[]|null;title?:string}){
  // Starts closed to keep the dialog short; the last choice is remembered in this browser.
  const [open,setOpen]=useState(()=>{try{return window.localStorage.getItem("workhistory:open")==="1"}catch{return false}});
  const toggle=()=>{const next=!open;setOpen(next);try{window.localStorage.setItem("workhistory:open",next?"1":"0")}catch{}};
  return <div className="historysection"><div className="historyhead"><b>{title}</b><span className="historyheadright">{events&&<small>{events.length} hadisə</small>}<button type="button" className="historytoggle" aria-expanded={open} onClick={toggle}>{open?"Bağla":"Aç"}</button></span></div>
    {open&&(!events?<small>Yüklənir...</small>:<ol className="historylist">{events.map((event,index)=><li key={`${event.id}-${index}`} className={`tone-${historyTone(event.action)}`}><i/><div className="historybody"><div className="historyrow"><b>{event.action}</b>{event.created_at?<time>{formatDate(event.created_at)}</time>:<time className="undated" title="Bu hadisə tarixçə əlavə olunmazdan əvvəl baş verib, dəqiq vaxtı bazada saxlanılmayıb.">tarix qeyd olunmayıb</time>}</div><span className="historyactor">{event.actor_name}</span>{event.detail&&<p>{event.detail}</p>}</div></li>)}</ol>)}
  </div>;
}
function FormShell({title,desc,children,formClass=""}:{title:string;desc:string;children:React.ReactNode;formClass?:string}){return <><DialogHeader className="businessdialogheader"><span className="formeyebrow">DAXİLİ İDARƏETMƏ</span><DialogTitle>{title}</DialogTitle><DialogDescription>{desc}</DialogDescription></DialogHeader><div className={`form businessform ${formClass}`}>{children}</div></>}
function Field({label,value,set,type="text"}:{label:string;value:string;set:(v:string)=>void;type?:string}){return <label className="field">{label}<Input type={type} value={value} onChange={e=>set(e.target.value)}/></label>}
function DateTimeField({label,value,set}:{label:string;value:string;set:(v:string)=>void}){
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  const preview=match?`${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}`:"";
  return <label className="field">{label}<div className="datewrap"><Input type="datetime-local" value={value} onChange={e=>set(e.target.value)}/><span className="dateoverlay">{preview||"gg.aa.iiii --:--"}</span></div></label>;
}
function TextField({label,value,set}:{label:string;value:string;set:(v:string)=>void}){return <label className="field">{label}<Textarea value={value} onChange={e=>set(e.target.value)}/></label>}
function SelectCompany({companies,value,set}:{companies:Company[];value:string;set:(v:string)=>void}){return <label className="field">Firma<select value={value} onChange={e=>set(e.target.value)}><option value="">Firma seçin</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
function Stat({icon,tone,label,value}:{icon:React.ReactNode;tone:string;label:string;value:number}){return <article className="stat"><i className={tone}>{icon}</i><div><p>{label}</p><strong>{value}</strong></div></article>}
function Empty({text}:{text:string}){return <div className="empty"><ClipboardList/><p>{text}</p></div>}
function useTableColumns(storageKey:string,defaultKeys:string[]){
  const heal=(order:string[])=>{
    const known=new Set(defaultKeys);
    const healed=order.filter(k=>known.has(k));
    for(const k of defaultKeys)if(!healed.includes(k))healed.push(k);
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
function useSimpleColumnWidths(storageKey:string){
  const [widths,setWidths]=useState<Record<string,number>>(()=>{
    if(typeof window==="undefined")return {};
    try{const raw=window.localStorage.getItem(`colw:${storageKey}`);return raw?JSON.parse(raw):{}}catch{return {}}
  });
  const setWidth=(key:string,width:number)=>{
    setWidths(prev=>{
      const next={...prev,[key]:Math.round(width)};
      if(typeof window!=="undefined"){try{window.localStorage.setItem(`colw:${storageKey}`,JSON.stringify(next))}catch{}}
      return next;
    });
  };
  return [widths,setWidth] as const;
}
function useColumnDrag(moveColumn:(key:string,targetKey:string)=>void){
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
function SortableTh({resize,drag,className,children}:{resize:{onMouseMove:(e:React.MouseEvent<HTMLElement>)=>void;onMouseLeave:()=>void;onMouseDown:(e:React.MouseEvent<HTMLElement>)=>void;className?:string};drag:{draggable:boolean;onDragStart:(e:React.DragEvent)=>void;onDragEnd:()=>void;onDragOver:(e:React.DragEvent)=>void;onDragLeave:()=>void;onDrop:(e:React.DragEvent)=>void;className?:string};className?:string;children:React.ReactNode}){
  return <th draggable={drag.draggable} onDragStart={drag.onDragStart} onDragEnd={drag.onDragEnd} onDragOver={drag.onDragOver} onDragLeave={drag.onDragLeave} onDrop={drag.onDrop} onMouseMove={resize.onMouseMove} onMouseLeave={resize.onMouseLeave} onMouseDown={resize.onMouseDown} className={joinClass(resize.className,drag.className,className)}>{children}</th>;
}
function useEdgeResize(onResize:(key:string,width:number)=>void,min=60){
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
    className:hoverKey===key?"edgeresizing":undefined,
  });
}
function ColGroup({order,defaultWidths,widths,extraKeys=[]}:{order:string[];defaultWidths:Record<string,number>;widths:Record<string,number>;extraKeys?:string[]}){
  return <colgroup>{order.map(key=><col key={key} style={{width:widths[key]||defaultWidths[key]}}/>)}{extraKeys.map(key=><col key={key} style={{width:widths[key]||defaultWidths[key]||140}}/>)}</colgroup>;
}
function joinClass(...parts:Array<string|undefined>){return parts.filter(Boolean).join(" ")||undefined}
function ActionsHeader({hasSearch=false}:{hasSearch?:boolean}){return <>{hasSearch&&<input aria-hidden="true" tabIndex={-1} readOnly value="" style={{visibility:"hidden"}}/>}<span>Əməliyyat</span></>}
function scoreTier(value:number){return value>=8?"":value>=5?"mid":"low"}
function RatingStars({value,compact=false,twoRows=false}:{value:number;compact?:boolean;twoRows?:boolean}){
  const star=(n:number)=><span key={n} className={n<=value?"filled":"empty"}>★</span>;
  if(twoRows)return <span className={joinClass(compact?"ratingstars compact":"ratingstars","tworows")}><span className="starsrow">{[1,2,3,4,5].map(star)}</span><span className="starsrow">{[6,7,8,9,10].map(star)}</span></span>;
  return <span className={compact?"ratingstars compact":"ratingstars"}>{[1,2,3,4,5,6,7,8,9,10].map(star)}</span>;
}
function RatingCell({evaluation,note,compact=false,twoRows=false}:{evaluation:number|null;note:string|null;compact?:boolean;twoRows?:boolean}){
  if(!evaluation&&!note)return null;
  const content=evaluation?<RatingStars value={evaluation} compact={compact} twoRows={twoRows}/>:<span className="nodocument">—</span>;
  if(!note)return content;
  return <span className="cellcomment" tabIndex={0}>{content}<span className="commentmark"/><span className="commenttext">{note}</span></span>;
}
function DateRequestSection({employeeView,current,pendingRequest,taskRequest,dateOpen,setDateOpen,dateForm,setDateForm,onSubmit,resolveNote,setResolveNote,resolveDate,setResolveDate,onResolve}:{employeeView:boolean;current:Task|null;pendingRequest:DateRequest|undefined;taskRequest:DateRequest|undefined;dateOpen:boolean;setDateOpen:(v:boolean)=>void;dateForm:{proposedDueAt:string;reason:string};setDateForm:(v:{proposedDueAt:string;reason:string})=>void;onSubmit:()=>void;resolveNote:string;setResolveNote:(v:string)=>void;resolveDate:string;setResolveDate:(v:string)=>void;onResolve:(approve:boolean)=>void}){
  if(!current)return null;
  if(pendingRequest){
    return <div className="daterequestbox"><b>Tarix dəyişikliyi tələbi</b><p>Personalın təklif etdiyi tarix: <strong>{formatDate(pendingRequest.proposed_due_at)}</strong></p>{pendingRequest.reason&&<p className="daterequestreason">“{pendingRequest.reason}”</p>}{employeeView?<small className="daterequeststatus">Gözləyir</small>:<><DateTimeField label="Təsdiqlənəcək son tarix (istəsəniz dəyişin)" value={resolveDate||toDateTimeLocal(pendingRequest.proposed_due_at)} set={setResolveDate}/><TextField label="Qeyd (istəyə bağlı)" value={resolveNote} set={setResolveNote}/><div className="inlineactions"><button className="inlinecancel" onClick={()=>onResolve(false)}>Rədd et</button><Button onClick={()=>onResolve(true)}>Təsdiqlə</Button></div></>}</div>;
  }
  if(taskRequest){
    const approved=taskRequest.status==="Qəbul edilib";
    const differs=approved&&formatDate(current.due_at)!==formatDate(taskRequest.proposed_due_at);
    return <div className="daterequestbox daterequestdone"><b>Tarix dəyişikliyi tələbi</b><p>Personalın təklif etdiyi tarix: <strong>{formatDate(taskRequest.proposed_due_at)}</strong></p>{taskRequest.reason&&<p className="daterequestreason">“{taskRequest.reason}”</p>}<small className={`daterequeststatus ${approved?"approved":"rejected"}`}>{approved?"Qəbul edilib":"Rədd edilib"}</small>{differs&&<p>Təsdiqlənmiş son tarix: <strong>{formatDate(current.due_at)}</strong></p>}{taskRequest.admin_note&&<p className="daterequestreason">Admin qeydi: “{taskRequest.admin_note}”</p>}{employeeView&&<small className="daterequestnote">Bu tapşırıq üçün tarix dəyişikliyi artıq bir dəfə tələb edilib, yenidən tələb edilə bilməz.</small>}</div>;
  }
  if(!employeeView)return null;
  if(!["Yeni","İcradadır","Geri qaytarılıb"].includes(current.status))return null;
  return <div className="daterequestbox">{dateOpen?<><DateTimeField label="Təklif etdiyiniz yeni tarix" value={dateForm.proposedDueAt} set={v=>setDateForm({...dateForm,proposedDueAt:v})}/><TextField label="Səbəb (istəyə bağlı)" value={dateForm.reason} set={v=>setDateForm({...dateForm,reason:v})}/><div className="inlineactions"><button className="inlinecancel" onClick={()=>setDateOpen(false)}>Ləğv et</button><Button disabled={!dateForm.proposedDueAt} onClick={onSubmit}>Göndər</Button></div></>:<button type="button" className="daterequestbtn" onClick={()=>setDateOpen(true)}>Tarix dəyişikliyi təklif et</button>}</div>;
}
function ChecklistSection({employeeView,checklist,loading,title,setTitle,busy,error,onAdd,onToggle,onRemove,canDelegate=false,delegateEmployees=[],onDelegate,onAttach,onDetach,attachBusyId=null,locked=false,stepsActionable=true}:{employeeView:boolean;checklist:ChecklistLikeItem[];loading:boolean;title:string;setTitle:(v:string)=>void;busy:boolean;error:string;onAdd:()=>void;onToggle:(item:ChecklistLikeItem)=>void;onRemove:(item:ChecklistLikeItem)=>void;canDelegate?:boolean;delegateEmployees?:DelegateCandidate[];onDelegate?:(item:ChecklistLikeItem,employeeId:string,comment:string)=>void;onAttach?:(item:ChecklistLikeItem,file:File)=>void;onDetach?:(item:ChecklistLikeItem)=>void;attachBusyId?:number|null;locked?:boolean;stepsActionable?:boolean}){
  const [choice,setChoice]=useState<Record<number,string>>({});
  const [pending,setPending]=useState<{itemId:number;employeeId:string}|null>(null);
  const [comment,setComment]=useState("");
  const done=checklist.filter(i=>Boolean(i.done)).length;
  const pct=checklist.length?Math.round((done/checklist.length)*100):0;
  return <div className="checklistsection"><div className="checklisthead"><b>Mənim iş axınım</b>{checklist.length>0&&<small>{done}/{checklist.length} tamamlandı <em>({pct}%)</em></small>}</div>
    {!stepsActionable&&checklist.length>0&&<small className="completehint">İşi icraya alın ki, addımları ✓ edə və ya işçiyə həvalə edə biləsiniz.</small>}
    {loading?<small>Yüklənir...</small>:<>
      {checklist.length?<ul className="checklist">{checklist.map(item=><li key={item.id} className={item.done?"done":""}>
        <label><input type="checkbox" checked={Boolean(item.done)} disabled={!employeeView||Boolean(item.delegated_task_id)||!stepsActionable} onChange={()=>onToggle(item)}/><span>{item.title}</span></label>
        <div className="checklistitemactions">
          {item.attachment_key?<span className="checklistfile"><a className="checklistfilelink" href={`/api/file?key=${encodeURIComponent(item.attachment_key)}`} title={item.attachment_name||"Fayl"}><Paperclip/>{item.attachment_name||"Fayl"}</a>{employeeView&&onDetach&&!item.delegated_task_id&&<button type="button" className="checklistremove" title="Faylı sil" onClick={()=>onDetach(item)}>✕</button>}</span>:employeeView&&onAttach&&!item.delegated_task_id&&<ChecklistFileButton busy={attachBusyId===item.id} onPick={file=>onAttach(item,file)}/>}
          {item.delegated_task_id?<><small className="delegatedtag">Həvalə edilib: {item.delegated_employee_name||"—"} — {item.delegated_task_status||"Yeni"}</small>{item.delegated_submission_attachment_key&&<span className="checklistfile"><a className="checklistfilelink" href={`/api/file?key=${encodeURIComponent(item.delegated_submission_attachment_key)}`} title={item.delegated_submission_attachment_name||"Fayl"}><Paperclip/>{item.delegated_submission_attachment_name||"Fayl"}</a></span>}</>:<>
          {canDelegate&&<span className="checklistdelegate"><select disabled={locked||!stepsActionable} value={choice[item.id]||""} onChange={e=>setChoice({...choice,[item.id]:e.target.value})}><option value="">{delegateEmployees.length?"İşçi seçin":"Tabe işçi yoxdur"}</option>{delegateEmployees.map(emp=><option key={emp.id} value={emp.id}>{emp.name}{emp.position_title?` — ${emp.position_title}`:""}</option>)}</select><button type="button" className="delegatebtn" disabled={locked||!stepsActionable||!choice[item.id]} onClick={()=>{setPending({itemId:item.id,employeeId:choice[item.id]});setComment("")}}>Ver</button></span>}
          {employeeView&&<button type="button" className="checklistremove" onClick={()=>onRemove(item)}>✕</button>}
          </>}
        </div>
        {pending?.itemId===item.id&&<div className="checklistcomment"><b>Şərh — {delegateEmployees.find(emp=>String(emp.id)===pending.employeeId)?.name||"işçi"} üçün əlavə məlumat</b><Textarea autoFocus placeholder="İşçiyə çatdırmaq istədiyiniz əlavə məlumatı yazın (istəyə bağlı). Bu mətn tapşırığın açıqlaması olacaq." value={comment} onChange={e=>setComment(e.target.value)}/><div className="checklistcommentactions"><button type="button" className="inlinecancel" onClick={()=>setPending(null)}>Ləğv et</button><Button type="button" onClick={()=>{onDelegate?.(item,pending.employeeId,comment);setChoice({...choice,[item.id]:""});setPending(null);setComment("")}}>Tapşırıq kimi göndər</Button></div></div>}
      </li>)}</ul>:<small className="checklistempty">{employeeView?"Bu tapşırığı icra etmək üçün öz addımlarınızı əlavə edin.":"Personal hələ iş axını yaratmayıb."}</small>}
      {employeeView&&<div className="checklistadd"><Input disabled={locked} placeholder={locked?"Bu mərhələdə yeni addım əlavə etmək olmaz":"Yeni addım yazın"} value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();onAdd()}}}/><Button type="button" disabled={locked||busy||!title.trim()} onClick={onAdd}><Plus/>Əlavə et</Button></div>}
      {error&&<div className="errorbox">{error}</div>}
    </>}
  </div>;
}
function initials(name:string){return name.split(" ").slice(0,2).map(x=>x[0]).join("").toUpperCase()}
function avatarNode(avatarKey:string|null|undefined,name:string){return avatarKey?<img src={`/api/file?key=${encodeURIComponent(avatarKey)}`} alt={name}/>:initials(name)}
function formatDate(value:string){const d=new Date(value);const pad=(n:number)=>String(n).padStart(2,"0");return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`}
function toDateTimeLocal(value:string){const d=new Date(value);const pad=(n:number)=>String(n).padStart(2,"0");return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function formatFileSize(size:number){return size<1024*1024?`${Math.max(1,Math.round(size/1024))} KB`:`${(size/1024/1024).toFixed(1)} MB`}
function formatDateOnly(value:string|null){if(!value)return "—";const m=value.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}.${m[2]}.${m[1]}`:value}
function properCase(value:string){return value.toLocaleLowerCase("az-AZ").replace(/(^|[^\p{L}])(\p{L})/gu,(_,sep,ch)=>sep+ch.toLocaleUpperCase("az-AZ"))}
function statusClass(t:Task){if(t.status!=="Təsdiqlənib"&&t.status!=="Geri qaytarılıb"&&new Date(t.due_at)<new Date())return "late";if(t.status==="Təsdiqlənib")return "done";if(t.status==="Geri qaytarılıb")return "returned";if(t.status==="Təqdim edilib")return "review";return "progress"}
function displayStatus(t:Task){return statusClass(t)==="late"?"Gecikib":t.status}
// Overdue never locks a task or work — it only shows "Gecikib" with how many days past the deadline it is.
function lateDayCount(due:string|null){if(!due)return 0;const diff=Date.now()-new Date(due).getTime();return diff>0?Math.ceil(diff/86400000):0}
function workLate(w:{status:string;due_at:string|null}){return w.status!=="Tamamlanıb"&&lateDayCount(w.due_at)>0}
function LateDays({due}:{due:string|null}){const days=lateDayCount(due);return days?<small className="latedays">{days} gün gecikib</small>:null}
