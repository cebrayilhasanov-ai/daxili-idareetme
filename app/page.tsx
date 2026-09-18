"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Bell, Briefcase, Building2, CheckCircle2, CircleAlert, ClipboardList, Download, Eye, EyeOff, FileText, KeyRound, LayoutDashboard, LogOut, Menu, MessageCircle, Paperclip, Plus, RefreshCw, Send, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Employee = { id:number; name:string; position:string; email:string|null; active:number; created_at:string; company_ids:string|null; avatar_key:string|null };
type Company = { id:number; name:string; voen:string|null; manager:string|null; active:number; created_at:string };
type Task = { id:number; employee_id:number; employee_name:string; employee_position:string; company_id:number|null; company_name:string|null; title:string; description:string|null; due_at:string; original_due_at:string|null; status:string; evaluation:number|null; evaluation_note:string|null; employee_status_changed:number; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; submission_attachment_key:string|null; submission_attachment_name:string|null; submission_attachment_size:number|null; submission_attachment_type:string|null; recurring_task_id:number|null; period_key:string|null; created_at:string };
type DateRequest = { id:number; task_id:number; task_title:string; employee_id:number; employee_name:string; proposed_due_at:string; reason:string|null; status:string; admin_note:string|null; created_at:string; resolved_at:string|null };
type Recurring = { id:number; employee_id:number; employee_name:string; title:string; description:string|null; due_day:number; frequency:"monthly"|"weekly"|"daily"; weekday:number|null; due_time:string; active:number };
type WorkItem = { id:number; title:string; description:string|null; frequency:"monthly"|"weekly"|"daily"; company_ids:string|null };
type WorkAssignment = { id:number; work_definition_id:number; title:string; description:string|null; frequency:"monthly"|"weekly"|"daily"; employee_id:number; employee_name:string; company_id:number; company_name:string; period_key:string; is_completed:number };
type Data = { employees:Employee[]; companies:Company[]; tasks:Task[]; recurring:Recurring[]; workItems:WorkItem[]; workAssignments:WorkAssignment[]; dateRequests:DateRequest[] };
type AppUser = { id:number; name:string; email:string; role:"admin"|"employee"; employeeId:number|null; active?:number; mustChangePassword?:boolean; backgroundKey?:string|null; avatarKey?:string|null };
type ManagedUser = { id:number; name:string; email:string; role:string; employee_id:number|null; active:number; must_change_password:number };
type Page = "dashboard"|"tasks"|"chat"|"employees"|"companies"|"customers"|"audit"|"documents"|"hr";
type AuditItem = { id:number; actor_name:string; action:string; target_type:string; target_label:string|null; created_at:string };
type ChatThread = { id:number; type:"group"|"direct"; name:string; avatar_key:string|null; last_message:string|null; last_message_at:string|null; unread:number };
type ChatMessage = { id:number; thread_id:number; sender_user_id:number; sender_name:string; sender_avatar_key:string|null; body:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; created_at:string };
type ChatUser = { id:number; name:string; email:string; avatar_key:string|null };
type Customer = { id:number; entity_type:string|null; voen:string|null; name:string; legal_address:string|null; legal_address2:string|null; manager:string|null; created_at:string };
type ChecklistItem = { id:number; task_id:number; title:string; done:number; created_at:string };
type ChecklistLikeItem = { id:number; title:string; done:number };
type PersonalWork = { id:number; user_id:number; owner_name:string; title:string; description:string|null; company_id:number|null; company_name:string|null; due_at:string|null; status:string; created_at:string; completed_at:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null };
type PersonalWorkChecklistItem = { id:number; personal_work_id:number; title:string; done:number; created_at:string };
type DocumentTemplate = { id:number; name:string; template1_key:string|null; template1_name:string|null; template1_size:number|null; template1_type:string|null; template2_key:string|null; template2_name:string|null; template2_size:number|null; template2_type:string|null; template3_key:string|null; template3_name:string|null; template3_size:number|null; template3_type:string|null; created_at:string };
type OutgoingDocument = { id:number; outgoing_no:string; outgoing_date:string|null; incoming_no:string|null; incoming_date:string|null; sending_department:string|null; document_type:string|null; sending_method:string|null; delivered_by:string|null; copies:string|null; document_number:string|null; document_date:string|null; voen:string|null; organization_name:string|null; phone:string|null; note:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; created_at:string };
type ChatData = { threads:ChatThread[]; users:ChatUser[]; messages:ChatMessage[]; selectedThreadId:number; totalUnread:number; readUpTo:number };

const emptyData:Data={employees:[],companies:[],tasks:[],recurring:[],workItems:[],workAssignments:[],dateRequests:[]};
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
  const [newTaskOpen,setNewTaskOpen]=useState(false);
  const [viewAs,setViewAs]=useState<Employee|null>(null);
  const [creatingTask,setCreatingTask]=useState(false);
  const [taskFile,setTaskFile]=useState<File|null>(null);
  const [employeePhoto,setEmployeePhoto]=useState<File|null>(null);
  const [uploadingPhoto,setUploadingPhoto]=useState(false);
  const [backgroundFile,setBackgroundFile]=useState<File|null>(null);
  const [uploadingBackground,setUploadingBackground]=useState(false);
  const [ownAvatarFile,setOwnAvatarFile]=useState<File|null>(null);
  const [uploadingOwnAvatar,setUploadingOwnAvatar]=useState(false);
  const createTaskLock=useRef(false);
  const [chatUnread,setChatUnread]=useState(0);
  const [dashboardMenuOpen,setDashboardMenuOpen]=useState(true);
  const [tasksMenuOpen,setTasksMenuOpen]=useState(true);
  const [fixedTab,setFixedTab]=useState<"catalog"|"assignments">("catalog");
  const [taskSubTab,setTaskSubTab]=useState<"tasks"|"monthly"|"weekly">("tasks");
  const [tasksSection,setTasksSection]=useState<"manager"|"mine">("manager");
  const [documentsMenuOpen,setDocumentsMenuOpen]=useState(true);
  const [documentSubTab,setDocumentSubTab]=useState<"templates"|"outgoing"|"incoming">("templates");
  const [notifOpen,setNotifOpen]=useState(false);

  const load=async()=>{setLoading(true);setError("");try{const response=await fetch("/api/data");const body=await response.json();if(!response.ok)throw new Error(body.error);setData(body)}catch(e){setError(e instanceof Error?e.message:"Xəta baş verdi.")}finally{setLoading(false)}};
  useEffect(()=>{let cancelled=false;void fetch("/api/auth").then(async response=>{if(!response.ok)return null;return (await response.json()).user as AppUser}).then(found=>{if(!cancelled)setUser(found)}).finally(()=>{if(!cancelled)setAuthLoading(false)});return()=>{cancelled=true}},[]);
  useEffect(()=>{if(!user)return;void load().then(()=>undefined)},[user]);
  useEffect(()=>{if(!user)return;const check=()=>void fetch("/api/chat?summary=1").then(r=>r.ok?r.json():null).then(v=>v&&setChatUnread(Number(v.totalUnread||0)));check();const timer=setInterval(check,10000);return()=>clearInterval(timer)},[user]);
  const signIn=async()=>{setError("");setAuthLoading(true);try{const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"login",...authForm})});const body=await response.json();if(!response.ok)throw new Error(body.error);setUser(body.user);setAuthForm({email:"",password:""})}catch(e){setError(e instanceof Error?e.message:"Giriş baş tutmadı.")}finally{setAuthLoading(false)}};
  const signOut=async()=>{await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"logout"})});setUser(null);setData(emptyData);setPage("dashboard");setViewAs(null)};
  const changeOwnPassword=async()=>{setError("");const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"change-password",currentPassword:form.currentPassword,newPassword:form.newPassword})});const body=await response.json();if(!response.ok){setError(body.error);return}setDialog(null);setForm({});setUser(current=>current?{...current,mustChangePassword:false}:current)};
  const saveBackground=async()=>{if(!backgroundFile)return;setError("");setUploadingBackground(true);try{if(backgroundFile.size>8*1024*1024)throw new Error("Fon şəklinin həcmi 8 MB-dan çox ola bilməz.");const upload=new FormData();upload.append("file",backgroundFile);const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});const uploadResult=await uploadResponse.json();if(!uploadResponse.ok)throw new Error(uploadResult.error||"Şəkil yüklənmədi.");const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"set-background",backgroundKey:uploadResult.key})});const body=await response.json();if(!response.ok)throw new Error(body.error);setUser(body.user);setDialog(null);setBackgroundFile(null)}catch(e){setError(e instanceof Error?e.message:"Fon şəkli yüklənmədi.")}finally{setUploadingBackground(false)}};
  const removeBackground=async()=>{setError("");try{const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"set-background",backgroundKey:null})});const body=await response.json();if(!response.ok)throw new Error(body.error);setUser(body.user);setDialog(null);setBackgroundFile(null)}catch(e){setError(e instanceof Error?e.message:"Fon şəkli silinmədi.")}};
  const saveOwnAvatar=async()=>{if(!ownAvatarFile)return;setError("");setUploadingOwnAvatar(true);try{if(ownAvatarFile.size>5*1024*1024)throw new Error("Şəklin həcmi 5 MB-dan çox ola bilməz.");const upload=new FormData();upload.append("file",ownAvatarFile);const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});const uploadResult=await uploadResponse.json();if(!uploadResponse.ok)throw new Error(uploadResult.error||"Şəkil yüklənmədi.");const response=await fetch("/api/data",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"self-avatar",avatarKey:uploadResult.key})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Şəkil yüklənmədi.");setData(result);setUser(current=>current?{...current,avatarKey:uploadResult.key}:current);setDialog(null);setOwnAvatarFile(null)}catch(e){setError(e instanceof Error?e.message:"Şəkil yüklənmədi.")}finally{setUploadingOwnAvatar(false)}};
  const removeOwnAvatar=async()=>{setError("");try{const response=await fetch("/api/data",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"self-avatar",avatarKey:null})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Şəkil silinmədi.");setData(result);setUser(current=>current?{...current,avatarKey:null}:current);setDialog(null);setOwnAvatarFile(null)}catch(e){setError(e instanceof Error?e.message:"Şəkil silinmədi.")}};
  const uploadPhotoIfAny=async()=>{if(!employeePhoto)return undefined;if(employeePhoto.size>5*1024*1024)throw new Error("Şəklin həcmi 5 MB-dan çox ola bilməz.");const upload=new FormData();upload.append("file",employeePhoto);const response=await fetch("/api/file",{method:"POST",body:upload});const result=await response.json();if(!response.ok)throw new Error(result.error||"Şəkil yüklənmədi.");return result.key as string};
  const createPersonnel=async()=>{setError("");setUploadingPhoto(Boolean(employeePhoto));try{const avatarKey=await uploadPhotoIfAny();const response=await fetch("/api/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...form,companyIds:(form.companyIds||"").split(",").filter(Boolean).map(Number),avatarKey})});const body=await response.json();if(!response.ok)throw new Error(body.error);setDialog(null);setForm({});setEmployeePhoto(null);location.reload()}catch(e){setError(e instanceof Error?e.message:"Personal yaradılmadı.")}finally{setUploadingPhoto(false)}};
  const saveEmployeeEdit=async()=>{setError("");setUploadingPhoto(Boolean(employeePhoto));try{const avatarKey=await uploadPhotoIfAny();await request("PATCH",{action:"employee",id:Number(form.id),name:form.name,position:form.position,email:form.email,companyIds:(form.companyIds||"").split(",").filter(Boolean).map(Number),...(avatarKey?{avatarKey}:{})});setEmployeePhoto(null)}catch(e){setError(e instanceof Error?e.message:"Personal yenilənmədi.")}finally{setUploadingPhoto(false)}};
  const request=async(method:"POST"|"PATCH",body:Record<string,unknown>)=>{const isNewTask=body.action==="task"&&method==="POST";if(isNewTask&&createTaskLock.current)return;if(isNewTask){createTaskLock.current=true;setCreatingTask(true)}setError("");try{const response=await fetch("/api/data",{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||"Əməliyyat baş tutmadı.");setData(result);setDialog(null);if(isNewTask)setNewTaskOpen(false);setForm({})}catch(e){setError(e instanceof Error?e.message:"Əməliyyat baş tutmadı.")}finally{if(isNewTask){createTaskLock.current=false;setCreatingTask(false)}}};
  const deleteWorker=async(employee:Employee)=>{if(!window.confirm(`${employee.name} adlı personalı tam silmək istəyirsiniz?`))return;setError("");try{const response=await fetch(`/api/data?employeeId=${employee.id}`,{method:"DELETE"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Personal silinmədi.");setData(result)}catch(e){setError(e instanceof Error?e.message:"Personal silinmədi.")}};
  const deleteTaskItem=async(task:Task)=>{if(!window.confirm(`“${task.title}” tapşırığını silmək istəyirsiniz?`))return;setError("");try{const response=await fetch(`/api/data?taskId=${task.id}`,{method:"DELETE"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Tapşırıq silinmədi.");setData(result)}catch(e){setError(e instanceof Error?e.message:"Tapşırıq silinmədi.")}};
  const createTaskItem=async()=>{if(createTaskLock.current)return;createTaskLock.current=true;setCreatingTask(true);setError("");try{let attachment:Record<string,unknown>={};if(taskFile){if(taskFile.size>25*1024*1024)throw new Error("Faylın həcmi 25 MB-dan çox ola bilməz.");const upload=new FormData();upload.append("file",taskFile);const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});const uploadResult=await uploadResponse.json();if(!uploadResponse.ok)throw new Error(uploadResult.error||"Fayl yüklənmədi.");attachment={attachmentKey:uploadResult.key,attachmentName:uploadResult.name,attachmentSize:uploadResult.size,attachmentType:uploadResult.type}}const response=await fetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"task",...form,employeeId:Number(form.employeeId),companyId:Number(form.companyId),dueAt:new Date(form.dueAt).toISOString(),...attachment})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Tapşırıq yaradılmadı.");setData(result);setNewTaskOpen(false);setTaskFile(null);setForm({})}catch(e){setError(e instanceof Error?e.message:"Tapşırıq yaradılmadı.")}finally{createTaskLock.current=false;setCreatingTask(false)}};

  const isAdmin=user?.role==="admin";
  const employeeSelf=!isAdmin&&data.employees[0]||null;
  const effectiveView=viewAs||employeeSelf;
  const ownAvatarKey=employeeSelf?.avatar_key||user?.avatarKey||null;
  const visibleTasks=effectiveView?data.tasks.filter(t=>t.employee_id===effectiveView.id):data.tasks;
  const activeTasks=visibleTasks.filter(t=>t.status!=="Təsdiqlənib");
  const overdue=activeTasks.filter(t=>new Date(t.due_at)<new Date());
  const pendingDateRequests=data.dateRequests.filter(r=>r.status==="Gözləyir");
  const completed=visibleTasks.filter(t=>t.status==="Təsdiqlənib");
  const activeEmployees=data.employees.filter(e=>Boolean(e.active));
  const scored=completed.filter(t=>t.evaluation);
  const average=scored.length?(scored.reduce((s,t)=>s+(t.evaluation||0),0)/scored.length).toFixed(1):"—";
  const title:Record<Page,string>={dashboard:"İdarə paneli",tasks:"Tapşırıqlar",chat:"Çat",employees:"Personal",companies:"Firmalar",customers:"Müştəri siyahısı",audit:"Tarixçə",documents:"Sənədlər",hr:"HR"};
  const nav:[Page,string,React.ComponentType][]=[["dashboard","İdarə paneli",LayoutDashboard],["tasks","Tapşırıqlar",ClipboardList],["documents","Sənədlər",FileText],["hr","HR",Briefcase],["chat","Çat",MessageCircle]];
  const open=(kind:typeof dialog,initial:Record<string,string>={})=>{setForm(initial);setDialog(kind)};

  if(authLoading&&!user)return <div className="authpage"><div className="authcard"><div className="authlogo">Dİ</div><h1>Daxili İdarəetmə</h1><p>Giriş yoxlanılır...</p></div></div>;
  if(!user)return <LoginScreen form={authForm} setForm={setAuthForm} error={error} loading={authLoading} onLogin={()=>void signIn()}/>;
  return <div className="shell">
    <DebugOverlay/>
    {menu&&<button className="shade" onClick={()=>setMenu(false)}/>}
    <aside className={menu?"side show":"side"}>
      <button className="close" onClick={()=>setMenu(false)}><X/></button>
      <div className="sidescroll">
      <div className="brand"><i>Dİ</i><div><b>Daxili İdarəetmə</b><small>İş və tapşırıq sistemi</small><small className="brandversion">Versiya 1.25</small></div></div>
      <nav>{nav.filter(([id])=>isAdmin||id==="dashboard"||id==="tasks"||id==="documents"||id==="hr"||id==="chat").filter(([id])=>!viewAs||id==="dashboard"||id==="tasks").map(([id,label,Icon])=>{
        if(id==="dashboard")return <Fragment key={id}><button className={page===id?"on":""} onClick={()=>{setPage(id);setMenu(false)}} onDoubleClick={()=>setDashboardMenuOpen(v=>!v)}><Icon/>{label}</button>{dashboardMenuOpen&&<div className="navchildren">{isAdmin&&!viewAs&&<button className={page==="companies"?"on":""} onClick={()=>{setPage("companies");setMenu(false)}}>Firmalar</button>}{isAdmin&&!viewAs&&<button className={page==="customers"?"on":""} onClick={()=>{setPage("customers");setMenu(false)}}>Müştəri siyahısı</button>}{isAdmin&&!viewAs&&<button className={page==="employees"?"on":""} onClick={()=>{setPage("employees");setMenu(false)}}>Personal</button>}{isAdmin&&!viewAs&&<button className={page==="audit"?"on":""} onClick={()=>{setPage("audit");setMenu(false)}}>Tarixçə</button>}<button onClick={()=>{setForm({});setDialog("password");setMenu(false)}}>Şifrəni dəyiş</button><button onClick={()=>{setBackgroundFile(null);setDialog("background");setMenu(false)}}>Fon şəkli</button><button onClick={()=>{setOwnAvatarFile(null);setDialog("avatar");setMenu(false)}}>Profil şəkli</button></div>}</Fragment>;
        if(id==="tasks")return <Fragment key={id}><button className={page===id?"on":""} onClick={()=>{setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks");setMenu(false)}} onDoubleClick={()=>setTasksMenuOpen(v=>!v)}><Icon/>{label}{overdue.length>0&&<em>{overdue.length}</em>}</button>{tasksMenuOpen&&<div className="navchildren"><button className={page==="tasks"&&taskSubTab==="monthly"?"on":""} onClick={()=>{setTaskSubTab("monthly");setPage("tasks");setMenu(false)}}>Aylıq Sabit işlər</button><button className={page==="tasks"&&taskSubTab==="weekly"?"on":""} onClick={()=>{setTaskSubTab("weekly");setPage("tasks");setMenu(false)}}>Həftəlik Sabit işlər</button><button className={page==="tasks"&&taskSubTab==="tasks"&&tasksSection==="manager"?"on":""} onClick={()=>{setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks");setMenu(false)}}>Rəhbər tərəfindən göndərilən</button><button className={page==="tasks"&&taskSubTab==="tasks"&&tasksSection==="mine"?"on":""} onClick={()=>{setTaskSubTab("tasks");setTasksSection("mine");setPage("tasks");setMenu(false)}}>İşlərim</button></div>}</Fragment>;
        if(id==="documents")return <Fragment key={id}><button className={page===id?"on":""} onClick={()=>{setDocumentSubTab("templates");setPage("documents");setMenu(false)}} onDoubleClick={()=>setDocumentsMenuOpen(v=>!v)}><Icon/>{label}</button>{documentsMenuOpen&&<div className="navchildren"><button className={page==="documents"&&documentSubTab==="templates"?"on":""} onClick={()=>{setDocumentSubTab("templates");setPage("documents");setMenu(false)}}>Şablonlar</button><button className={page==="documents"&&documentSubTab==="outgoing"?"on":""} onClick={()=>{setDocumentSubTab("outgoing");setPage("documents");setMenu(false)}}>Çıxan Sənədlər</button><button className={page==="documents"&&documentSubTab==="incoming"?"on":""} onClick={()=>{setDocumentSubTab("incoming");setPage("documents");setMenu(false)}}>Daxil Olan Sənədlər</button></div>}</Fragment>;
        return <Fragment key={id}><button className={page===id?"on":""} onClick={()=>{setPage(id);setMenu(false)}}><Icon/>{label}{id==="chat"&&chatUnread>0&&<em>{chatUnread}</em>}</button></Fragment>;
      })}</nav>
      </div>
      <div className="admin"><span>{initials(user.name)}</span><div><b>{user.name}</b><small>{isAdmin?"Baş administrator":"İstifadəçi"}</small></div><button className="logoutbtn" title="Çıxış" onClick={()=>void signOut()}><LogOut/></button></div>
    </aside>
    <main style={user.backgroundKey?{backgroundImage:`linear-gradient(rgba(246,248,255,.88),rgba(242,246,251,.88)), url(/api/file?key=${encodeURIComponent(user.backgroundKey)})`,backgroundSize:"cover",backgroundPosition:"center",backgroundAttachment:"fixed"}:undefined}>
      <header><button className="hamb" onClick={()=>setMenu(true)}><Menu/></button><div><h1>{title[page]}</h1><p>{effectiveView?`${effectiveView.name} tapşırıqları`:"Personalı, tapşırıqları və nəticələri vahid sistemdə idarə edin"}</p></div><div className="actions"><button onClick={()=>void load()} title="Yenilə"><RefreshCw/></button><div className="bellwrap">{notifOpen&&<button className="notifshade" aria-label="Bağla" onClick={()=>setNotifOpen(false)}/>}<button className="bellbtn" title="Bildirişlər" onClick={()=>setNotifOpen(v=>!v)}><Bell/>{(chatUnread+overdue.length+(isAdmin&&!viewAs?pendingDateRequests.length:0))>0&&<em className="headerbadge">{chatUnread+overdue.length+(isAdmin&&!viewAs?pendingDateRequests.length:0)}</em>}</button>{notifOpen&&<div className="notifpanel"><div className="notifsection"><b>Oxunmamış mesajlar</b><button onClick={()=>{setNotifOpen(false);setPage("chat")}}>{chatUnread>0?`${chatUnread} yeni mesaj`:"Yeni mesaj yoxdur"}</button></div><div className="notifsection"><b>Gecikən tapşırıqlar</b>{overdue.length?<>{overdue.slice(0,5).map(t=><button key={t.id} onClick={()=>{setNotifOpen(false);setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks")}}>{t.title} — {t.employee_name}</button>)}{overdue.length>5&&<small>+{overdue.length-5} daha</small>}</>:<small>Gecikən tapşırıq yoxdur</small>}</div>{isAdmin&&!viewAs&&<div className="notifsection"><b>Tarix dəyişikliyi tələbləri</b>{pendingDateRequests.length?<>{pendingDateRequests.slice(0,5).map(r=><button key={r.id} onClick={()=>{setNotifOpen(false);setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks")}}>{r.task_title} — {r.employee_name} → {formatDate(r.proposed_due_at)}</button>)}{pendingDateRequests.length>5&&<small>+{pendingDateRequests.length-5} daha</small>}</>:<small>Gözləyən tələb yoxdur</small>}</div>}</div>}</div>{isAdmin&&!viewAs&&<Button className="primary" onClick={()=>{setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks");setForm({});setNewTaskOpen(true)}}><Plus/><span>Yeni tapşırıq</span></Button>}</div></header>
      {viewAs&&<div className="viewasbar"><div><strong>{viewAs.name}</strong><span>Personal görünüşündəsiniz</span></div><button onClick={()=>{setViewAs(null);setPage("employees")}}>Admin görünüşünə qayıt</button></div>}
      {error&&<div className="errorbox">{error}</div>}
      {loading?<div className="loading">Məlumatlar yüklənir...</div>:<>
        {page==="dashboard"&&<Dashboard userName={user.name} avatarKey={ownAvatarKey} onEditAvatar={()=>{setOwnAvatarFile(null);setDialog("avatar")}} tasks={visibleTasks} active={activeTasks.length} overdue={overdue.length} completed={completed.length} employees={effectiveView?1:activeEmployees.length} average={average} goTasks={()=>{setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks")}} evaluationEmployees={effectiveView?[effectiveView]:data.employees}/>}
        {page==="tasks"&&<>
        {taskSubTab==="tasks"&&<>
        {tasksSection==="manager"&&<TasksPage saving={creatingTask} employeeView={Boolean(effectiveView)} tasks={visibleTasks} employees={effectiveView?[effectiveView]:activeEmployees} companies={data.companies} form={form} setForm={setForm} taskFile={taskFile} setTaskFile={setTaskFile} creating={isAdmin&&!viewAs&&newTaskOpen} onNew={()=>{setForm({});setTaskFile(null);setNewTaskOpen(true)}} onCancel={()=>{setForm({});setTaskFile(null);setNewTaskOpen(false)}} onCreate={()=>void createTaskItem()} onDelete={task=>void deleteTaskItem(task)} onStatus={(task,status,extra)=>void request("PATCH",{action:"task",id:task.id,status,userMode:Boolean(effectiveView),...(extra||{})})} onEvaluate={(task)=>{setSelectedTask(task);open("evaluate",{evaluation:String(task.evaluation||5),evaluationNote:task.evaluation_note||""})}} dateRequests={data.dateRequests} onRequestDate={(taskId,proposedDueAt,reason)=>void request("POST",{action:"date-request",taskId,proposedDueAt,reason})} onResolveDateRequest={(id,approve,adminNote,finalDueAt)=>void request("PATCH",{action:"resolve-date-request",id,approve,adminNote,finalDueAt})}/>}
        {tasksSection==="mine"&&<PersonalWorksPage isAdmin={isAdmin} currentUserId={user.id} companies={data.companies}/>}</>}
        {taskSubTab!=="tasks"&&<>{isAdmin&&!viewAs&&<div className="fixedsubtabs"><button className={fixedTab==="catalog"?"on":""} onClick={()=>setFixedTab("catalog")}>Sabit işlərin siyahısı</button><button className={fixedTab==="assignments"?"on":""} onClick={()=>setFixedTab("assignments")}>Personal sabit işlər</button></div>}<WorkList employeeView={Boolean(effectiveView)} tab={fixedTab} frequency={taskSubTab} items={data.workItems} assignments={effectiveView?data.workAssignments.filter(a=>a.employee_id===effectiveView.id):data.workAssignments} employees={activeEmployees} companies={data.companies.filter(c=>Boolean(c.active))} form={form} setForm={setForm} onAdd={()=>void request("POST",{action:"work-item",title:form.workTitle,description:form.workDescription,frequency:form.workFrequency||taskSubTab})} onFrequency={(item,frequency)=>void request("PATCH",{action:"work-item",id:item.id,frequency})} onAssign={()=>void request("POST",{action:"work-assignment",workDefinitionId:Number(form.assignWorkId),companyIds:(form.assignCompanyIds||"").split(",").filter(Boolean).map(Number),employeeId:Number(form.assignEmployeeId)})} onCatalogAssign={(workDefinitionId,companyId,employeeId)=>void request("POST",{action:"work-assignment",workDefinitionId,companyIds:[companyId],employeeId})} onComplete={(assignmentId)=>void request("PATCH",{action:"work-completion",assignmentId})}/></>}</>}
        {page==="chat"&&<ChatPage currentUser={user} onUnread={setChatUnread}/>}
        {page==="employees"&&<EmployeesPage employees={data.employees} tasks={data.tasks} onNew={()=>{setEmployeePhoto(null);open("employee")}} onEdit={e=>{setEmployeePhoto(null);open("employee",{id:String(e.id),name:e.name,position:e.position,email:e.email||"",companyIds:e.company_ids||""})}} onView={e=>{setViewAs(e);setPage("dashboard")}} onToggle={e=>void request("PATCH",{action:"employee",id:e.id,active:!Boolean(e.active)})} onDelete={e=>void deleteWorker(e)}/>}
        {page==="companies"&&<CompaniesPage companies={data.companies} tasks={data.tasks} onNew={()=>open("company")} onEdit={c=>open("company",{id:String(c.id),name:c.name,voen:c.voen||"",manager:c.manager||""})} onToggle={c=>void request("PATCH",{action:"company",id:c.id,active:!Boolean(c.active)})}/>}
        {page==="customers"&&<CustomersPage/>}
        {page==="audit"&&<AuditPage/>}
        {page==="documents"&&<>
        {documentSubTab==="templates"&&<DocumentsPage isAdmin={isAdmin}/>}
        {documentSubTab==="outgoing"&&<OutgoingDocumentsPage isAdmin={isAdmin}/>}
        {documentSubTab==="incoming"&&<PlaceholderPage title="Daxil Olan Sənədlər" text="Bu bölmə tezliklə hazırlanacaq."/>}</>}
        {page==="hr"&&<PlaceholderPage title="HR" text="Bu bölmə tezliklə hazırlanacaq."/>}
      </>}
    </main>
    <Dialog open={dialog!==null} onOpenChange={v=>!v&&setDialog(null)}><DialogContent className="businessdialog">
      {dialog==="employee"&&<FormShell title={form.id?"Personal məlumatlarını redaktə et":"Yeni personal"} desc={form.id?"Ad, vəzifə, e-poçt və firma icazələrini yeniləyin.":"Personal, giriş hesabı və işləyəcəyi firmalar birlikdə təyin ediləcək."}><Field label="Ad və soyad" value={form.name||""} set={v=>setForm({...form,name:v})}/><Field label="Vəzifə" value={form.position||""} set={v=>setForm({...form,position:v})}/><Field label="E-poçt" type="email" value={form.email||""} set={v=>setForm({...form,email:v})}/><label className="field filefield">Şəkil (istəyə bağlı, maks. 5 MB)<Input type="file" accept="image/*" onChange={e=>setEmployeePhoto(e.target.files?.[0]||null)}/>{employeePhoto&&<small>{employeePhoto.name}</small>}</label>{!form.id&&<Field label="Müvəqqəti şifrə (ən az 8 simvol)" type="password" value={form.password||""} set={v=>setForm({...form,password:v})}/>}<div className="fixedcompanies"><b>Bu personal hansı firmalar üzrə tapşırıq ala bilər</b><div>{data.companies.filter(c=>Boolean(c.active)).map(c=>{const selected=new Set((form.companyIds||"").split(",").filter(Boolean));return <label key={c.id}><input type="checkbox" checked={selected.has(String(c.id))} onChange={e=>{const next=new Set(selected);e.target.checked?next.add(String(c.id)):next.delete(String(c.id));setForm({...form,companyIds:[...next].join(",")})}}/><span>✓</span>{c.name}</label>})}</div>{!data.companies.some(c=>Boolean(c.active))&&<small>Əvvəlcə "Firmalar" bölməsindən ən azı bir firma əlavə edin.</small>}</div><Button disabled={uploadingPhoto||(form.id?(!form.name||!form.email):(!form.name||!form.email||(form.password||"").length<8))} onClick={()=>form.id?void saveEmployeeEdit():void createPersonnel()}>{uploadingPhoto?"Şəkil yüklənir...":form.id?"Dəyişiklikləri saxla":"Personalı və giriş hesabını yarat"}</Button></FormShell>}
      {dialog==="company"&&<FormShell title={form.id?"Firma məlumatlarını redaktə et":"Yeni firma"} desc="Firmanın əsas məlumatlarını daxil edin."><Field label="Firmanın adı" value={form.name||""} set={v=>setForm({...form,name:v})}/><Field label="VÖEN" value={form.voen||""} set={v=>setForm({...form,voen:v})}/><Field label="Rəhbər" value={form.manager||""} set={v=>setForm({...form,manager:v})}/><Button disabled={!form.name} onClick={()=>void request(form.id?"PATCH":"POST",{action:"company",id:form.id?Number(form.id):undefined,name:form.name,voen:form.voen||"",manager:form.manager||""})}>{form.id?"Dəyişiklikləri saxla":"Firmanı əlavə et"}</Button></FormShell>}
      {dialog==="evaluate"&&selectedTask&&<FormShell title="İşi yoxla" desc={`${selectedTask.employee_name} • ${selectedTask.title}`}><label className="field">Qiymət (1–5)<select value={form.evaluation||"5"} onChange={e=>setForm({...form,evaluation:e.target.value})}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} bal</option>)}</select></label><TextField label="Rəy / qeyd" value={form.evaluationNote||""} set={v=>setForm({...form,evaluationNote:v})}/><div className="inlineactions">{selectedTask.status==="Təqdim edilib"&&<button className="inlinecancel" disabled={!(form.evaluationNote||"").trim()} onClick={()=>void request("PATCH",{action:"task",id:selectedTask.id,status:"Geri qaytarılıb",evaluationNote:form.evaluationNote||""})}>Geri qaytar</button>}<Button onClick={()=>void request("PATCH",{action:"task",id:selectedTask.id,status:"Təsdiqlənib",evaluation:Number(form.evaluation||5),evaluationNote:form.evaluationNote||""})}>Təsdiqlə və qiymətləndir</Button></div></FormShell>}
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
  return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><small className="sectioneyebrow">GİRİŞ VƏ İCAZƏLƏR</small><h2>İstifadəçilər</h2><p>Yeni hesab yaradın və giriş icazələrini idarə edin</p></div><Button onClick={()=>setOpen(true)}><Plus/>Yeni istifadəçi</Button></div>{error&&<div className="errorbox">{error}</div>}<div className="usercards">{users.map(u=><article key={u.id}><i>{initials(u.name)}</i><div><h3>{u.name}</h3><p>{u.email}</p><small>{u.role==="admin"?"Baş administrator":"İstifadəçi"}</small></div><span className={u.active?"recordstatus active":"recordstatus inactive"}>{u.active?"Aktiv":"Deaktiv"}</span>{u.role!=="admin"&&<button className={u.active?"deactivatebtn":"activatebtn"} onClick={()=>void toggle(u)}>{u.active?"Deaktiv et":"Aktiv et"}</button>}</article>)}</div><Dialog open={open} onOpenChange={setOpen}><DialogContent className="businessdialog"><FormShell title="Yeni istifadəçi" desc="İstifadəçi öz e-poçtu və müvəqqəti şifrəsi ilə daxil olacaq."><Field label="Ad və soyad" value={form.name} set={v=>setForm({...form,name:v})}/><Field label="Vəzifə" value={form.position} set={v=>setForm({...form,position:v})}/><Field label="E-poçt" type="email" value={form.email} set={v=>setForm({...form,email:v})}/><Field label="Müvəqqəti şifrə (ən az 8 simvol)" type="password" value={form.password} set={v=>setForm({...form,password:v})}/><Button disabled={!form.name||!form.email||form.password.length<8} onClick={()=>void create()}>Hesabı yarat</Button></FormShell></DialogContent></Dialog></section>
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

function Dashboard({userName,avatarKey,onEditAvatar,tasks,active,overdue,completed,employees,average,goTasks,evaluationEmployees}:{userName:string;avatarKey:string|null;onEditAvatar:()=>void;tasks:Task[];active:number;overdue:number;completed:number;employees:number;average:string;goTasks:()=>void;evaluationEmployees:Employee[]}){return <><section className="welcome"><div><small>{new Intl.DateTimeFormat("az-AZ",{day:"2-digit",month:"long",year:"numeric"}).format(new Date()).toUpperCase()}</small><h2>Salam, {userName}</h2><p>Bu gün komandanızın iş vəziyyətini buradan izləyə bilərsiniz.</p></div><div className="welcomeaside"><button className={avatarKey?"welcomephotobtn":"welcomephotobtn empty"} title={avatarKey?"Profil şəklini dəyiş":"Profil şəkli əlavə et"} onClick={onEditAvatar}>{avatarKey?<img className="welcomephoto" src={`/api/file?key=${encodeURIComponent(avatarKey)}`} alt={userName}/>:<span className="welcomephoto">{initials(userName)}</span>}</button><Bell/></div></section><EvaluationSection employees={evaluationEmployees} tasks={tasks}/><section className="stats"><Stat icon={<ClipboardList/>} tone="blue" label="Aktiv tapşırıq" value={active}/><Stat icon={<CircleAlert/>} tone="red" label="Gecikən" value={overdue}/><Stat icon={<CheckCircle2/>} tone="green" label="Tamamlanan" value={completed}/><Stat icon={<Users/>} tone="gold" label="Aktiv personal" value={employees}/></section><TrendSection employees={evaluationEmployees} tasks={tasks}/><section className="panel"><div className="head"><div><h3>Son tapşırıqlar</h3><p>Orta qiymət: {average} / 5</p></div><button onClick={goTasks}>Hamısına bax</button></div><TaskTable tasks={tasks.slice(0,8)}/></section></>}
function TrendSection({employees,tasks}:{employees:Employee[];tasks:Task[]}){
  const now=Date.now();
  const rows=employees.map(e=>{
    const own=tasks.filter(t=>t.employee_id===e.id);
    const completed=own.filter(t=>t.status==="Təsdiqlənib").length;
    const late=own.filter(t=>t.status!=="Təsdiqlənib"&&new Date(t.due_at).getTime()<now).length;
    return {id:e.id,name:e.name,total:own.length,completed,late};
  }).filter(r=>r.total>0).sort((a,b)=>b.total-a.total).slice(0,6);
  if(!rows.length)return null;
  const max=Math.max(...rows.map(r=>r.total),1);
  return <section className="panel trendpanel"><div className="head"><div><h3>İş yükü müqayisəsi</h3><p>Personal üzrə tamamlanan və gecikən tapşırıqlar</p></div></div><div className="trendbars">{rows.map(r=><div className="trendrow" key={r.id}><span className="trendname">{r.name}</span><div className="trendtrack"><span className="trendfill done" style={{width:`${(r.completed/max)*100}%`}}/><span className="trendfill late" style={{width:`${(r.late/max)*100}%`,left:`${(r.completed/max)*100}%`}}/></div><span className="trendcount">{r.completed}/{r.total}</span></div>)}</div><div className="trendlegend"><span><i className="dot done"/>Tamamlanan</span><span><i className="dot late"/>Gecikən</span></div></section>;
}
function TasksPage({saving,employeeView,tasks,employees,companies,form,setForm,taskFile,setTaskFile,creating,onNew,onCancel,onCreate,onDelete,onStatus,onEvaluate,dateRequests,onRequestDate,onResolveDateRequest}:{saving:boolean;employeeView:boolean;tasks:Task[];employees:Employee[];companies:Company[];form:Record<string,string>;setForm:React.Dispatch<React.SetStateAction<Record<string,string>>>;taskFile:File|null;setTaskFile:(file:File|null)=>void;creating:boolean;onNew:()=>void;onCancel:()=>void;onCreate:()=>void;onDelete:(t:Task)=>void;onStatus:(t:Task,s:string,extra?:Record<string,unknown>)=>void;onEvaluate:(t:Task)=>void;dateRequests:DateRequest[];onRequestDate:(taskId:number,proposedDueAt:string,reason:string)=>void;onResolveDateRequest:(id:number,approve:boolean,adminNote:string,finalDueAt:string)=>void}){
  const [employeeFilter,setEmployeeFilter]=useState("Hamısı");
  const [companyFilter,setCompanyFilter]=useState("Hamısı");
  const [statusFilter,setStatusFilter]=useState("Hamısı");
  const shown=tasks.filter(t=>(employeeFilter==="Hamısı"||String(t.employee_id)===employeeFilter)&&(companyFilter==="Hamısı"||String(t.company_id)===companyFilter)&&(statusFilter==="Hamısı"||displayStatus(t)===statusFilter));
  const allCompanies=companies.filter(c=>Boolean(c.active));
  const selectedTaskEmployee=employees.find(e=>String(e.id)===String(form.employeeId));
  const allowedCompanyIds=selectedTaskEmployee?new Set((selectedTaskEmployee.company_ids||"").split(",").filter(Boolean).map(Number)):null;
  const activeCompanies=allowedCompanyIds?allCompanies.filter(c=>allowedCompanyIds.has(c.id)):[];
  return <section className="panel pagepanel">
    <div className="pageactions"><div><h2>{employeeView?"Mənim tapşırıqlarım":"Bütün tapşırıqlar"}</h2><p>{shown.length} tapşırıq göstərilir</p></div>{!employeeView&&<label className="filterfield">Personal<select value={employeeFilter} onChange={e=>setEmployeeFilter(e.target.value)}><option>Hamısı</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}<label className="filterfield">Firma<select value={companyFilter} onChange={e=>setCompanyFilter(e.target.value)}><option>Hamısı</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="filterfield">Status<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option>Hamısı</option><option>Yeni</option><option>İcradadır</option><option>Geri qaytarılıb</option><option>Təqdim edilib</option><option>Təsdiqlənib</option><option>Gecikib</option></select></label>{!employeeView&&<Button onClick={onNew}><Plus/>Yeni tapşırıq</Button>}</div>
    {creating&&<div className="inlinetaskrow"><SelectEmployee employees={employees} value={form.employeeId||""} set={v=>setForm({...form,employeeId:v,companyId:""})}/><SelectCompany companies={activeCompanies} value={form.companyId||""} set={v=>setForm({...form,companyId:v})}/>{form.employeeId&&!activeCompanies.length&&<small className="expirednote">Bu personala heç bir firma təyin edilməyib.</small>}<Field label="Tapşırığın adı" value={form.title||""} set={v=>setForm({...form,title:v})}/><Field label="Qısa məlumat" value={form.description||""} set={v=>setForm({...form,description:v})}/><DateTimeField label="Son icra tarixi" value={form.dueAt||""} set={v=>setForm({...form,dueAt:v})}/><label className="field filefield">Əlavə fayl (maks. 25 MB)<Input type="file" onChange={e=>setTaskFile(e.target.files?.[0]||null)}/>{taskFile&&<small>{taskFile.name} • {formatFileSize(taskFile.size)}</small>}</label><div className="inlineactions"><button className="inlinecancel" disabled={saving} onClick={onCancel}>Ləğv et</button><Button disabled={saving||!form.employeeId||!form.companyId||!form.title||!form.dueAt} onClick={onCreate}>{saving?"Yaradılır...":"Tamamla"}</Button></div></div>}
    <TaskGrid tasks={shown} employeeView={employeeView} onStatus={onStatus} onEvaluate={onEvaluate} onDelete={onDelete} dateRequests={dateRequests} onRequestDate={onRequestDate} onResolveDateRequest={onResolveDateRequest}/>
  </section>
}
function PersonalWorksPage({isAdmin,currentUserId,companies}:{isAdmin:boolean;currentUserId:number;companies:Company[]}){
  const [colWidths,setColWidth]=useColumnWidths("personalworks2");
  const resize=useEdgeResize(setColWidth,60);
  const [items,setItems]=useState<PersonalWork[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState<Record<string,string>>({title:"",description:"",companyId:"",dueAt:""});
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState<Record<string,string>>({});
  const [detailItem,setDetailItem]=useState<PersonalWork|null>(null);
  const [checklist,setChecklist]=useState<PersonalWorkChecklistItem[]>([]);
  const [checklistLoading,setChecklistLoading]=useState(false);
  const [checklistTitle,setChecklistTitle]=useState("");
  const [checklistBusy,setChecklistBusy]=useState(false);
  const [checklistError,setChecklistError]=useState("");
  const load=async()=>{setLoading(true);setError("");try{const response=await fetch("/api/personal-works");const body=await response.json();if(!response.ok)throw new Error(body.error);setItems(body.items||[])}catch(e){setError(e instanceof Error?e.message:"Siyahı açıla bilmədi.")}finally{setLoading(false)}};
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
      const response=await fetch("/api/personal-works",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:form.title,description:form.description,companyId:form.companyId||undefined,dueAt:form.dueAt?new Date(form.dueAt).toISOString():undefined,...attachment})});
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
      const response=await fetch("/api/personal-works",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,status:next})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(body.items||[]);
    }catch(e){setError(e instanceof Error?e.message:"İş yenilənmədi.")}
  };
  const remove=async(item:PersonalWork)=>{
    if(!window.confirm(`"${item.title}" işini silmək istəyirsiniz?`))return;
    setError("");
    try{
      const response=await fetch(`/api/personal-works?id=${item.id}`,{method:"DELETE"});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(body.items||[]);
    }catch(e){setError(e instanceof Error?e.message:"İş silinmədi.")}
  };
  const statusTone=(s:string)=>s==="Tamamlanıb"?"done":s==="İcradadır"?"inprogress":"";
  const isOwn=(item:PersonalWork)=>item.user_id===currentUserId;
  const set=(key:string,value:string)=>setSearch(current=>({...current,[key]:value}));
  const has=(value:string|null|undefined,key:string)=>(value||"").toLocaleLowerCase("az-AZ").includes((search[key]||"").toLocaleLowerCase("az-AZ"));
  const filtered=items.filter(i=>has(i.status,"status")&&has(i.company_name,"company")&&has(i.title,"title")&&has(i.description||"—","description")&&has(i.attachment_name||"Sənəd yoxdur","document")&&has(formatDate(i.created_at),"created")&&has(i.due_at?formatDate(i.due_at):"—","due"));
  const headers:Array<[string,string]>=[["status","Status"],["company","Firma"],["title","İş"],["description","Açıqlama"],["document","Əlavə olunan sənəd"],["created","Yaranma tarixi"],["due","Son tarix"]];
  const colDefaults=[120,140,170,220,150,140,150,140];
  const current=detailItem&&items.find(i=>i.id===detailItem.id)||detailItem;
  const currentOwn=Boolean(current&&isOwn(current));
  useEffect(()=>{if(!current){setChecklist([]);setChecklistError("");return}let cancelled=false;setChecklistLoading(true);void fetch(`/api/personal-work-checklist?personalWorkId=${current.id}`).then(r=>r.ok?r.json():{items:[]}).then(body=>{if(!cancelled)setChecklist(body.items||[])}).finally(()=>{if(!cancelled)setChecklistLoading(false)});return()=>{cancelled=true}},[current?.id]);
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
    try{
      const response=await fetch("/api/personal-work-checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,done:!item.done})});
      const body=await response.json();
      if(response.ok)setChecklist(body.items||[]);
    }catch{}
  };
  const removeChecklistItem=async(item:ChecklistLikeItem)=>{
    try{
      const response=await fetch(`/api/personal-work-checklist?id=${item.id}`,{method:"DELETE"});
      const body=await response.json();
      if(response.ok)setChecklist(body.items||[]);
    }catch{}
  };
  const openDetail=(item:PersonalWork)=>setDetailItem(item);
  return <section className="panel pagepanel">
    <div className="pageactions"><div><h2>İşlərim</h2><p>{isAdmin?"Bütün istifadəçilərin öz qeyd etdiyi iş siyahısı":`${filtered.length} iş göstərilir`}</p></div><Button onClick={()=>setCreating(v=>!v)}><Plus/>Yeni iş</Button></div>
    {creating&&<div className="inlinetaskrow personalworkrow"><Field label="İşin adı" value={form.title||""} set={v=>setForm({...form,title:v})}/><SelectCompany companies={companies.filter(c=>Boolean(c.active))} value={form.companyId||""} set={v=>setForm({...form,companyId:v})}/><Field label="Açıqlama (istəyə bağlı)" value={form.description||""} set={v=>setForm({...form,description:v})}/><DateTimeField label="Son tarix (istəyə bağlı)" value={form.dueAt||""} set={v=>setForm({...form,dueAt:v})}/><label className="field filefield">Əlavə fayl (istəyə bağlı, maks. 25 MB)<Input type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/>{file&&<small>{file.name} • {formatFileSize(file.size)}</small>}</label><div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>setCreating(false)}>Ləğv et</button><Button disabled={busy||!form.title.trim()} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable personalworktable"><ColGroup defaults={colDefaults} widths={colWidths}/><thead><tr>{headers.map(([key,label],i)=><th key={key} {...resize(i)}><input aria-label={`${label} üzrə axtarış`} placeholder="Axtar..." value={search[key]||""} onChange={e=>set(key,e.target.value)}/><span>{label}</span></th>)}<th {...resize(headers.length)} className={`opencolumn${resize(headers.length).className?` ${resize(headers.length).className}`:""}`}><span>Əməliyyat</span></th></tr></thead><tbody>{filtered.map(item=><tr key={item.id}><td data-label="Status"><span className={`tablestatus ${statusTone(item.status)}`}>{item.status}</span></td><td data-label="Firma"><b>{item.company_name||"—"}</b></td><td data-label="İş"><button className="taskdetailbtn" onClick={()=>openDetail(item)}>{item.title}</button></td><td data-label="Açıqlama">{item.description||"—"}</td><td data-label="Sənəd">{item.attachment_key?<a className="filelink" href={`/api/file?key=${encodeURIComponent(item.attachment_key)}`}>{item.attachment_name}<small>{formatFileSize(item.attachment_size||0)}</small></a>:<span className="nodocument">Sənəd yoxdur</span>}</td><td data-label="Yaranma tarixi"><time>{formatDate(item.created_at)}</time></td><td data-label="Son tarix">{item.due_at?<time>{formatDate(item.due_at)}</time>:"—"}</td><td data-label="Əməliyyat"><button type="button" className="openbtn" onClick={()=>openDetail(item)}>Aç</button></td></tr>)}</tbody></table>{!filtered.length&&<Empty text={items.length?"Axtarışa uyğun iş tapılmadı.":"Hələ öz işinizi əlavə etməmisiniz."}/>}</div>}
    <Dialog open={Boolean(current)} onOpenChange={v=>!v&&setDetailItem(null)}><DialogContent className="businessdialog">{current&&<FormShell title={current.title} desc={currentOwn?"Öz işim":current.owner_name} formClass="taskdetailform"><div className="taskdetailleft"><div className="taskdetailinfo"><p><b>Açıqlama</b><span>{current.description||"—"}</span></p><p><b>Firma</b><span>{current.company_name||"—"}</span></p><p><b>Yaranma tarixi</b><span>{formatDate(current.created_at)}</span></p><p><b>Son tarix</b><span>{current.due_at?formatDate(current.due_at):"—"}</span></p>{current.attachment_key&&<p><b>Əlavə olunan sənəd</b><span><a className="filelink" href={`/api/file?key=${encodeURIComponent(current.attachment_key)}`}>{current.attachment_name}<small>{formatFileSize(current.attachment_size||0)}</small></a></span></p>}</div><div className="field"><span>Status</span><strong className={`detailstatus ${statusTone(current.status)}`}>{current.status}</strong>{currentOwn&&current.status!=="Tamamlanıb"&&<Button onClick={()=>void advance(current)}>{current.status==="Yeni"?"İcraya al":"Tamamla"}</Button>}</div>{currentOwn&&current.status==="Yeni"&&<button className="deletetaskbtn detaildelete" onClick={()=>{setDetailItem(null);void remove(current)}}>İşi sil</button>}</div><div className="taskdetailright"><ChecklistSection employeeView={currentOwn} checklist={checklist} loading={checklistLoading} title={checklistTitle} setTitle={setChecklistTitle} busy={checklistBusy} error={checklistError} onAdd={()=>void addChecklistItem()} onToggle={item=>void toggleChecklistDone(item)} onRemove={item=>void removeChecklistItem(item)}/></div></FormShell>}</DialogContent></Dialog>
  </section>;
}
function TaskGrid({tasks,employeeView,onStatus,onEvaluate,onDelete,dateRequests,onRequestDate,onResolveDateRequest}:{tasks:Task[];employeeView:boolean;onStatus:(t:Task,s:string,extra?:Record<string,unknown>)=>void;onEvaluate:(t:Task)=>void;onDelete:(t:Task)=>void;dateRequests:DateRequest[];onRequestDate:(taskId:number,proposedDueAt:string,reason:string)=>void;onResolveDateRequest:(id:number,approve:boolean,adminNote:string,finalDueAt:string)=>void}){
  const [colWidths,setColWidth]=useColumnWidths("tasks2");
  const resize=useEdgeResize(setColWidth,60);
  const [search,setSearch]=useState<Record<string,string>>({});
  const [dateOpen,setDateOpen]=useState(false);
  const [dateForm,setDateForm]=useState({proposedDueAt:"",reason:""});
  const [resolveNote,setResolveNote]=useState("");
  const [resolveDate,setResolveDate]=useState("");
  const [detailTask,setDetailTask]=useState<Task|null>(null);
  const [openedAt]=useState(()=>Date.now());
  const [submitFile,setSubmitFile]=useState<File|null>(null);
  const [submitBusy,setSubmitBusy]=useState(false);
  const [submitError,setSubmitError]=useState("");
  const [checklist,setChecklist]=useState<ChecklistItem[]>([]);
  const [checklistLoading,setChecklistLoading]=useState(false);
  const [checklistTitle,setChecklistTitle]=useState("");
  const [checklistBusy,setChecklistBusy]=useState(false);
  const [checklistError,setChecklistError]=useState("");
  const set=(key:string,value:string)=>setSearch(current=>({...current,[key]:value}));
  const has=(value:string|null|undefined,key:string)=>(value||"").toLocaleLowerCase("az-AZ").includes((search[key]||"").toLocaleLowerCase("az-AZ"));
  const hasPendingRequest=(t:Task)=>dateRequests.some(r=>r.task_id===t.id&&r.status==="Gözləyir");
  const rowStatusLabel=(t:Task)=>hasPendingRequest(t)?"Dəyişiklik tələb olunur":displayStatus(t);
  const rowStatusClass=(t:Task)=>hasPendingRequest(t)?"changerequested":statusClass(t);
  const filtered=tasks.filter(t=>has(rowStatusLabel(t),"status")&&has(t.company_name,"company")&&has(t.employee_name,"employee")&&has(t.employee_position,"position")&&has(t.title,"title")&&has(t.description,"description")&&has(t.attachment_name||"Sənəd yoxdur","document")&&has(formatDate(t.created_at),"created")&&has(formatDate(t.due_at),"due")&&has(t.evaluation?`${t.evaluation} bal`:displayStatus(t),"evaluation"));
  const headers:[[string,string],...Array<[string,string]>]=[["status","Status"],["company","Firma"],["employee","Personal"],["position","Vəzifəsi"],["title","Tapşırıq"],["description","Tapşırığın açıqlaması"],["document","Əlavə olunan sənəd"],["created","Yaranma tarixi"],["due","Tapşırığın son tarixi"],["evaluation","Qiymətləndirmə"]];
  const colDefaults=[120,140,150,140,170,220,150,140,150,160,140];
  const current=detailTask&&tasks.find(t=>t.id===detailTask.id)||detailTask;
  useEffect(()=>{if(!current){setChecklist([]);setChecklistError("");return}let cancelled=false;setChecklistLoading(true);void fetch(`/api/checklist?taskId=${current.id}`).then(r=>r.ok?r.json():{items:[]}).then(body=>{if(!cancelled)setChecklist(body.items||[])}).finally(()=>{if(!cancelled)setChecklistLoading(false)});return()=>{cancelled=true}},[current?.id]);
  const nextStatus=current?.status==="Yeni"?"İcradadır":(current?.status==="İcradadır"||current?.status==="Geri qaytarılıb")?"Təqdim edilib":null;
  const expired=Boolean(current&&current.status!=="Geri qaytarılıb"&&new Date(current.due_at).getTime()<=openedAt);
  const needsSubmissionFile=Boolean(current&&current.attachment_key&&!current.submission_attachment_key);
  const openDetail=(t:Task)=>{setSubmitFile(null);setSubmitError("");setDateOpen(false);setDateForm({proposedDueAt:"",reason:""});setResolveNote("");setResolveDate("");setDetailTask(t)};
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
  return <><div className="tasktablewrap"><table className="tasktable"><ColGroup defaults={colDefaults} widths={colWidths}/><thead><tr>{headers.map(([key,label],i)=><th key={key} {...resize(i)}><input aria-label={`${label} üzrə axtarış`} placeholder="Axtar..." value={search[key]||""} onChange={e=>set(key,e.target.value)}/><span>{label}</span></th>)}<th {...resize(headers.length)} className={`opencolumn${resize(headers.length).className?` ${resize(headers.length).className}`:""}`}><span>Əməliyyat</span></th></tr></thead><tbody>{filtered.map(t=>{const rowExpired=new Date(t.due_at).getTime()<=openedAt;return <tr key={t.id}><td data-label="Status"><button className={`tablestatus statusopen ${rowStatusClass(t)}`} onClick={()=>openDetail(t)}>{rowStatusLabel(t)}</button></td><td data-label="Firma"><b>{t.company_name||"—"}</b></td><td data-label="Personal">{t.employee_name}</td><td data-label="Vəzifəsi">{t.employee_position}</td><td data-label="Tapşırıq"><button className="taskdetailbtn" onClick={()=>openDetail(t)}>{t.title}</button></td><td data-label="Açıqlama">{t.description||"—"}</td><td data-label="Sənəd">{t.attachment_key?<a className="filelink" href={`/api/file?key=${encodeURIComponent(t.attachment_key)}`}>{t.attachment_name}<small>{formatFileSize(t.attachment_size||0)}</small></a>:<span className="nodocument">Sənəd yoxdur</span>}</td><td data-label="Yaranma tarixi"><time>{formatDate(t.created_at)}</time></td><td data-label="Son tarix"><time>{formatDate(t.due_at)}</time>{employeeView&&rowExpired&&<small className="expirednote">Müddət bitib</small>}</td><td data-label="Qiymətləndirmə"><div className="tableactions"><RatingCell evaluation={t.evaluation} note={t.evaluation_note} compact/>{!employeeView&&(t.status==="Təqdim edilib"||t.status==="Təsdiqlənib")?<button className="evaluatebtn" onClick={()=>onEvaluate(t)}>{t.evaluation?"Qiyməti dəyiş":"Qiymətləndir"}</button>:!t.evaluation&&!t.evaluation_note&&<span>—</span>}{!employeeView&&t.status==="Yeni"&&<button className="deletetaskbtn" onClick={()=>onDelete(t)}>Sil</button>}</div></td><td data-label="Əməliyyat"><button type="button" className="openbtn" onClick={()=>openDetail(t)}>Aç</button></td></tr>})}</tbody></table>{!filtered.length&&<Empty text={tasks.length?"Axtarışa uyğun tapşırıq tapılmadı.":"Hələ tapşırıq yaradılmayıb."}/>}</div>
    <Dialog open={Boolean(current)} onOpenChange={v=>!v&&setDetailTask(null)}><DialogContent className="businessdialog">{current&&<FormShell title={current.title} desc={`${current.employee_name} • ${current.company_name||"Firma qeyd edilməyib"}`} formClass="taskdetailform"><div className="taskdetailleft"><div className="taskdetailinfo"><p><b>Tapşırıq</b><span>{current.description||"—"}</span></p><p><b>Yaranma tarixi</b><span>{formatDate(current.created_at)}</span></p><p><b>Son icra tarixi</b><span>{formatDate(current.due_at)}{current.original_due_at&&current.original_due_at!==current.due_at&&<small className="daterequestnote"> (ilkin tarix: {formatDate(current.original_due_at)})</small>}</span></p>{current.attachment_key&&<p><b>Tapşırıqla göndərilən fayl</b><span><a className="filelink" href={`/api/file?key=${encodeURIComponent(current.attachment_key)}`}>{current.attachment_name}<small>{formatFileSize(current.attachment_size||0)}</small></a></span></p>}{current.submission_attachment_key&&<p><b>İşlənib təqdim olunan fayl</b><span><a className="filelink" href={`/api/file?key=${encodeURIComponent(current.submission_attachment_key)}`}>{current.submission_attachment_name}<small>{formatFileSize(current.submission_attachment_size||0)}</small></a></span></p>}</div>{employeeView?<div className="field"><span>Status</span><strong className={`detailstatus ${pendingRequest?"changerequested":statusClass(current)}`}>{pendingRequest?"Dəyişiklik tələb olunur":displayStatus(current)}</strong><RatingCell evaluation={current.evaluation} note={current.evaluation_note}/>{nextStatus&&!expired&&Number(current.employee_status_changed)<2&&<>{nextStatus==="Təqdim edilib"&&<label className="field filefield">İşlənmiş fayl{needsSubmissionFile?" (mütləqdir)":" (istəyə bağlı)"}<Input type="file" onChange={e=>setSubmitFile(e.target.files?.[0]||null)}/>{submitFile&&<small>{submitFile.name} • {formatFileSize(submitFile.size)}</small>}</label>}{submitError&&<div className="errorbox">{submitError}</div>}<Button disabled={submitBusy} onClick={()=>nextStatus==="İcradadır"?(onStatus(current,nextStatus),setDetailTask({...current,status:nextStatus,employee_status_changed:Number(current.employee_status_changed)+1})):void submitTask()}>{submitBusy?"Göndərilir...":nextStatus==="İcradadır"?"İcraya al":"Təqdim et"}</Button></>}</div>:<div className="field"><span>Status</span><strong className={`detailstatus ${pendingRequest?"changerequested":statusClass(current)}`}>{pendingRequest?"Dəyişiklik tələb olunur":displayStatus(current)}</strong><RatingCell evaluation={current.evaluation} note={current.evaluation_note}/></div>}<DateRequestSection employeeView={employeeView} current={current} pendingRequest={pendingRequest} taskRequest={taskRequest} dateOpen={dateOpen} setDateOpen={setDateOpen} dateForm={dateForm} setDateForm={setDateForm} onSubmit={submitDateRequest} resolveNote={resolveNote} setResolveNote={setResolveNote} resolveDate={resolveDate} setResolveDate={setResolveDate} onResolve={resolveDateRequest}/>{employeeView&&expired&&<small className="expirednote">Müddət bitdiyi üçün status dəyişdirilə bilməz.</small>}{!employeeView&&(current.status==="Təqdim edilib"||current.status==="Təsdiqlənib")&&<Button onClick={()=>onEvaluate(current)}>{current.evaluation?"Qiyməti dəyiş":"Qiymətləndir"}</Button>}{!employeeView&&current.status==="Yeni"&&<button className="deletetaskbtn detaildelete" onClick={()=>{setDetailTask(null);onDelete(current)}}>Tapşırığı sil</button>}</div><div className="taskdetailright"><ChecklistSection employeeView={employeeView} checklist={checklist} loading={checklistLoading} title={checklistTitle} setTitle={setChecklistTitle} busy={checklistBusy} error={checklistError} onAdd={()=>void addChecklistItem()} onToggle={item=>void toggleChecklistDone(item)} onRemove={item=>void removeChecklistItem(item)}/></div></FormShell>}</DialogContent></Dialog>
  </>
}
function EmployeesPage({employees,tasks,onNew,onEdit,onView,onDelete}:{employees:Employee[];tasks:Task[];onNew:()=>void;onEdit:(e:Employee)=>void;onView:(e:Employee)=>void;onToggle:(e:Employee)=>void;onDelete:(e:Employee)=>void}){
  const [accounts,setAccounts]=useState<ManagedUser[]>([]);const [reset,setReset]=useState<ManagedUser|null>(null);const [password,setPassword]=useState("");const [error,setError]=useState("");
  const loadAccounts=async()=>{const response=await fetch("/api/users");const body=await response.json();if(response.ok)setAccounts(body.users||[])};
  useEffect(()=>{void loadAccounts()},[]);
  const toggle=async(account:ManagedUser)=>{const response=await fetch("/api/users",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:account.id,active:!Boolean(account.active)})});const body=await response.json();if(response.ok){setAccounts(body.users);location.reload()}else setError(body.error)};
  const savePassword=async()=>{if(!reset)return;const response=await fetch("/api/users",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:reset.id,password})});const body=await response.json();if(!response.ok){setError(body.error);return}setAccounts(body.users);setReset(null);setPassword("")};
  return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><span className="sectioneyebrow">PERSONAL VƏ GİRİŞ HESABLARI</span><h2>Personal reyestri</h2><p>Personal məlumatları və proqrama giriş icazələri vahid bölmədə idarə olunur</p></div><Button onClick={onNew}><Plus/>Yeni personal</Button></div>{error&&<div className="errorbox">{error}</div>}<div className="employeecards officialcards">{employees.length?employees.map(e=>{const own=tasks.filter(t=>t.employee_id===e.id);const done=own.filter(t=>t.status==="Təsdiqlənib");const activeCount=own.filter(t=>t.status!=="Təsdiqlənib").length;const rated=done.filter(t=>t.evaluation);const avg=rated.length?(rated.reduce((s,t)=>s+(t.evaluation||0),0)/rated.length).toFixed(1):"—";const account=accounts.find(a=>a.employee_id===e.id);const active=account?Boolean(account.active):Boolean(e.active);return <article key={e.id} className={!active?"inactivecard":""}><div className="identityblock"><i className={e.avatar_key?"hasphoto":""}>{e.avatar_key?<img src={`/api/file?key=${encodeURIComponent(e.avatar_key)}`} alt={e.name}/>:initials(e.name)}</i><div><div className="identitytitle"><h3>{e.name}</h3><span className={active?"recordstatus active":"recordstatus inactive"}>{active?"Aktiv":"Deaktiv"}</span></div><p><b>Vəzifə:</b> {e.position}</p><p><b>E-poçt və giriş adı:</b> {e.email||"Qeyd edilməyib"}</p><p><b>Giriş hesabı:</b> {account?"Yaradılıb":"Yaradılmayıb"}</p></div></div><div className="recordmetrics"><span><small>Ümumi tapşırıq</small><b>{own.length}</b></span><span><small>İcrada</small><b>{activeCount}</b></span><span><small>Tamamlanıb</small><b>{done.length}</b></span><span><small>Orta qiymət</small><b>{avg}</b></span></div><div className="employeeactions recordactions"><button className="editcompanybtn" onClick={()=>onEdit(e)}>Redaktə et</button>{active&&<button className="viewasbtn" onClick={()=>onView(e)}>Personal görünüşü</button>}{account&&<button className="editcompanybtn" onClick={()=>{setReset(account);setPassword("")}}>Şifrəni yenilə</button>}{account&&<button className={active?"deactivatebtn":"activatebtn"} onClick={()=>{if(!active||window.confirm(`${e.name} adlı personalı deaktiv etmək istəyirsiniz?`))void toggle(account)}}>{active?"Deaktiv et":"Aktiv et"}</button>}{!active&&own.length===0&&<button className="deleteworkerbtn" onClick={()=>onDelete(e)}>Sil</button>}</div></article>}):<Empty text="İlk personalı əlavə edin."/>}</div><Dialog open={Boolean(reset)} onOpenChange={v=>!v&&setReset(null)}><DialogContent className="businessdialog">{reset&&<FormShell title="Personalın şifrəsini yenilə" desc={`${reset.name} üçün yeni müvəqqəti şifrə təyin edin.`}><Field label="Yeni şifrə (ən az 8 simvol)" type="password" value={password} set={setPassword}/><Button disabled={password.length<8} onClick={()=>void savePassword()}>Şifrəni yenilə</Button></FormShell>}</DialogContent></Dialog></section>
}
function CompaniesPage({companies,tasks,onNew,onEdit,onToggle}:{companies:Company[];tasks:Task[];onNew:()=>void;onEdit:(c:Company)=>void;onToggle:(c:Company)=>void}){return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><span className="sectioneyebrow">TƏŞKİLATİ MƏLUMATLAR</span><h2>Firmalar reyestri</h2><p>Tapşırıqların aid olduğu hüquqi şəxslər və əsas rekvizitlər</p></div><Button onClick={onNew}><Plus/>Yeni firma</Button></div><div className="companylist officialcards">{companies.length?companies.map(c=>{const own=tasks.filter(t=>t.company_id===c.id);const activeCount=own.filter(t=>t.status!=="Təsdiqlənib").length;const completed=own.filter(t=>t.status==="Təsdiqlənib").length;return <article key={c.id} className={!c.active?"inactivecard":""}><div className="identityblock companyidentity"><i><Building2/></i><div><div className="identitytitle"><h3>{c.name}</h3><span className={c.active?"recordstatus active":"recordstatus inactive"}>{c.active?"Aktiv":"Deaktiv"}</span></div><p><b>VÖEN:</b> {c.voen||"Qeyd edilməyib"}</p><p><b>Rəhbər:</b> {c.manager||"Qeyd edilməyib"}</p></div></div><div className="recordmetrics companymetrics"><span><small>Ümumi tapşırıq</small><b>{own.length}</b></span><span><small>Aktiv iş</small><b>{activeCount}</b></span><span><small>Tamamlanıb</small><b>{completed}</b></span></div><div className="companyactions recordactions"><button className="editcompanybtn" onClick={()=>onEdit(c)}>Məlumatları redaktə et</button><button className={c.active?"deactivatebtn":"activatebtn"} onClick={()=>onToggle(c)}>{c.active?"Deaktiv et":"Aktiv et"}</button></div></article>}):<Empty text="İlk firmanı əlavə edin."/>}</div></section>}
function CustomersPage(){
  const [colWidths,setColWidth]=useColumnWidths("customers2");
  const resize=useEdgeResize(setColWidth,60);
  const [items,setItems]=useState<Customer[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [editingId,setEditingId]=useState<number|null>(null);
  const [editForm,setEditForm]=useState<Record<string,string>>({});
  const [editBusy,setEditBusy]=useState(false);
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
  const fields=(values:Record<string,string>,set:(next:Record<string,string>)=>void)=>{
    const rule=voenRule(values.entityType||"");
    return <>
    <label className="field statusfield">Statusu<select value={values.entityType||""} onChange={e=>set({...values,entityType:e.target.value,voen:sanitizeVoen(values.voen||"",e.target.value)})}><option value="">Seçin</option>{entityTypeOptions.map(o=><option key={o} value={o}>{o}</option>)}</select></label>
    <label className="field voenfield">VÖEN{rule&&<small className="voenhint">{rule.hint}</small>}<Input value={values.voen||""} maxLength={rule?.length} onChange={e=>set({...values,voen:sanitizeVoen(e.target.value,values.entityType||"")})}/></label>
    <label className="field">Müştərinin adı<Input value={values.name||""} onChange={e=>set({...values,name:e.target.value})}/></label>
    <label className="field addressfield">Hüquqi ünvan<Input value={values.legalAddress||""} onChange={e=>set({...values,legalAddress:e.target.value})} onBlur={e=>set({...values,legalAddress:properCase(e.target.value)})}/></label>
    <label className="field">Rəhbər<Input value={values.manager||""} onChange={e=>set({...values,manager:e.target.value})} onBlur={e=>set({...values,manager:properCase(e.target.value)})}/></label>
  </>;
  };
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>Müştəri siyahısı</h2><p>Müştərilərin əsas rekvizitləri</p></div><Button onClick={()=>setCreating(v=>!v)}><Plus/>Yeni müştəri</Button></div>
    {creating&&<div className="inlinetaskrow documentrow customerrow">{fields(form,setForm)}<div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>{setCreating(false);setForm({})}}>Ləğv et</button><Button disabled={busy||!requiredFilled(form)} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable documenttable customertable"><ColGroup defaults={[130,100,200,340,160,140]} widths={colWidths}/><thead><tr><th {...resize(0)}><span>Statusu</span></th><th {...resize(1)}><span>VÖEN</span></th><th {...resize(2)}><span>Müştərinin adı</span></th><th {...resize(3)}><span>Hüquqi ünvan</span></th><th {...resize(4)}><span>Rəhbər</span></th><th {...resize(5)} className={`opencolumn${resize(5).className?` ${resize(5).className}`:""}`}><span>Əməliyyat</span></th></tr></thead><tbody>{items.map(item=>editingId===item.id?<tr key={item.id}><td colSpan={6}><div className="inlinetaskrow documentrow customerrow documenteditrow">{fields(editForm,setEditForm)}<div className="inlineactions"><button className="inlinecancel" disabled={editBusy} onClick={cancelEdit}>Ləğv et</button><Button disabled={editBusy||!requiredFilled(editForm)} onClick={()=>void saveEdit(item.id)}>{editBusy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div></td></tr>:<tr key={item.id}>
      <td data-label="Statusu">{item.entity_type||"—"}</td>
      <td data-label="VÖEN">{item.voen||"—"}</td>
      <td data-label="Müştərinin adı"><b>{item.name}</b></td>
      <td data-label="Hüquqi ünvan">{item.legal_address||"—"}</td>
      <td data-label="Rəhbər">{item.manager||"—"}</td>
      <td data-label="Əməliyyat"><div className="tableactions"><button className="editcompanybtn" onClick={()=>startEdit(item)}>Redaktə et</button><button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button></div></td>
    </tr>)}</tbody></table>{!items.length&&<Empty text="Hələ müştəri əlavə edilməyib."/>}</div>}
  </section>;
}
function AuditPage(){
  const [items,setItems]=useState<AuditItem[]>([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  useEffect(()=>{void(async()=>{try{const response=await fetch("/api/audit");const body=await response.json();if(!response.ok)throw new Error(body.error);setItems(body.items||[])}catch(e){setError(e instanceof Error?e.message:"Tarixçə yüklənmədi.")}finally{setLoading(false)}})()},[]);
  return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><span className="sectioneyebrow">ADMİN ƏMƏLİYYATLARI</span><h2>Tarixçə</h2><p>Son admin əməliyyatları xronoloji ardıcıllıqla</p></div></div>{error&&<div className="errorbox">{error}</div>}{loading?<div className="loading">Tarixçə yüklənir...</div>:<div className="auditlist">{items.length?items.map(item=><article key={item.id}><b>{formatDate(item.created_at)}</b><span>{item.actor_name}</span><span>{item.action}</span><span>{item.target_label||"—"}</span></article>):<Empty text="Hələ qeyd yoxdur."/>}</div>}</section>
}
function DocumentsPage({isAdmin}:{isAdmin:boolean}){
  const [colWidths,setColWidth]=useColumnWidths("templates2");
  const resize=useEdgeResize(setColWidth,60);
  const [items,setItems]=useState<DocumentTemplate[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [creating,setCreating]=useState(false);
  const [name,setName]=useState("");
  const [file1,setFile1]=useState<File|null>(null);
  const [file2,setFile2]=useState<File|null>(null);
  const [file3,setFile3]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [editingId,setEditingId]=useState<number|null>(null);
  const [editName,setEditName]=useState("");
  const [editFile1,setEditFile1]=useState<File|null>(null);
  const [editFile2,setEditFile2]=useState<File|null>(null);
  const [editFile3,setEditFile3]=useState<File|null>(null);
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
      const body:Record<string,unknown>={name};
      if(file1){const uploaded=await uploadFile(file1);body.template1Key=uploaded.key;body.template1Name=uploaded.name;body.template1Size=uploaded.size;body.template1Type=uploaded.type}
      if(file2){const uploaded=await uploadFile(file2);body.template2Key=uploaded.key;body.template2Name=uploaded.name;body.template2Size=uploaded.size;body.template2Type=uploaded.type}
      if(file3){const uploaded=await uploadFile(file3);body.template3Key=uploaded.key;body.template3Name=uploaded.name;body.template3Size=uploaded.size;body.template3Type=uploaded.type}
      const response=await fetch("/api/documents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setName("");setFile1(null);setFile2(null);setFile3(null);setCreating(false);
    }catch(e){setError(e instanceof Error?e.message:"Sənəd əlavə olunmadı.")}
    finally{setBusy(false)}
  };
  const startEdit=(item:DocumentTemplate)=>{setEditingId(item.id);setEditName(item.name);setEditFile1(null);setEditFile2(null);setEditFile3(null)};
  const cancelEdit=()=>{setEditingId(null);setEditFile1(null);setEditFile2(null);setEditFile3(null)};
  const saveEdit=async(item:DocumentTemplate)=>{
    setEditBusy(true);setError("");
    try{
      const body:Record<string,unknown>={id:item.id,name:editName};
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
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>Sənədlər</h2><p>Sənəd adları və şablonları (3 versiyada)</p></div>{isAdmin&&<Button onClick={()=>setCreating(v=>!v)}><Plus/>Yeni sənəd</Button>}</div>
    {creating&&<div className="inlinetaskrow documentrow"><Field label="Sənədin adı" value={name} set={setName}/><label className="field filefield">{templateLabel(1)}<Input type="file" onChange={e=>setFile1(e.target.files?.[0]||null)}/>{file1&&<small>{file1.name} • {formatFileSize(file1.size)}</small>}</label><label className="field filefield">{templateLabel(2)}<Input type="file" onChange={e=>setFile2(e.target.files?.[0]||null)}/>{file2&&<small>{file2.name} • {formatFileSize(file2.size)}</small>}</label><label className="field filefield">{templateLabel(3)}<Input type="file" onChange={e=>setFile3(e.target.files?.[0]||null)}/>{file3&&<small>{file3.name} • {formatFileSize(file3.size)}</small>}</label><div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>setCreating(false)}>Ləğv et</button><Button disabled={busy||!name.trim()} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable documenttable"><ColGroup defaults={isAdmin?[240,220,220,220,140]:[240,220,220,220]} widths={colWidths}/><thead><tr><th {...resize(0)}><span>Sənədin adı</span></th><th {...resize(1)}>{templateLabel(1)}</th><th {...resize(2)}>{templateLabel(2)}</th><th {...resize(3)}>{templateLabel(3)}</th>{isAdmin&&<th {...resize(4)} className={`opencolumn${resize(4).className?` ${resize(4).className}`:""}`}><span>Əməliyyat</span></th>}</tr></thead><tbody>{items.map(item=>editingId===item.id?<tr key={item.id}><td colSpan={isAdmin?5:4}><div className="inlinetaskrow documentrow documenteditrow"><Field label="Sənədin adı" value={editName} set={setEditName}/><label className="field filefield">{templateLabel(1)} (əvəz etmək üçün seçin){item.template1_name&&<small>Hazırkı: {item.template1_name}</small>}<Input type="file" onChange={e=>setEditFile1(e.target.files?.[0]||null)}/>{editFile1&&<small>{editFile1.name} • {formatFileSize(editFile1.size)}</small>}</label><label className="field filefield">{templateLabel(2)} (əvəz etmək üçün seçin){item.template2_name&&<small>Hazırkı: {item.template2_name}</small>}<Input type="file" onChange={e=>setEditFile2(e.target.files?.[0]||null)}/>{editFile2&&<small>{editFile2.name} • {formatFileSize(editFile2.size)}</small>}</label><label className="field filefield">{templateLabel(3)} (əvəz etmək üçün seçin){item.template3_name&&<small>Hazırkı: {item.template3_name}</small>}<Input type="file" onChange={e=>setEditFile3(e.target.files?.[0]||null)}/>{editFile3&&<small>{editFile3.name} • {formatFileSize(editFile3.size)}</small>}</label><div className="inlineactions"><button className="inlinecancel" disabled={editBusy} onClick={cancelEdit}>Ləğv et</button><Button disabled={editBusy||!editName.trim()} onClick={()=>void saveEdit(item)}>{editBusy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div></td></tr>:<tr key={item.id}><td data-label="Sənədin adı"><b>{item.name}</b></td><td data-label="Sənədin şablonu 1">{templateLink(item.template1_key,item.template1_name,item.template1_size)}</td><td data-label="Sənədin şablonu 2">{templateLink(item.template2_key,item.template2_name,item.template2_size)}</td><td data-label="Sənədin şablonu 3">{templateLink(item.template3_key,item.template3_name,item.template3_size)}</td>{isAdmin&&<td data-label="Əməliyyat"><div className="tableactions"><button className="editcompanybtn" onClick={()=>startEdit(item)}>Redaktə et</button><button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button></div></td>}</tr>)}</tbody></table>{!items.length&&<Empty text="Hələ sənəd əlavə edilməyib."/>}</div>}
  </section>;
}
function OutgoingDocumentsPage({isAdmin}:{isAdmin:boolean}){
  const [colWidths,setColWidth]=useColumnWidths("outgoing2");
  const resize=useEdgeResize(setColWidth,60);
  const [items,setItems]=useState<OutgoingDocument[]>([]);
  const [templates,setTemplates]=useState<DocumentTemplate[]>([]);
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
  const load=async()=>{setLoading(true);setError("");try{const [outgoingResponse,templateResponse]=await Promise.all([fetch("/api/documents/outgoing"),fetch("/api/documents")]);const outgoingBody=await outgoingResponse.json();if(!outgoingResponse.ok)throw new Error(outgoingBody.error);setItems(outgoingBody.items||[]);const templateBody=await templateResponse.json();if(templateResponse.ok)setTemplates(templateBody.items||[])}catch(e){setError(e instanceof Error?e.message:"Siyahı açıla bilmədi.")}finally{setLoading(false)}};
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
    if(!(form.outgoingNo||"").trim())return;
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
  const startEdit=(item:OutgoingDocument)=>{setEditingId(item.id);setEditFile(null);setEditForm({outgoingNo:item.outgoing_no||"",outgoingDate:item.outgoing_date||"",incomingNo:item.incoming_no||"",incomingDate:item.incoming_date||"",sendingDepartment:item.sending_department||"",documentType:item.document_type||"",sendingMethod:item.sending_method||"",deliveredBy:item.delivered_by||"",copies:item.copies||"",documentNumber:item.document_number||"",documentDate:item.document_date||"",voen:item.voen||"",organizationName:item.organization_name||"",phone:item.phone||"",note:item.note||""})};
  const cancelEdit=()=>{setEditingId(null);setEditForm({});setEditFile(null)};
  const saveEdit=async(id:number)=>{
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
  const fields=(values:Record<string,string>,set:(next:Record<string,string>)=>void)=><>
    <Field label="Çıxış No" value={values.outgoingNo||""} set={v=>set({...values,outgoingNo:v})}/>
    <Field label="Çıxış tarixi" type="date" value={values.outgoingDate||""} set={v=>set({...values,outgoingDate:v})}/>
    <Field label="Daxil olma No" value={values.incomingNo||""} set={v=>set({...values,incomingNo:v})}/>
    <Field label="Daxil olma tarixi" type="date" value={values.incomingDate||""} set={v=>set({...values,incomingDate:v})}/>
    <Field label="Göndərən şöbə" value={values.sendingDepartment||""} set={v=>set({...values,sendingDepartment:v})}/>
    <label className="field">Sənədin tipi<Input list="documentTypeOptions" value={values.documentType||""} onChange={e=>set({...values,documentType:e.target.value})}/></label>
    <label className="field">Göndərilmə Şəkli<select value={values.sendingMethod||""} onChange={e=>set({...values,sendingMethod:e.target.value})}><option value="">Seçin</option>{sendingMethodOptions.map(o=><option key={o} value={o}>{o}</option>)}</select></label>
    <Field label="Sənədi Götürən Şəxs" value={values.deliveredBy||""} set={v=>set({...values,deliveredBy:v})}/>
    <label className="field">Sənədin nüsxəsi<select value={values.copies||""} onChange={e=>set({...values,copies:e.target.value})}><option value="">Seçin</option>{copiesOptions.map(o=><option key={o} value={o}>{o}</option>)}</select></label>
    <Field label="Sənədin Nömrəsi" value={values.documentNumber||""} set={v=>set({...values,documentNumber:v})}/>
    <Field label="Sənədin tarixi" type="date" value={values.documentDate||""} set={v=>set({...values,documentDate:v})}/>
    <Field label="Voeni" value={values.voen||""} set={v=>set({...values,voen:v})}/>
    <Field label="Təşkilatın adı" value={values.organizationName||""} set={v=>set({...values,organizationName:v})}/>
    <Field label="Müştərinin Telefonu" value={values.phone||""} set={v=>set({...values,phone:v})}/>
    <Field label="Əlavə Qeydlər" value={values.note||""} set={v=>set({...values,note:v})}/>
  </>;
  const templateAndFileBlock=(values:Record<string,string>,fileValue:File|null,setFileValue:(f:File|null)=>void)=>{
    const matched=values.documentType?templateFor(values.documentType):undefined;
    const templateLinks=matched?[{n:1,key:matched.template1_key,name:matched.template1_name},{n:2,key:matched.template2_key,name:matched.template2_name},{n:3,key:matched.template3_key,name:matched.template3_name}].filter(t=>t.key):[];
    return <>
      {templateLinks.length>0&&<div className="templateusepanel"><b>Şablondan istifadə et</b><p>Şablonu yükləyib doldurun, sonra aşağıdan hazır sənədi əlavə edin.</p><div className="templateuselinks">{templateLinks.map(t=><a key={t.n} className="filelink" href={`/api/file?key=${encodeURIComponent(t.key as string)}`} target="_blank" rel="noreferrer">{t.name||`Şablon ${t.n}`}</a>)}</div></div>}
      <label className="field filefield">Doldurulmuş sənəd (istəyə bağlı)<Input type="file" onChange={e=>setFileValue(e.target.files?.[0]||null)}/>{fileValue&&<small>{fileValue.name} • {formatFileSize(fileValue.size)}</small>}</label>
    </>;
  };
  return <section className="panel pagepanel directorypanel">
    <datalist id="documentTypeOptions">{templates.map(t=><option key={t.id} value={t.name}/>)}</datalist>
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>Çıxan Sənədlər</h2><p>Təşkilatdan göndərilən sənədlərin qeydiyyatı</p></div>{isAdmin&&<Button onClick={()=>setCreating(v=>!v)}><Plus/>Yeni sənəd</Button>}</div>
    {creating&&<div className="inlinetaskrow documentrow outgoingrow">{fields(form,setForm)}{templateAndFileBlock(form,newFile,setNewFile)}<div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>{setCreating(false);setForm({});setNewFile(null)}}>Ləğv et</button><Button disabled={busy||!(form.outgoingNo||"").trim()} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable documenttable"><ColGroup defaults={isAdmin?[110,110,130,130,150,130,140,160,110,130,110,100,170,140,180,150,140]:[110,110,130,130,150,130,140,160,110,130,110,100,170,140,180,150]} widths={colWidths}/><thead><tr><th {...resize(0)}><span>Çıxış No</span></th><th {...resize(1)}><span>Çıxış tarixi</span></th><th {...resize(2)}><span>Daxil olma No</span></th><th {...resize(3)}><span>Daxil olma tarixi</span></th><th {...resize(4)}><span>Göndərən şöbə</span></th><th {...resize(5)}><span>Sənədin tipi</span></th><th {...resize(6)}><span>Göndərilmə Şəkli</span></th><th {...resize(7)}><span>Sənədi Götürən Şəxs</span></th><th {...resize(8)}><span>Sənədin nüsxəsi</span></th><th {...resize(9)}><span>Sənədin Nömrəsi</span></th><th {...resize(10)}><span>Sənədin tarixi</span></th><th {...resize(11)}><span>Voeni</span></th><th {...resize(12)}><span>Təşkilatın adı</span></th><th {...resize(13)}><span>Müştərinin Telefonu</span></th><th {...resize(14)}><span>Əlavə Qeydlər</span></th><th {...resize(15)}><span>Sənəd faylı</span></th>{isAdmin&&<th {...resize(16)} className={`opencolumn${resize(16).className?` ${resize(16).className}`:""}`}><span>Əməliyyat</span></th>}</tr></thead><tbody>{items.map(item=>editingId===item.id?<tr key={item.id}><td colSpan={isAdmin?17:16}><div className="inlinetaskrow documentrow outgoingrow documenteditrow">{fields(editForm,setEditForm)}{templateAndFileBlock(editForm,editFile,setEditFile)}<div className="inlineactions"><button className="inlinecancel" disabled={editBusy} onClick={cancelEdit}>Ləğv et</button><Button disabled={editBusy||!(editForm.outgoingNo||"").trim()} onClick={()=>void saveEdit(item.id)}>{editBusy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div></td></tr>:<tr key={item.id}>
      <td data-label="Çıxış No"><b>{item.outgoing_no}</b></td>
      <td data-label="Çıxış tarixi">{formatDateOnly(item.outgoing_date)}</td>
      <td data-label="Daxil olma No">{item.incoming_no||"—"}</td>
      <td data-label="Daxil olma tarixi">{formatDateOnly(item.incoming_date)}</td>
      <td data-label="Göndərən şöbə">{item.sending_department||"—"}</td>
      <td data-label="Sənədin tipi">{item.document_type||"—"}</td>
      <td data-label="Göndərilmə Şəkli">{item.sending_method||"—"}</td>
      <td data-label="Sənədi Götürən Şəxs">{item.delivered_by||"—"}</td>
      <td data-label="Sənədin nüsxəsi">{item.copies||"—"}</td>
      <td data-label="Sənədin Nömrəsi">{item.document_number||"—"}</td>
      <td data-label="Sənədin tarixi">{formatDateOnly(item.document_date)}</td>
      <td data-label="Voeni">{item.voen||"—"}</td>
      <td data-label="Təşkilatın adı">{item.organization_name||"—"}</td>
      <td data-label="Müştərinin Telefonu">{item.phone||"—"}</td>
      <td data-label="Əlavə Qeydlər">{item.note||"—"}</td>
      <td data-label="Sənəd faylı">{item.attachment_key?<a className="filelink" href={`/api/file?key=${encodeURIComponent(item.attachment_key)}`} target="_blank" rel="noreferrer">{item.attachment_name||"Fayl"}<small>{formatFileSize(item.attachment_size||0)}</small></a>:<span className="nodocument">Yoxdur</span>}</td>
      {isAdmin&&<td data-label="Əməliyyat"><div className="tableactions"><button className="editcompanybtn" onClick={()=>startEdit(item)}>Redaktə et</button><button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button></div></td>}
    </tr>)}</tbody></table>{!items.length&&<Empty text="Hələ çıxan sənəd qeydə alınmayıb."/>}</div>}
  </section>;
}
function PlaceholderPage({title,text}:{title:string;text:string}){
  return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>{title}</h2><p>Bu bölmə hazırlanma mərhələsindədir</p></div></div><Empty text={text}/></section>;
}
function WorkList({employeeView,tab,frequency,items,assignments,employees,companies,form,setForm,onAdd,onFrequency,onAssign,onCatalogAssign,onComplete}:{employeeView:boolean;tab:"catalog"|"assignments";frequency:"monthly"|"weekly";items:WorkItem[];assignments:WorkAssignment[];employees:Employee[];companies:Company[];form:Record<string,string>;setForm:React.Dispatch<React.SetStateAction<Record<string,string>>>;onAdd:()=>void;onFrequency:(item:WorkItem,frequency:"monthly"|"weekly"|"daily")=>void;onAssign:()=>void;onCatalogAssign:(workDefinitionId:number,companyId:number,employeeId:number)=>void;onComplete:(assignmentId:number)=>void}){const [creating,setCreating]=useState(false);const [catalogCompanyFilter,setCatalogCompanyFilter]=useState("all");const [catalogEmployeeFilter,setCatalogEmployeeFilter]=useState("all");const assignmentView=employeeView||tab==="assignments";const [catalogWidths,setCatalogWidth]=useColumnWidths("workcatalog2");const [matrixWidths,setMatrixWidth]=useColumnWidths("workmatrix2");const resizeCatalog=useEdgeResize(setCatalogWidth,40);const resizeMatrix=useEdgeResize(setMatrixWidth,40);const gridTemplate=(defaults:string[],widths:Record<number,number>)=>defaults.map((d,i)=>widths[i]?`${widths[i]}px`:d).join(" ");const catalogColumns={gridTemplateColumns:gridTemplate(["56px","minmax(240px,1fr)","minmax(300px,1.2fr)",...companies.map(()=>"92px")],catalogWidths)};const matrixColumns={gridTemplateColumns:gridTemplate(["56px","minmax(220px,1fr)","minmax(210px,.75fr)","170px",...companies.map(()=>"88px")],matrixWidths)};const selectedCompanies=new Set((form.assignCompanyIds||"").split(",").filter(Boolean).map(Number));const toggleAssignCompany=(id:number,checked:boolean)=>{const next=new Set(selectedCompanies);checked?next.add(id):next.delete(id);setForm({...form,assignCompanyIds:[...next].join(",")})};const filteredCatalogItems=items.filter(item=>(catalogCompanyFilter==="all"&&catalogEmployeeFilter==="all")||assignments.some(a=>a.work_definition_id===item.id&&(catalogCompanyFilter==="all"||String(a.company_id)===catalogCompanyFilter)&&(catalogEmployeeFilter==="all"||String(a.employee_id)===catalogEmployeeFilter)));const rows=assignments.map(a=>({key:`${a.work_definition_id}:${a.employee_id}`,workId:a.work_definition_id,employeeId:a.employee_id,title:a.title,description:a.description,frequency:a.frequency,employeeName:a.employee_name})).filter((row,index,list)=>list.findIndex(other=>other.key===row.key)===index);
  const catalogAllowedEmployees=(companyId:number)=>employees.filter(employee=>(employee.company_ids||"").split(",").filter(Boolean).map(Number).includes(companyId));
  const catalogGroup=(freq:"monthly"|"weekly"|"daily")=>{
    const list=filteredCatalogItems.filter(item=>item.frequency===freq);
    if(!list.length)return <Empty text="Bu dövr üzrə sabit iş tapılmadı."/>;
    return <div className="workmatrix"><div className="workmatrixhead" style={catalogColumns}><span {...resizeCatalog(0)}>№</span><span {...resizeCatalog(1)}>İşlərin siyahısı</span><span {...resizeCatalog(2)}>İşin açıqlaması</span>{companies.map((c,i)=><span key={c.id} {...resizeCatalog(3+i)}>{c.name}</span>)}</div>{list.map((item,index)=><article key={item.id} style={catalogColumns}><b className="rownumber">{index+1}</b><h3>{item.title}</h3><p className="workdescription">{item.description||"—"}</p>{companies.map(c=>{const assigned=assignments.find(a=>a.work_definition_id===item.id&&a.company_id===c.id);const allowedEmployees=catalogAllowedEmployees(c.id);return <label className={assigned?"catalogassignee assignedname":"catalogassignee"} key={c.id}><select aria-label={`${c.name} üçün istifadəçi`} value={assigned?.employee_id||""} onChange={e=>e.target.value&&onCatalogAssign(item.id,c.id,Number(e.target.value))}><option value="">Seçin</option>{allowedEmployees.map(employee=><option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>})}</article>)}</div>;
  };
  const assignmentGroup=(freq:"monthly"|"weekly"|"daily")=>{
    const list=rows.filter(row=>row.frequency===freq);
    if(!list.length)return <Empty text="Bu dövr üzrə təyin olunmuş iş yoxdur."/>;
    return <div className="workmatrix"><div className="workmatrixhead" style={matrixColumns}><span {...resizeMatrix(0)}>№</span><span {...resizeMatrix(1)}>İşlərin siyahısı</span><span {...resizeMatrix(2)}>İşin açıqlaması</span><span {...resizeMatrix(3)}>İstifadəçi</span>{companies.map((c,i)=><span key={c.id} {...resizeMatrix(4+i)}>{c.name}</span>)}</div>{list.map((row,index)=><article key={row.key} style={matrixColumns}><b className="rownumber">{index+1}</b><h3>{row.title}</h3><p className="workdescription">{row.description||"—"}</p><span className="matrixuser">{row.employeeName}</span>{companies.map(c=>{const assigned=assignments.find(a=>a.work_definition_id===row.workId&&a.employee_id===row.employeeId&&a.company_id===c.id);const completed=Boolean(assigned?.is_completed);return assigned?<button type="button" disabled={completed} aria-label={`${c.name}: ${completed?"icra edilib":"icra edildi kimi işarələ"}`} className={`matrixplus assigned completionmark ${completed?"completed":""}`} key={c.id} onClick={()=>onComplete(assigned.id)}>{completed?<span className="completioncheck">✓</span>:null}</button>:<span className="matrixplus" key={c.id}/>})}</article>)}</div>;
  };
  const frequencyEyebrow=frequency==="monthly"?"AYLIQ SABİT İŞLƏR":"HƏFTƏLİK SABİT İŞLƏR";
  return <section className={`panel pagepanel recurringpage ${frequency}`}><div className="pageactions recurringhead"><div><span className="sectioneyebrow">{frequencyEyebrow}</span><h2>{employeeView?"Mənim sabit işlərim":assignmentView?"Personal sabit işlər":"Sabit işlərin siyahısı"}</h2><p>{employeeView?"Sizə sabit olaraq həvalə edilmiş işlər və firmalar":assignmentView?"Sabit işlərin personal və firmalar üzrə bölgüsü":"Sabit işlərin ümumi siyahısı"}</p></div>{!employeeView&&assignmentView&&<Button onClick={()=>setCreating(v=>!v)}><Plus/>Sabit iş yarat</Button>}</div>{!assignmentView?<><div className="catalogfilters"><label><span>Firma</span><select value={catalogCompanyFilter} onChange={e=>setCatalogCompanyFilter(e.target.value)}><option value="all">Bütün firmalar</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label><span>İstifadəçi</span><select value={catalogEmployeeFilter} onChange={e=>setCatalogEmployeeFilter(e.target.value)}><option value="all">Bütün istifadəçilər</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div><div className="workadd catalogadd"><Input placeholder="Yeni sabit işin adını yazın" value={form.workTitle||""} onChange={e=>setForm({...form,workTitle:e.target.value})}/><Input placeholder="İşin açıqlamasını yazın" value={form.workDescription||""} onChange={e=>setForm({...form,workDescription:e.target.value})}/><select value={form.workFrequency||frequency} onChange={e=>setForm({...form,workFrequency:e.target.value})}><option value="monthly">Aylıq</option><option value="weekly">Həftəlik</option></select><Button disabled={!form.workTitle?.trim()} onClick={onAdd}><Plus/>Siyahıya əlavə et</Button></div>{filteredCatalogItems.length?catalogGroup(frequency):<Empty text={items.length?"Seçilmiş filtrlərə uyğun sabit iş tapılmadı.":"Sabit işlərin siyahısı hələ boşdur."}/>}</>:<>{creating&&<div className="fixedtaskcreate"><div className="fixedtaskfields"><label>Sabit iş<select value={form.assignWorkId||""} onChange={e=>setForm({...form,assignWorkId:e.target.value})}><option value="">Sabit işi seçin</option>{items.filter(i=>i.frequency===frequency).map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></label><label>İstifadəçi<select value={form.assignEmployeeId||""} onChange={e=>setForm({...form,assignEmployeeId:e.target.value})}><option value="">İstifadəçini seçin</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div><div className="fixedcompanies"><b>Firmaları seçin</b><div>{companies.map(c=><label key={c.id}><input type="checkbox" checked={selectedCompanies.has(c.id)} onChange={e=>toggleAssignCompany(c.id,e.target.checked)}/><span>✓</span>{c.name}</label>)}</div></div><div className="fixedtaskactions"><button onClick={()=>setCreating(false)}>Ləğv et</button><Button disabled={!form.assignWorkId||!form.assignEmployeeId||!selectedCompanies.size} onClick={()=>{onAssign();setCreating(false)}}>Sabit işi yarat</Button></div></div>}{rows.length?assignmentGroup(frequency):<Empty text={employeeView?"Sizə hələ sabit iş təyin edilməyib.":"Hələ personala sabit iş təyin edilməyib."}/>}</>}</section>}
function EvaluationSection({employees,tasks}:{employees:Employee[];tasks:Task[]}){
  const now=Date.now();
  return <section className="panel evalpanel"><div className="head"><div><h3>Qiymətləndirmə</h3><p>Təsdiqlənmiş işlər üzrə nəticələr</p></div></div><div className="evaluationrows">{employees.map((e,index)=>{
    const own=tasks.filter(t=>t.employee_id===e.id);
    const rated=own.filter(t=>t.evaluation);
    if(!rated.length)return null;
    const avgNum=rated.reduce((s,t)=>s+(t.evaluation||0),0)/rated.length;
    const avg=avgNum.toFixed(1);
    const tier=avgNum>=4?"":avgNum>=2.5?"mid":"low";
    const inProgress=own.filter(t=>t.status==="İcradadır").length;
    const pending=own.filter(t=>t.status==="Yeni").length;
    const late=own.filter(t=>t.status!=="Təsdiqlənib"&&t.status!=="Geri qaytarılıb"&&new Date(t.due_at).getTime()<now).length;
    return <article key={e.id} className={`hue${index%4}`}>
      <i>{initials(e.name)}</i>
      <div>
        <div className="evalrowtop"><h3>{e.name}</h3><RatingStars value={Math.round(avgNum)}/><strong className={`scorepill ${tier}`}>{avg}<small>/5</small></strong></div>
        <div className="evalmetrics"><span className="rated">Qiymətləndirilmiş<b>{rated.length}</b></span><span className="given">Verilmiş<b>{own.length}</b></span><span className="progress">İcrada<b>{inProgress}</b></span><span className="pending">Qalan<b>{pending}</b></span><span className={late?"warn":"ontime"}>Gecikən<b>{late}</b></span></div>
      </div>
    </article>;
  })}</div>{!tasks.some(t=>t.evaluation)&&<Empty text="Hələ qiymətləndirilmiş iş yoxdur."/>}</section>;
}
function TaskTable({tasks}:{tasks:Task[]}){return <div className="simpletasks">{tasks.length?tasks.map(t=><article key={t.id}><span className={`dot ${statusClass(t)}`}/><div><h4>{t.title}</h4><p>{t.employee_name}</p></div><time>{formatDate(t.due_at)}</time><b className={`pill ${statusClass(t)}`}>{displayStatus(t)}</b></article>):<Empty text="Hələ tapşırıq yoxdur."/>}</div>}
function FormShell({title,desc,children,formClass=""}:{title:string;desc:string;children:React.ReactNode;formClass?:string}){return <><DialogHeader className="businessdialogheader"><span className="formeyebrow">DAXİLİ İDARƏETMƏ</span><DialogTitle>{title}</DialogTitle><DialogDescription>{desc}</DialogDescription></DialogHeader><div className={`form businessform ${formClass}`}>{children}</div></>}
function Field({label,value,set,type="text"}:{label:string;value:string;set:(v:string)=>void;type?:string}){return <label className="field">{label}<Input type={type} value={value} onChange={e=>set(e.target.value)}/></label>}
function DateTimeField({label,value,set}:{label:string;value:string;set:(v:string)=>void}){
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  const preview=match?`${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}`:"";
  return <label className="field">{label}<div className="datewrap"><Input type="datetime-local" value={value} onChange={e=>set(e.target.value)}/><span className="dateoverlay">{preview||"gg.aa.iiii --:--"}</span></div></label>;
}
function TextField({label,value,set}:{label:string;value:string;set:(v:string)=>void}){return <label className="field">{label}<Textarea value={value} onChange={e=>set(e.target.value)}/></label>}
function SelectEmployee({employees,value,set}:{employees:Employee[];value:string;set:(v:string)=>void}){return <label className="field">Məsul personal<select value={value} onChange={e=>set(e.target.value)}><option value="">Personal seçin</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name} — {e.position}</option>)}</select></label>}
function SelectCompany({companies,value,set}:{companies:Company[];value:string;set:(v:string)=>void}){return <label className="field">Firma<select value={value} onChange={e=>set(e.target.value)}><option value="">Firma seçin</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
function Stat({icon,tone,label,value}:{icon:React.ReactNode;tone:string;label:string;value:number}){return <article className="stat"><i className={tone}>{icon}</i><div><p>{label}</p><strong>{value}</strong></div></article>}
function Empty({text}:{text:string}){return <div className="empty"><ClipboardList/><p>{text}</p></div>}
function useColumnWidths(storageKey:string){
  const [widths,setWidths]=useState<Record<number,number>>(()=>{
    if(typeof window==="undefined")return {};
    try{const raw=window.localStorage.getItem(`colw:${storageKey}`);return raw?JSON.parse(raw):{}}catch{return {}}
  });
  const setWidth=(index:number,width:number)=>{
    setWidths(prev=>{
      const next={...prev,[index]:Math.round(width)};
      if(typeof window!=="undefined"){try{window.localStorage.setItem(`colw:${storageKey}`,JSON.stringify(next))}catch{}}
      return next;
    });
  };
  return [widths,setWidth] as const;
}
function useEdgeResize(onResize:(index:number,width:number)=>void,min=60){
  const [hoverIndex,setHoverIndex]=useState<number|null>(null);
  const EDGE=8;
  const near=(e:React.MouseEvent<HTMLElement>)=>Math.abs(e.currentTarget.getBoundingClientRect().right-e.clientX)<=EDGE;
  return (index:number)=>({
    onMouseMove:(e:React.MouseEvent<HTMLElement>)=>setHoverIndex(near(e)?index:null),
    onMouseLeave:()=>setHoverIndex(current=>current===index?null:current),
    onMouseDown:(e:React.MouseEvent<HTMLElement>)=>{
      if(!near(e))return;
      e.preventDefault();e.stopPropagation();
      const startX=e.clientX;
      const startWidth=e.currentTarget.getBoundingClientRect().width;
      document.body.classList.add("colresizing");
      const onMove=(ev:MouseEvent)=>{ev.preventDefault();onResize(index,Math.max(min,startWidth+(ev.clientX-startX)))};
      const onUp=()=>{document.body.classList.remove("colresizing");window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp)};
      window.addEventListener("mousemove",onMove);
      window.addEventListener("mouseup",onUp);
    },
    className:hoverIndex===index?"edgeresizing":undefined,
  });
}
function ColGroup({defaults,widths}:{defaults:number[];widths:Record<number,number>}){
  return <colgroup>{defaults.map((d,i)=><col key={i} style={{width:widths[i]||d}}/>)}</colgroup>;
}
function DebugOverlay(){
  const [info,setInfo]=useState("");
  useEffect(()=>{
    const onMove=(e:MouseEvent)=>{
      const el=document.elementFromPoint(e.clientX,e.clientY) as HTMLElement|null;
      const th=el?.closest("th") as HTMLElement|null;
      const rect=el?.getBoundingClientRect();
      const thRect=th?.getBoundingClientRect();
      setInfo(`mouseX=${e.clientX} | under-cursor: <${el?.tagName.toLowerCase()} class="${(el?.className||"").toString().slice(0,40)}"> left=${rect?Math.round(rect.left):"-"} right=${rect?Math.round(rect.right):"-"} width=${rect?Math.round(rect.width):"-"} || closest <th>: left=${thRect?Math.round(thRect.left):"-"} right=${thRect?Math.round(thRect.right):"-"} width=${thRect?Math.round(thRect.width):"-"} cursor=${el?getComputedStyle(el).cursor:"-"}`);
    };
    window.addEventListener("mousemove",onMove);
    return ()=>window.removeEventListener("mousemove",onMove);
  },[]);
  return <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#000",color:"#0f0",fontSize:11,padding:"6px 10px",zIndex:99999,fontFamily:"monospace",pointerEvents:"none",whiteSpace:"pre-wrap"}}>{info}</div>;
}
function RatingStars({value,compact=false}:{value:number;compact?:boolean}){return <span className={compact?"ratingstars compact":"ratingstars"}>{[1,2,3,4,5].map(n=><span key={n} className={n<=value?"filled":"empty"}>★</span>)}</span>}
function RatingCell({evaluation,note,compact=false}:{evaluation:number|null;note:string|null;compact?:boolean}){
  if(!evaluation&&!note)return null;
  const content=evaluation?<RatingStars value={evaluation} compact={compact}/>:<span className="nodocument">—</span>;
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
function ChecklistSection({employeeView,checklist,loading,title,setTitle,busy,error,onAdd,onToggle,onRemove}:{employeeView:boolean;checklist:ChecklistLikeItem[];loading:boolean;title:string;setTitle:(v:string)=>void;busy:boolean;error:string;onAdd:()=>void;onToggle:(item:ChecklistLikeItem)=>void;onRemove:(item:ChecklistLikeItem)=>void}){
  const done=checklist.filter(i=>Boolean(i.done)).length;
  const pct=checklist.length?Math.round((done/checklist.length)*100):0;
  return <div className="checklistsection"><div className="checklisthead"><b>Mənim iş axınım</b>{checklist.length>0&&<small>{done}/{checklist.length} tamamlandı <em>({pct}%)</em></small>}</div>
    {loading?<small>Yüklənir...</small>:<>
      {checklist.length?<ul className="checklist">{checklist.map(item=><li key={item.id} className={item.done?"done":""}><label><input type="checkbox" checked={Boolean(item.done)} disabled={!employeeView} onChange={()=>onToggle(item)}/><span>{item.title}</span></label>{employeeView&&<button type="button" className="checklistremove" onClick={()=>onRemove(item)}>✕</button>}</li>)}</ul>:<small className="checklistempty">{employeeView?"Bu tapşırığı icra etmək üçün öz addımlarınızı əlavə edin.":"Personal hələ iş axını yaratmayıb."}</small>}
      {employeeView&&<div className="checklistadd"><Input placeholder="Yeni addım yazın" value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();onAdd()}}}/><Button type="button" disabled={busy||!title.trim()} onClick={onAdd}><Plus/>Əlavə et</Button></div>}
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
