"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { TERMINATION_REASONS } from "@/lib/hr-calc";
import { ORDER_TEMPLATE_TOKENS } from "@/lib/hr-orders";
import { ActionsHeader, ColGroup, SortableTh, joinClass, useColumnDrag, useEdgeResize, useExcelFilters, useTableColumns, type ExcelColumn } from "@/components/table-kit";
import { BookOpen, Bell, Briefcase, Maximize2, Minimize2, Minus, Volume2, VolumeX, Settings, ChevronDown, ChevronLeft, ChevronRight, Building2, ClipboardList, Download, Eye, EyeOff, FileText, KeyRound, LayoutDashboard, LogOut, Menu, MessageCircle, Paperclip, Plus, RefreshCw, Send, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HrPage, type HrSection } from "@/components/hr/hr-page";
import { OrdersPage } from "@/components/hr/orders-page";
import { DocumentsOverview, HrOverview, SectionOverview } from "@/components/section-overview";
import { GuidesPage } from "@/components/guides";
import { ACTIONS, ACTION_LABELS, FIRM_SECTIONS, LEVELED_SECTIONS, TYPED_SECTIONS, deniedWithFirms, firmSectionRights, parseCompanyPermissions, parseStoredPermissions, type CompanyPermissions, type FirmSection, type FirmSectionRights, type SectionAction } from "@/lib/permission-model";
import { formatPhone } from "@/lib/phone";
import { DEFAULT_FIXED_START, FIXED_FREQUENCIES, FREQUENCY_TITLES, hasFixedDue, MONTH_NAMES, MONTH_ORDINALS, WEEKDAY_NAMES, bakuToday, dueDay, dueLabel, dueMonth, formatBakuDate, isLongPeriod, overdueDays, periodState, periodWindow, periodsOf, periodsOfYear, type FixedFrequency } from "@/lib/fixed-periods";

type Employee = { id:number; name:string; position:string; email:string|null; active:number; created_at:string; company_ids:string|null; company_positions:string|null; main_company_id:number|null; avatar_key:string|null; hidden_sections?:string|null; company_permissions?:string|null; is_department_head?:number };
type Company = { id:number; name:string; voen:string|null; manager:string|null; active:number; created_at:string };
// Versiya 2.104: up to 10 files where one used to be (db/attachments.ts); the single attachment_* fields hold the first of them.
type FileRef = { key:string; name:string; size:number; type:string };
const MAX_FILES=10;
const MAX_FILE_SIZE=25*1024*1024;
// Uploads the chosen files one by one (each up to 25 MB) and returns their references.
async function uploadFiles(files:File[]):Promise<FileRef[]>{
  const uploaded:FileRef[]=[];
  for(const file of files){
    if(file.size>MAX_FILE_SIZE)throw new Error(`“${file.name}”: faylın həcmi 25 MB-dan çox ola bilməz.`);
    const upload=new FormData();upload.append("file",file);
    const response=await fetch("/api/file",{method:"POST",body:upload});
    const result=await response.json().catch(()=>({error:`“${file.name}” yüklənmədi.`}));
    if(!response.ok)throw new Error(result.error||`“${file.name}” yüklənmədi.`);
    uploaded.push({key:result.key,name:result.name,size:result.size,type:result.type});
  }
  return uploaded;
}
// The files of a row: the list, or — for a row read before the list existed — its single file.
const rowFiles=(files:FileRef[]|undefined,key?:string|null,name?:string|null,size?:number|null):FileRef[]=>files?.length?files:key?[{key,name:name||"fayl",size:size||0,type:""}]:[];
const fileHref=(f:FileRef)=>`/api/file?key=${encodeURIComponent(f.key)}`;
function FileLinks({files,empty,onRemove,busy}:{files:FileRef[];empty?:React.ReactNode;onRemove?:(f:FileRef)=>void;busy?:boolean}){
  if(!files.length)return <>{empty??null}</>;
  return <span className="filelinks">{files.map(f=><span key={f.key} className="filelinkitem"><a className="filelink" href={fileHref(f)}>{f.name}{f.size?<small>{formatFileSize(f.size)}</small>:null}</a>{onRemove&&<button type="button" className="checklistremove" title="Faylı sil" disabled={busy} onClick={()=>onRemove(f)}>✕</button>}</span>)}</span>;
}
// Several files to choose (Versiya 2.104): each choice adds to the list, ✕ takes one out; at most MAX_FILES with the kept ones.
function FilePicker({label,files,onChange,kept=0}:{label:string;files:File[];onChange:(next:File[])=>void;kept?:number}){
  const left=MAX_FILES-kept-files.length;
  return <label className="field filefield">{label}<Input type="file" multiple disabled={left<=0} onChange={e=>{const chosen=[...(e.target.files||[])];e.target.value="";if(chosen.length>left)window.alert(`Ən çox ${MAX_FILES} fayl əlavə etmək olar — ${Math.max(left,0)} fayl seçilə bilər.`);onChange([...files,...chosen.slice(0,Math.max(left,0))])}}/>{files.length>0&&<span className="filelinks">{files.map((f,i)=><span key={`${f.name}-${i}`} className="filelinkitem"><small>{f.name} • {formatFileSize(f.size)}</small><button type="button" className="checklistremove" title="Siyahıdan çıxar" onClick={e=>{e.preventDefault();onChange(files.filter((_,j)=>j!==i))}}>✕</button></span>)}</span>}<small className="filepickernote">Bir neçə fayl seçmək olar — ən çox {MAX_FILES}, hər biri 25 MB-a qədər.</small></label>;
}
type Task = { files?:FileRef[]; submission_files?:FileRef[]; id:number; request_id?:number|null; request_from?:string|null; request_status?:string|null; employee_id:number; employee_name:string; employee_position:string; company_id:number|null; company_name:string|null; title:string; description:string|null; due_at:string; original_due_at:string|null; status:string; evaluation:number|null; evaluation_note:string|null; employee_status_changed:number; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; submission_attachment_key:string|null; submission_attachment_name:string|null; submission_attachment_size:number|null; submission_attachment_type:string|null; recurring_task_id:number|null; period_key:string|null; created_at:string; completed_at?:string|null; assigned_by:string|null };
type DateRequest = { id:number; task_id:number; task_title:string; employee_id:number; employee_name:string; proposed_due_at:string; reason:string|null; status:string; admin_note:string|null; created_at:string; resolved_at:string|null };
type Recurring = { id:number; employee_id:number; employee_name:string; title:string; description:string|null; due_day:number; frequency:"monthly"|"weekly"|"daily"; weekday:number|null; due_time:string; active:number };
type WorkItem = { id:number; title:string; description:string|null; frequency:FixedFrequency|"daily"; due_month?:number|null; company_ids:string|null; due_day:number|null };
type WorkAssignment = { created_at?:string|null; id:number; work_definition_id:number; title:string; description:string|null; frequency:FixedFrequency|"daily"; due_month?:number|null; due_day:number|null; employee_id:number; employee_name:string; company_id:number; company_name:string; period_key:string; is_completed:number };
type WorkCompletion = { work_assignment_id:number; period_key:string; completed_at:string };
type Data = { fixedWorksStart?:string; approvals?:Task[]; employees:Employee[]; companies:Company[]; tasks:Task[]; recurring:Recurring[]; workItems:WorkItem[]; workAssignments:WorkAssignment[]; workCompletions:WorkCompletion[]; dateRequests:DateRequest[] };
type AppUser = { id:number; name:string; email:string; role:"admin"|"employee"; employeeId:number|null; active?:number; mustChangePassword?:boolean; backgroundKey?:string|null; avatarKey?:string|null };
type ManagedUser = { id:number; name:string; email:string; role:string; employee_id:number|null; active:number; must_change_password:number };
type Page = "dashboard"|"settings"|"tasks"|"requests"|"chat"|"employees"|"companies"|"customers"|"audit"|"documents"|"hr"|"guides";
type AuditItem = { id:number; actor_name:string; action:string; target_type:string; target_label:string|null; created_at:string };
type Violation = { id:number; employee_id:number; employee_name:string; company_id:number|null; company_name:string|null; title:string; note:string|null; created_by_name:string|null; created_at:string };
type EmployeeCompanyPosition = { company_id:number; position_id:number|null; position_title:string|null };
const parseCompanyPositions=(raw:string|null|undefined):EmployeeCompanyPosition[]=>{try{const list=JSON.parse(raw||"[]");return Array.isArray(list)?list:[]}catch{return []}};
const companyPositionsForm=(raw:string|null|undefined)=>JSON.stringify(Object.fromEntries(parseCompanyPositions(raw).filter(p=>p.position_id).map(p=>[String(p.company_id),p.position_id])));
type DelegateCandidate = { id:number; name:string; position_title:string|null };
type StructurePosition = { id:number; company_id:number; department:string; title:string; reports_to:string|null; sort_order:number; created_at:string };
type ChatThread = { id:number; type:"group"|"direct"; other_user_id?:number|null; name:string; avatar_key:string|null; last_message:string|null; last_message_at:string|null; unread:number };
type ChatMessage = { id:number; thread_id:number; sender_user_id:number; sender_name:string; sender_avatar_key:string|null; body:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; created_at:string };
type ChatUser = { id:number; name:string; email:string; avatar_key:string|null };
type FormerStaff = { customer_id:number; hr_employee_id:number; last_name:string; first_name:string; patronymic:string|null; prior_position:string; start_date:string; end_date:string; prior_termination_reason:string|null; current_position:string|null; company_name:string|null; termination_date:string|null };
type Customer = { id:number; entity_type:string|null; country:string|null; voen:string|null; name:string; legal_address:string|null; legal_address2:string|null; manager:string|null; phone?:string|null; created_at:string; usage_count?:number };
type ChecklistItem = { files?:FileRef[]; delegated_submission_files?:FileRef[]; id:number; task_id:number; title:string; done:number; created_at:string; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null };
type StepRequest = { request_id?:number|null; request_status?:string|null; request_department?:string|null; request_reject_reason?:string|null; request_due_at?:string|null; request_agreed_due_at?:string|null; request_assignee_name?:string|null; request_answer?:string|null; request_answer_key?:string|null; request_answer_name?:string|null; request_answer_size?:number|null };
type StepRequestInput = { department:string; title:string; description:string; dueDate:string; files:File[] };
type ChecklistLikeItem = StepRequest & { files?:FileRef[]; delegated_submission_files?:FileRef[]; request_answer_files?:FileRef[]; id:number; title:string; done:number; delegated_task_id?:number|null; delegated_employee_name?:string|null; delegated_task_status?:string|null; attachment_key?:string|null; attachment_name?:string|null; attachment_size?:number|null; delegated_submission_attachment_key?:string|null; delegated_submission_attachment_name?:string|null; delegated_submission_attachment_size?:number|null };
type PersonalWork = { files?:FileRef[]; id:number; user_id:number; owner_name:string; title:string; description:string|null; company_id:number|null; company_name:string|null; due_at:string|null; status:string; created_at:string; completed_at:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; shared?:{employee_id:number;name:string;total:number;done:number}[]; departments?:{department:string;total:number;done:number}[]; own?:{total:number;done:number}|null };
type WorkHistoryEvent = { id:number; actor_name:string; action:string; detail:string|null; created_at:string|null };
type PersonalWorkChecklistItem = StepRequest & { id:number; personal_work_id:number; title:string; done:number; created_at:string; delegated_task_id:number|null; delegated_employee_id:number|null; delegated_employee_name:string|null; delegated_task_status:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; delegated_submission_attachment_key:string|null; delegated_submission_attachment_name:string|null; delegated_submission_attachment_size:number|null };
// Versiya 2.99: where the user registers documents — per firm, every type (null) or only these template names.
type RegisterTarget = { companyId:number; types:string[]|null };
type DocumentTemplate = { id:number; name:string; departments?:string|null; company_id?:number|null; company_name?:string|null; template_group?:string|null; signed_copy_returns?:number|null; signed_copy_days?:number|null; template1_key:string|null; template1_name:string|null; template1_size:number|null; template1_type:string|null; template2_key:string|null; template2_name:string|null; template2_size:number|null; template2_type:string|null; template3_key:string|null; template3_name:string|null; template3_size:number|null; template3_type:string|null; draft_folder_path:string|null; final_folder_path:string|null; file_name_pattern:string|null; incoming_folder_path:string|null; incoming_name_pattern:string|null; draft_folder_missing?:boolean; final_folder_missing?:boolean; incoming_folder_missing?:boolean; created_at:string };
type OutgoingDocument = { informed_departments?:string[]; return_due_date?:string|null; responsible_employee_id?:number|null; responsible_name?:string|null; approval?:DocumentApproval; id:number; related_departments?:string[]; can?:{edit:boolean;upload:boolean;uploadFinal?:boolean;remove:boolean}; outgoing_no:string; signed_copy_returns?:number|null; returns_signed_copy?:number; outgoing_date:string|null; incoming_no:string|null; incoming_date:string|null; sending_department:string|null; document_type:string|null; sending_method:string|null; delivered_by:string|null; copies:string|null; document_number:string|null; document_date:string|null; voen:string|null; organization_name:string|null; phone:string|null; note:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; attachment_type:string|null; created_at:string; company_id:number|null; company_name:string|null; draft_path:string|null; draft_key:string|null; draft_name:string|null; draft_size:number|null; final_path:string|null; final_key:string|null; final_name:string|null; final_size:number|null; draft_missing:boolean; final_missing:boolean };
type WorkRequest = { files?:FileRef[]; submission_files?:FileRef[]; id:number; origin_work_title?:string|null; origin_incoming_no?:string|null; incoming_id?:number|null; company_id:number; company_name:string; from_user_id:number; from_name:string|null; from_department:string|null; to_department:string; assignee_employee_id:number|null; assignee_name:string|null; title:string; description:string|null; desired_due_at:string|null; agreed_due_at:string|null; status:string; reject_reason:string|null; attachment_key:string|null; attachment_name:string|null; attachment_size:number|null; created_at:string; task_id:number|null; task_status:string|null; task_evaluation:number|null; task_evaluation_note:string|null; submission_attachment_key:string|null; submission_attachment_name:string|null; submission_attachment_size:number|null; box:"incoming"|"outgoing"|"oversight"; actionable:boolean; can:Record<"accept"|"reject"|"reassign"|"start"|"answer"|"close"|"reopen"|"remove"|"comment"|"evaluate",boolean> };
type RequestsData = { canAdd?:boolean; items:WorkRequest[]; departments:Record<string,string[]>; members:Record<string,Array<{id:number;name:string;position_title:string}>>; myDepartments:Record<string,string|null> };
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
  // Status picked on the dashboard donut; it only narrows the Tasks page until cleared or the user leaves that page.
  const [taskStatusFilter,setTaskStatusFilter]=useState<string|null>(null);
  // Likewise the employee picked on the dashboard HR chart narrows the Nöqsanlar page.
  const [violationEmployeeFilter,setViolationEmployeeFilter]=useState<{id:number;name:string}|null>(null);
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
  const [incomingPending,setIncomingPending]=useState(0);
  // Versiya 2.86: outgoing documents whose signed copy is late — in the bell for the registrars and the related departments' heads.
  const [overdueDocs,setOverdueDocs]=useState<OverdueSignedCopy[]>([]);
  const [seenOverdueDocs,setSeenOverdueDocs]=useState<number[]>([]);
  const [dashboardMenuOpen,setDashboardMenuOpen]=useState(false);
  const [tasksMenuOpen,setTasksMenuOpen]=useState(false);
  // The Tapşırıqlar sub-menu (with Sorğular inside) remembers whether it was left open.
  useEffect(()=>{try{if(window.localStorage.getItem("nav:tasksOpen")==="1")setTasksMenuOpen(true)}catch{}},[]);
  // The sidebar can be folded away on a wide screen (‹ in the sidebar, › at the left edge to bring it back); remembered per browser.
  const [navCollapsed,setNavCollapsed]=useState(false);
  useEffect(()=>{try{if(window.localStorage.getItem("nav:collapsed")==="1")setNavCollapsed(true)}catch{}},[]);
  const toggleNavCollapsed=()=>setNavCollapsed(v=>{const next=!v;try{window.localStorage.setItem("nav:collapsed",next?"1":"0")}catch{}return next});
  const toggleTasksMenu=()=>setTasksMenuOpen(v=>{const next=!v;try{window.localStorage.setItem("nav:tasksOpen",next?"1":"0")}catch{}return next});
  const openTasksMenu=()=>{setTasksMenuOpen(true);try{window.localStorage.setItem("nav:tasksOpen","1")}catch{}};
  const [fixedTab,setFixedTab]=useState<"catalog"|"assignments">("catalog");
  // Versiya 2.93: the frequency tab inside "Sabit işlər".
  const [fixedFreq,setFixedFreq]=useState<FixedFrequency>("weekly");
  // Versiya 2.94: "Mənim sabit işlərim" / "Əməkdaşlarımın sabit işləri" for anyone with staff in a firm's structure.
  const [fixedScope,setFixedScope]=useState<"mine"|"team">("mine");
  const [teamFixed,setTeamFixed]=useState<{hasTeam:boolean;assignments:WorkAssignment[];completions:WorkCompletion[]}>({hasTeam:false,assignments:[],completions:[]});
  const [taskSubTab,setTaskSubTab]=useState<"overview"|"tasks"|"fixed">("tasks");
  const [tasksSection,setTasksSection]=useState<"manager"|"mine">("manager");
  const [documentsMenuOpen,setDocumentsMenuOpen]=useState(false);
  const [hrMenuOpen,setHrMenuOpen]=useState(false);
  const [hrSubTab,setHrSubTab]=useState<"overview"|"violations"|"orders"|HrSection>("violations");
  // Leaving the page a dashboard filter was opened for drops that filter (adjusted during render, as React recommends over an effect).
  const [filterNavKey,setFilterNavKey]=useState(`${page}|${hrSubTab}`);
  if(filterNavKey!==`${page}|${hrSubTab}`){
    setFilterNavKey(`${page}|${hrSubTab}`);
    if(page!=="tasks")setTaskStatusFilter(null);
    if(page!=="hr"||hrSubTab!=="violations")setViolationEmployeeFilter(null);
  }
  const [documentSubTab,setDocumentSubTab]=useState<"overview"|"templates"|"outgoing"|"incoming">("templates");
  // Browser back/forward (Versiya 2.69): every move between sections and sub-sections is a history entry of this page (the address
  // stays the same), so the browser's "geri" returns to the previous section instead of leaving the site.
  const navKey=JSON.stringify({page,taskSubTab,tasksSection,documentSubTab,hrSubTab});
  const signedIn=Boolean(user);
  useEffect(()=>{
    if(!signedIn)return;
    const current=window.history.state?.nav;
    if(current===undefined)window.history.replaceState({...(window.history.state||{}),nav:navKey},"");
    else if(current!==navKey)window.history.pushState({nav:navKey},"");
  },[navKey,signedIn]);
  useEffect(()=>{
    const onPop=(e:PopStateEvent)=>{
      const raw=e.state?.nav;if(typeof raw!=="string")return;
      try{const n=JSON.parse(raw);setPage(n.page);setTaskSubTab(n.taskSubTab==="monthly"||n.taskSubTab==="weekly"?"fixed":n.taskSubTab);setTasksSection(n.tasksSection);setDocumentSubTab(n.documentSubTab);setHrSubTab(n.hrSubTab);setMenu(false)}catch{}
    };
    window.addEventListener("popstate",onPop);
    return()=>window.removeEventListener("popstate",onPop);
  },[]);
  // New-message notification (Versiya 2.73): a card above the chat corner, a short sound (switchable in the chat window) and,
  // when the site is not in front, the browser's own notification. Nothing for the conversation already on screen.
  // "Yubanan sənədlər" on the Sənədlər overview opens Çıxan sənədlər on its "Yubananlar" tab (Versiya 2.75).
  const [outgoingPreset,setOutgoingPreset]=useState<OutgoingPreset|null>(null);
  const [chatFocus,setChatFocus]=useState<{thread:number;nonce:number}|null>(null);
  const [chatToast,setChatToast]=useState<ChatLatest|null>(null);
  const [chatSound,setChatSound]=useState(()=>{try{return typeof window==="undefined"||window.localStorage.getItem("chat:sound")!=="0"}catch{return true}});
  const toggleChatSound=()=>setChatSound(v=>{const next=!v;try{window.localStorage.setItem("chat:sound",next?"1":"0")}catch{}return next});
  const viewingThreadRef=useRef<number|null>(null);
  const lastChatMessageRef=useRef<number|null>(null);
  const chatSummaryRef=useRef<(latest:ChatLatest|null)=>void>(()=>{});
  // Çat page buttons (Versiya 2.75): "—" leaves a small Çat bar in the corner and goes back to where the user was, "⤢" fills
  // the whole screen, "✕" closes and goes back.
  const [chatMini,setChatMini]=useState(false);
  const [chatFull,setChatFull]=useState(false);
  const [chatReturn,setChatReturn]=useState<{page:Page;taskSubTab:typeof taskSubTab;tasksSection:typeof tasksSection;documentSubTab:typeof documentSubTab;hrSubTab:typeof hrSubTab}|null>(null);
  const openChat=()=>{if(page!=="chat")setChatReturn({page,taskSubTab,tasksSection,documentSubTab,hrSubTab});setChatMini(false);setPage("chat");setMenu(false)};
  const leaveChat=(mini:boolean)=>{setChatMini(mini);setChatFull(false);const r=chatReturn;if(r){setTaskSubTab(r.taskSubTab);setTasksSection(r.tasksSection);setDocumentSubTab(r.documentSubTab);setHrSubTab(r.hrSubTab);setPage(r.page)}else setPage("dashboard")};
  const openChatAt=(threadId:number)=>{setChatFocus(prev=>({thread:threadId,nonce:(prev?.nonce??0)+1}));openChat();setChatToast(null)};
  useEffect(()=>{if(!chatToast)return;const timer=setTimeout(()=>setChatToast(null),6000);return()=>clearTimeout(timer)},[chatToast]);
  const [notifOpen,setNotifOpen]=useState(false);
  const [seenOverdue,setSeenOverdue]=useState<number[]>([]);
  const [activeCompanyId,setActiveCompanyId]=useState<number|null>(null);

  const load=async()=>{setLoading(true);setError("");try{const response=await fetch("/api/data");const body=await response.json();if(!response.ok)throw new Error(body.error);setData(body)}catch(e){setError(e instanceof Error?e.message:"Xəta baş verdi.")}finally{setLoading(false)}};
  useEffect(()=>{let cancelled=false;void fetch("/api/auth").then(async response=>{if(!response.ok)return null;return (await response.json()).user as AppUser}).then(found=>{if(!cancelled)setUser(found)}).finally(()=>{if(!cancelled)setAuthLoading(false)});return()=>{cancelled=true}},[]);
  useEffect(()=>{if(!user)return;void load().then(()=>undefined)},[user]);
  // An approval made inside a task's or work's steps (Versiya 2.82) refreshes the lists without the loading screen.
  useEffect(()=>{const quiet=()=>void fetch("/api/data").then(r=>r.ok?r.json():null).then(body=>{if(body)setData(body)});window.addEventListener("app:data-changed",quiet);return()=>window.removeEventListener("app:data-changed",quiet)},[]);
  useEffect(()=>{if(!user)return;const check=()=>void fetch("/api/chat?summary=1").then(r=>r.ok?r.json():null).then(v=>{if(!v)return;setChatUnread(Number(v.totalUnread||0));chatSummaryRef.current(v.latest??null)});check();const timer=setInterval(check,10000);return()=>clearInterval(timer)},[user]);
  // Director's badge on Daxil olan sənədlər: documents waiting for their dərkənar.
  useEffect(()=>{if(!user)return;const check=()=>void fetch("/api/documents/incoming?summary=1").then(r=>r.ok?r.json():null).then(v=>v&&setIncomingPending(Number(v.pending||0)));check();const timer=setInterval(check,30000);return()=>clearInterval(timer)},[user]);
  useEffect(()=>{if(!user)return;const check=()=>void fetch("/api/documents/outgoing?summary=1").then(r=>r.ok?r.json():null).then(v=>v&&setOverdueDocs(v.overdue||[]));check();const timer=setInterval(check,60000);return()=>clearInterval(timer)},[user]);
  useEffect(()=>{if(!user)return;const check=()=>void fetch("/api/requests?summary=1").then(r=>r.ok?r.json():null).then(v=>v&&setRequestsPending(Number(v.actionable||0)));check();const timer=setInterval(check,30000);return()=>clearInterval(timer)},[user]);
  const signIn=async()=>{setError("");setAuthLoading(true);try{const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"login",...authForm})});const body=await response.json();if(!response.ok)throw new Error(body.error);setUser(body.user);setAuthForm({email:"",password:""})}catch(e){setError(e instanceof Error?e.message:"Giriş baş tutmadı.")}finally{setAuthLoading(false)}};
  const signOut=async()=>{await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"logout"})});setUser(null);setData(emptyData);setPage("dashboard");setViewAs(null)};
  const changeOwnPassword=async()=>{setError("");const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"change-password",currentPassword:form.currentPassword,newPassword:form.newPassword})});const body=await response.json();if(!response.ok){setError(body.error);return}setDialog(null);setForm({});setUser(current=>current?{...current,mustChangePassword:false}:current)};
  const saveBackground=async()=>{if(!backgroundFile)return;setError("");setUploadingBackground(true);try{if(backgroundFile.size>8*1024*1024)throw new Error("Fon şəklinin həcmi 8 MB-dan çox ola bilməz.");const upload=new FormData();upload.append("file",backgroundFile);const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});const uploadResult=await uploadResponse.json();if(!uploadResponse.ok)throw new Error(uploadResult.error||"Şəkil yüklənmədi.");const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"set-background",backgroundKey:uploadResult.key})});const body=await response.json();if(!response.ok)throw new Error(body.error);setUser(body.user);setDialog(null);setBackgroundFile(null)}catch(e){setError(e instanceof Error?e.message:"Fon şəkli yüklənmədi.")}finally{setUploadingBackground(false)}};
  const removeBackground=async()=>{setError("");try{const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"set-background",backgroundKey:null})});const body=await response.json();if(!response.ok)throw new Error(body.error);setUser(body.user);setDialog(null);setBackgroundFile(null)}catch(e){setError(e instanceof Error?e.message:"Fon şəkli silinmədi.")}};
  const saveOwnAvatar=async()=>{if(!ownAvatarFile)return;setError("");setUploadingOwnAvatar(true);try{if(ownAvatarFile.size>5*1024*1024)throw new Error("Şəklin həcmi 5 MB-dan çox ola bilməz.");const upload=new FormData();upload.append("file",ownAvatarFile);const uploadResponse=await fetch("/api/file",{method:"POST",body:upload});const uploadResult=await uploadResponse.json();if(!uploadResponse.ok)throw new Error(uploadResult.error||"Şəkil yüklənmədi.");const response=await fetch("/api/data",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"self-avatar",avatarKey:uploadResult.key})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Şəkil yüklənmədi.");setData(result);setUser(current=>current?{...current,avatarKey:uploadResult.key}:current);setDialog(null);setOwnAvatarFile(null)}catch(e){setError(e instanceof Error?e.message:"Şəkil yüklənmədi.")}finally{setUploadingOwnAvatar(false)}};
  const removeOwnAvatar=async()=>{setError("");try{const response=await fetch("/api/data",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"self-avatar",avatarKey:null})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Şəkil silinmədi.");setData(result);setUser(current=>current?{...current,avatarKey:null}:current);setDialog(null);setOwnAvatarFile(null)}catch(e){setError(e instanceof Error?e.message:"Şəkil silinmədi.")}};
  const uploadPhotoIfAny=async()=>{if(!employeePhoto)return undefined;if(employeePhoto.size>5*1024*1024)throw new Error("Şəklin həcmi 5 MB-dan çox ola bilməz.");const upload=new FormData();upload.append("file",employeePhoto);const response=await fetch("/api/file",{method:"POST",body:upload});const result=await response.json();if(!response.ok)throw new Error(result.error||"Şəkil yüklənmədi.");return result.key as string};
  const createPersonnel=async()=>{setError("");setUploadingPhoto(Boolean(employeePhoto));try{const avatarKey=await uploadPhotoIfAny();const response=await fetch("/api/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...form,companyIds:(form.companyIds||"").split(",").filter(Boolean).map(Number),companyPositions:JSON.parse(form.companyPositions||"{}"),mainCompanyId:Number(form.mainCompanyId)||null,avatarKey})});const body=await response.json();if(!response.ok)throw new Error(body.error);setDialog(null);setForm({});setEmployeePhoto(null);location.reload()}catch(e){setError(e instanceof Error?e.message:"İstifadəçi yaradılmadı.")}finally{setUploadingPhoto(false)}};
  const saveEmployeeEdit=async()=>{setError("");setUploadingPhoto(Boolean(employeePhoto));try{const avatarKey=await uploadPhotoIfAny();await request("PATCH",{action:"employee",id:Number(form.id),name:form.name,email:form.email,companyIds:(form.companyIds||"").split(",").filter(Boolean).map(Number),companyPositions:JSON.parse(form.companyPositions||"{}"),mainCompanyId:Number(form.mainCompanyId)||null,hiddenSections:form.hiddenSections||"[]",companyPermissions:form.companyPermissions||"{}",...(avatarKey?{avatarKey}:{})});setEmployeePhoto(null)}catch(e){setError(e instanceof Error?e.message:"İstifadəçi yenilənmədi.")}finally{setUploadingPhoto(false)}};
  const request=async(method:"POST"|"PATCH",body:Record<string,unknown>)=>{setError("");try{const response=await fetch("/api/data",{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||"Əməliyyat baş tutmadı.");setData(result);setDialog(null);setForm({})}catch(e){setError(e instanceof Error?e.message:"Əməliyyat baş tutmadı.")}};
  const deleteWorker=async(employee:Employee)=>{if(!window.confirm(`${employee.name} adlı personalı tam silmək istəyirsiniz?`))return;setError("");try{const response=await fetch(`/api/data?employeeId=${employee.id}`,{method:"DELETE"});const result=await response.json();if(!response.ok)throw new Error(result.error||"İstifadəçi silinmədi.");setData(result)}catch(e){setError(e instanceof Error?e.message:"İstifadəçi silinmədi.")}};
  // Versiya 2.90: the admin deletes a fixed work nobody has (the server refuses one that is assigned).
  const deleteWorkDefinition=async(item:WorkItem)=>{if(!window.confirm(`“${item.title}” sabit işi silinsin?`))return;setError("");try{const response=await fetch(`/api/data?workDefinitionId=${item.id}`,{method:"DELETE"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Sabit iş silinmədi.");setData(result)}catch(e){setError(e instanceof Error?e.message:"Sabit iş silinmədi.")}};
  const deleteTaskItem=async(task:Task)=>{if(!window.confirm(`“${task.title}” tapşırığını silmək istəyirsiniz?`))return;setError("");try{const response=await fetch(`/api/data?taskId=${task.id}`,{method:"DELETE"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Tapşırıq silinmədi.");setData(result)}catch(e){setError(e instanceof Error?e.message:"Tapşırıq silinmədi.")}};

  const isAdmin=user?.role==="admin";
  const employeeSelf=!isAdmin&&data.employees.find(e=>e.id===user?.employeeId)||null;
  const effectiveView=viewAs||employeeSelf;
  // Sections hidden from whoever's view this is: none for the admin, the employee's own set otherwise (an admin in "İstifadəçi görünüşü" previews it).
  const deniedSections=effectiveView?deniedOf(effectiveView):new Set<string>();
  const can=(key:string)=>!deniedSections.has(key);
  useEffect(()=>{chatSummaryRef.current=(latest)=>{
    // The first answer only sets the starting point, so old unread messages do not ring on opening the site.
    if(lastChatMessageRef.current===null){lastChatMessageRef.current=latest?.id??0;return}
    if(!latest||latest.id<=lastChatMessageRef.current)return;
    lastChatMessageRef.current=latest.id;
    if(viewAs||!can("chat"))return;
    const inFront=document.visibilityState==="visible"&&document.hasFocus();
    if(inFront&&viewingThreadRef.current===latest.threadId)return;
    setChatToast(latest);
    if(chatSound)playChatSound();
    if(!inFront)showChatBrowserNotification(latest,()=>openChatAt(latest.threadId));
  }});
  const shownRequestsPending=!viewAs&&can("tasks.requests")?requestsPending:0;
  // Şablonlar is the admin's own workspace (naming rules, folders); employees only reach the template files from Çıxan sənədlər.
  const canTemplates=isAdmin&&!viewAs;
  const firstHrTab=can("hr.violations")?"violations":can("hr.personnel")?"personnel":can("hr.orders")?"orders":null;
  // Daxil Olan and Çıxan sənədlər are also open (read-only) to anyone holding a position in a firm's structure: they see the documents of their
  // departments and the director sees the whole firm's; registering stays with the section permission.
  const inStructure=!effectiveView||parseCompanyPositions(effectiveView.company_positions).some(p=>p.position_id);
  const canDocument=(tab:string)=>tab==="incoming"||tab==="outgoing"?can(`documents.${tab}`)||inStructure:can(`documents.${tab}`);
  const firstDocumentTab=(["templates","outgoing","incoming"] as const).find(tab=>tab==="templates"?canTemplates:canDocument(tab));
  const ownAvatarKey=employeeSelf?.avatar_key||user?.avatarKey||null;
  // Whoever is the "active identity" (a real non-admin login, OR an admin using İstifadəçi görünüşü — including on themselves) picks one active firma from the sidebar;
  // every company-linked section (tasks, works, HR, fixed works) then scopes to it. Plain admin (no viewAs) stays unscoped, seeing every firma.
  const companyScopeActive=Boolean(effectiveView);
  const myCompanies=effectiveView?data.companies.filter(c=>Boolean(c.active)&&(effectiveView.company_ids||"").split(",").filter(Boolean).map(Number).includes(c.id)):[];
  useEffect(()=>{
    if(!effectiveView){if(activeCompanyId!==null)setActiveCompanyId(null);return}
    let saved:number|null=null;
    let all=false;
    try{const raw=localStorage.getItem(`activeCompany:${effectiveView.id}`);all=raw==="all";saved=raw&&!all?Number(raw):null}catch{saved=null}
    // Versiya 2.88: "Bütün firmalar" (null) stays only for someone working in 2+ firms.
    const next=all&&myCompanies.length>1?null:myCompanies.some(c=>c.id===saved)?saved:(myCompanies[0]?.id??null);
    if(next!==activeCompanyId)setActiveCompanyId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[effectiveView?.id,myCompanies.map(c=>c.id).join(",")]);
  const pickCompany=(id:number|null)=>{setActiveCompanyId(id);if(effectiveView)try{localStorage.setItem(`activeCompany:${effectiveView.id}`,id===null?"all":String(id))}catch{}};
  const visibleTasks=(effectiveView?data.tasks.filter(t=>t.employee_id===effectiveView.id):data.tasks).filter(t=>!companyScopeActive||!activeCompanyId||t.company_id===activeCompanyId);
  const activeTasks=visibleTasks.filter(t=>t.status!=="Təsdiqlənib");
  const overdue=activeTasks.filter(t=>new Date(t.due_at)<new Date());
  const pendingDateRequests=data.dateRequests.filter(r=>r.status==="Gözləyir");
  const unseenOverdue=overdue.filter(t=>!seenOverdue.includes(t.id));
  const shownOverdueDocs=viewAs?[]:overdueDocs;
  const unseenOverdueDocs=shownOverdueDocs.filter(d=>!seenOverdueDocs.includes(d.id));
  useEffect(()=>{if(!user)return;try{const raw=localStorage.getItem(`seenOverdueDocs:${user.id}`);setSeenOverdueDocs(raw?JSON.parse(raw):[])}catch{setSeenOverdueDocs([])}},[user]);
  useEffect(()=>{if(!user||!notifOpen)return;const ids=shownOverdueDocs.map(d=>d.id);if(ids.every(id=>seenOverdueDocs.includes(id)))return;const next=Array.from(new Set([...seenOverdueDocs,...ids]));setSeenOverdueDocs(next);try{localStorage.setItem(`seenOverdueDocs:${user.id}`,JSON.stringify(next))}catch{}},[user,notifOpen,shownOverdueDocs,seenOverdueDocs]);
  useEffect(()=>{if(!user)return;try{const raw=localStorage.getItem(`seenOverdue:${user.id}`);setSeenOverdue(raw?JSON.parse(raw):[])}catch{setSeenOverdue([])}},[user]);
  useEffect(()=>{if(!user||(!notifOpen&&page!=="tasks"))return;const ids=overdue.map(t=>t.id);if(ids.every(id=>seenOverdue.includes(id)))return;const next=Array.from(new Set([...seenOverdue,...ids]));setSeenOverdue(next);try{localStorage.setItem(`seenOverdue:${user.id}`,JSON.stringify(next))}catch{}},[user,notifOpen,page,overdue,seenOverdue]);
  const activeEmployees=data.employees.filter(e=>Boolean(e.active));
  // Versiya 2.93: "Sabit işlər" — the works in view (one's own, in the active firm), late periods per frequency (this year and the
  // last), and the tabs: all of them for the admin, only the frequencies one has for everyone else.
  const inActiveCompany=(a:WorkAssignment)=>!companyScopeActive||!activeCompanyId||a.company_id===activeCompanyId;
  const ownScopedFixed=(effectiveView?data.workAssignments.filter(a=>a.employee_id===effectiveView.id):data.workAssignments).filter(inActiveCompany);
  // Versiya 2.94: a head's staff's fixed works, read-only; fetched again on every visit to the section.
  const canFixed=can("tasks.fixed");
  useEffect(()=>{
    if(!effectiveView||!canFixed){setTeamFixed({hasTeam:false,assignments:[],completions:[]});return}
    let live=true;
    fetch(`/api/data?scope=fixed-team${viewAs?`&employeeId=${viewAs.id}`:""}`).then(r=>r.ok?r.json():null).then(body=>{if(live&&body)setTeamFixed({hasTeam:Boolean(body.hasTeam),assignments:body.assignments||[],completions:body.completions||[]})}).catch(()=>{});
    return()=>{live=false};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[effectiveView?.id,viewAs?.id,canFixed,page,taskSubTab]);
  const teamFixedScoped=teamFixed.assignments.filter(inActiveCompany);
  const fixedTeamView=Boolean(effectiveView)&&teamFixed.hasTeam&&fixedScope==="team";
  const scopedFixed=fixedTeamView?teamFixedScoped:ownScopedFixed;
  const fixedCompletions=fixedTeamView?teamFixed.completions:data.workCompletions||[];
  const fixedYear=bakuToday().year;
  const lateCount=(list:WorkAssignment[],completions:WorkCompletion[],f:FixedFrequency)=>{const done=new Set(completions.map(c=>`${c.work_assignment_id}|${c.period_key}`));return list.filter(a=>a.frequency===f).reduce((n,a)=>n+[fixedYear-1,fixedYear].flatMap(y=>periodsOfYear(f,y)).filter(p=>!done.has(`${a.id}|${p.key}`)&&periodState(a,p.key,null,Date.now(),{start:data.fixedWorksStart||DEFAULT_FIXED_START,assignedAt:a.created_at})==="overdue").length,0)};
  const fixedOverdue=(f:FixedFrequency)=>lateCount(ownScopedFixed,data.workCompletions||[],f);
  const teamFixedOverdue=FIXED_FREQUENCIES.reduce((n,f)=>n+lateCount(teamFixedScoped,teamFixed.completions,f),0);
  const shownFixedOverdue=(f:FixedFrequency)=>fixedTeamView?lateCount(teamFixedScoped,teamFixed.completions,f):fixedOverdue(f);
  const ownFixedFreqs=FIXED_FREQUENCIES.filter(f=>scopedFixed.some(a=>a.frequency===f));
  const shownFixedFreqs:FixedFrequency[]=effectiveView?(ownFixedFreqs.length?[...ownFixedFreqs]:["weekly"]):[...FIXED_FREQUENCIES];
  const activeFixedFreq=shownFixedFreqs.includes(fixedFreq)?fixedFreq:shownFixedFreqs[0];
  const title:Record<Page,string>={dashboard:"Ana səhifə",settings:"Tənzimləmələr",tasks:"Tapşırıqlar",requests:"Sorğular",chat:"Çat",employees:"İstifadəçilər",companies:"Firmalar",customers:"Müştərilər",audit:"Əməliyyat jurnalı",documents:"Sənədlər",hr:"Kadrlar",guides:"Təlimatlar"};
  // "← Geri" (Versiya 2.69): every sub-section leads back to its parent's overview (Tənzimləmələr since 2.71).
  const subTitle=page==="tasks"?(taskSubTab==="overview"?null:taskSubTab==="fixed"?"Sabit işlər":tasksSection==="mine"?"Şəxsi işlərim":"Verilən tapşırıqlar")
    :page==="documents"?({overview:null,templates:"Şablonlar",outgoing:"Çıxan sənədlər",incoming:"Daxil olan sənədlər"} as Record<string,string|null>)[documentSubTab]
    :page==="hr"?({overview:null,violations:"Nöqsanlar",personnel:"Personallar",customers:"Əvvəlki iş yerləri",calendar:"İstehsalat təqvimi",settings:"Hesablama parametrləri",orders:"Əmrlər"} as Record<string,string|null>)[hrSubTab]
    :null;
  const back:{label:string;go:()=>void}|null=page==="companies"||page==="employees"||page==="audit"?{label:"Tənzimləmələr",go:()=>setPage("settings")}
    :page==="customers"?{label:"Sənədlər",go:()=>{setDocumentSubTab("overview");setPage("documents")}}
    :page==="requests"||(page==="tasks"&&taskSubTab!=="overview")?{label:"Tapşırıqlar",go:()=>{setTaskSubTab("overview");setPage("tasks")}}
    :page==="documents"&&documentSubTab!=="overview"?{label:"Sənədlər",go:()=>setDocumentSubTab("overview")}
    :page==="hr"&&hrSubTab!=="overview"?{label:"Kadrlar",go:()=>setHrSubTab("overview")}
    :null;
  const nav:[Page,string,React.ComponentType][]=[["dashboard","Ana səhifə",LayoutDashboard],["tasks","Tapşırıqlar",ClipboardList],["documents","Sənədlər",FileText],["hr","Kadrlar",Briefcase],["guides","Təlimatlar",BookOpen],["settings","Tənzimləmələr",Settings]];
  const open=(kind:typeof dialog,initial:Record<string,string>={})=>{setForm(initial);setDialog(kind)};
  const pageAllowed=page==="customers"?can("dashboard.customers"):page==="requests"?can("tasks.requests"):page==="chat"?can("chat"):page==="hr"?hrSubTab==="overview"?Boolean(firstHrTab):can(hrSubTab==="violations"?"hr.violations":hrSubTab==="orders"?"hr.orders":"hr.personnel")
    :page==="documents"?(documentSubTab==="overview"?Boolean(firstDocumentTab)||can("dashboard.customers"):documentSubTab==="templates"?can(`documents.${documentSubTab}`):canDocument(documentSubTab)):page==="tasks"?(taskSubTab==="overview"?true:taskSubTab==="tasks"?tasksSection==="manager"||can("tasks.mine"):can(`tasks.${taskSubTab}`)):true;

  if(authLoading&&!user)return <div className="authpage"><div className="authcard"><div className="authlogo">Dİ</div><h1>Daxili İdarəetmə</h1><p>Giriş yoxlanılır...</p></div></div>;
  if(!user)return <LoginScreen form={authForm} setForm={setAuthForm} error={error} loading={authLoading} onLogin={()=>void signIn()}/>;
  return <div className={navCollapsed?"shell navcollapsed":"shell"}>
    {menu&&<button className="shade" onClick={()=>setMenu(false)}/>}
    {navCollapsed&&<button className="navexpand" title="Menyunu göstər" aria-label="Menyunu göstər" onClick={toggleNavCollapsed}><ChevronRight/></button>}
    <aside className={menu?"side show":"side"}>
      <button className="close" onClick={()=>setMenu(false)}><X/></button>
      <div className="sidescroll">
      <div className="brand"><i>Dİ</i><div><b>Daxili İdarəetmə</b><small>İş və tapşırıq sistemi</small><small className="brandversion">Versiya 2.104</small></div><button className="navcollapse" title="Menyunu gizlət" aria-label="Menyunu gizlət" onClick={toggleNavCollapsed}><ChevronLeft/></button></div>
      {companyScopeActive&&myCompanies.length>1&&<div className="companyswitcher"><label>Aktiv firma<select value={activeCompanyId??"all"} onChange={e=>pickCompany(e.target.value==="all"?null:Number(e.target.value))}><option value="all">Bütün firmalar</option>{myCompanies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>}
      <nav>{nav.filter(([id])=>!viewAs||id==="dashboard"||id==="tasks"||id==="guides"||id==="settings").filter(([id])=>id==="documents"?Boolean(firstDocumentTab)||can("dashboard.customers"):id==="hr"?Boolean(firstHrTab):true).map(([id,label,Icon])=>{
        if(id==="dashboard")return <Fragment key={id}><button className={page===id?"on":""} onClick={()=>{setPage(id);setMenu(false)}}><Icon/>{label}</button></Fragment>;
        if(id==="settings"){
          const inSettings=page==="settings"||page==="companies"||page==="employees"||page==="audit";
          const go=(target:Page)=>{setPage(target);setMenu(false)};
          const admin=isAdmin&&!viewAs;
          return <Fragment key={id}><button className={inSettings?"on":""} onClick={()=>{if(page==="settings"){setDashboardMenuOpen(v=>!v);return}setPage("settings");setDashboardMenuOpen(true)}}><Icon/>{label}</button>{dashboardMenuOpen&&<div className="navchildren">{admin&&<button className={page==="companies"?"on":""} onClick={()=>go("companies")}>Firmalar</button>}{admin&&<button className={page==="employees"?"on":""} onClick={()=>go("employees")}>İstifadəçilər</button>}{admin&&<button className={page==="audit"?"on":""} onClick={()=>go("audit")}>Əməliyyat jurnalı</button>}<button onClick={()=>{setForm({});setDialog("password");setMenu(false)}}>Şifrəni dəyiş</button><button onClick={()=>{setBackgroundFile(null);setDialog("background");setMenu(false)}}>Fon şəkli</button><button onClick={()=>{setOwnAvatarFile(null);setDialog("avatar");setMenu(false)}}>Profil şəkli</button></div>}</Fragment>;
        }
        if(id==="tasks"){
          // The parent badge adds up everything waiting inside (overdue tasks + requests waiting on this user), so nothing hides in a closed menu.
          const pendingTotal=unseenOverdue.length+shownRequestsPending;
          const childrenOpen=tasksMenuOpen||page==="requests"||(page==="tasks"&&taskSubTab!=="overview");
          return <Fragment key={id}><button className={page===id||page==="requests"?"on":""} onClick={()=>{if(page==="tasks"&&taskSubTab==="overview"){toggleTasksMenu();return}setTaskSubTab("overview");setPage("tasks");openTasksMenu()}}><Icon/>{label}{pendingTotal>0&&<em>{pendingTotal}</em>}</button>{childrenOpen&&<div className="navchildren"><button className={page==="tasks"&&taskSubTab==="tasks"&&tasksSection==="manager"?"on":""} onClick={()=>{setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks");setMenu(false)}}>Verilən tapşırıqlar</button>{!viewAs&&can("tasks.requests")&&<button className={page==="requests"?"on":""} onClick={()=>{setPage("requests");setMenu(false)}}>Sorğular{requestsPending>0&&<em>{requestsPending}</em>}</button>}{can("tasks.mine")&&<button className={page==="tasks"&&taskSubTab==="tasks"&&tasksSection==="mine"?"on":""} onClick={()=>{setTaskSubTab("tasks");setTasksSection("mine");setPage("tasks");setMenu(false)}}>Şəxsi işlərim</button>}{can("tasks.fixed")&&<button className={page==="tasks"&&taskSubTab==="fixed"?"on":""} onClick={()=>{setTaskSubTab("fixed");setPage("tasks");setMenu(false)}}>Sabit işlər</button>}</div>}</Fragment>;
        }
        if(id==="documents")return <Fragment key={id}><button className={page===id||page==="customers"?"on":""} onClick={()=>{if(page==="documents"&&documentSubTab==="overview"){setDocumentsMenuOpen(v=>!v);return}setDocumentSubTab("overview");setPage("documents");setDocumentsMenuOpen(true)}}><Icon/>{label}</button>{documentsMenuOpen&&<div className="navchildren">{canDocument("incoming")&&<button className={page==="documents"&&documentSubTab==="incoming"?"on":""} onClick={()=>{setDocumentSubTab("incoming");setPage("documents");setMenu(false)}}>Daxil olan sənədlər{!viewAs&&incomingPending>0&&<em>{incomingPending}</em>}</button>}{canDocument("outgoing")&&<button className={page==="documents"&&documentSubTab==="outgoing"?"on":""} onClick={()=>{setDocumentSubTab("outgoing");setPage("documents");setMenu(false)}}>Çıxan sənədlər</button>}{can("dashboard.customers")&&<button className={page==="customers"?"on":""} onClick={()=>{setPage("customers");setMenu(false)}}>Müştərilər</button>}{canTemplates&&<button className={page==="documents"&&documentSubTab==="templates"?"on":""} onClick={()=>{setDocumentSubTab("templates");setPage("documents");setMenu(false)}}>Şablonlar</button>}</div>}</Fragment>;
        if(id==="hr"){
          const goHr=(tab:"violations"|"orders"|HrSection)=>{setHrSubTab(tab);setPage("hr");setMenu(false)};
          return <Fragment key={id}><button className={page===id?"on":""} onClick={()=>{if(page==="hr"&&hrSubTab==="overview"){setHrMenuOpen(v=>!v);return}setHrSubTab("overview");setPage("hr");setHrMenuOpen(true)}}><Icon/>{label}</button>{hrMenuOpen&&<div className="navchildren">{can("hr.personnel")&&<button className={page==="hr"&&hrSubTab==="personnel"?"on":""} onClick={()=>goHr("personnel")}>Personallar</button>}{can("hr.orders")&&<button className={page==="hr"&&hrSubTab==="orders"?"on":""} onClick={()=>goHr("orders")}>Əmrlər</button>}{can("hr.violations")&&<button className={page==="hr"&&hrSubTab==="violations"?"on":""} onClick={()=>goHr("violations")}>Nöqsanlar</button>}{can("hr.personnel")&&<><button className={page==="hr"&&hrSubTab==="customers"?"on":""} onClick={()=>goHr("customers")}>Əvvəlki iş yerləri</button><button className={page==="hr"&&hrSubTab==="calendar"?"on":""} onClick={()=>goHr("calendar")}>İstehsalat təqvimi</button><button className={page==="hr"&&hrSubTab==="settings"?"on":""} onClick={()=>goHr("settings")}>Hesablama parametrləri</button></>}</div>}</Fragment>;
        }
        return <Fragment key={id}><button className={page===id?"on":""} onClick={()=>{setPage(id);setMenu(false)}}><Icon/>{label}{id==="chat"&&chatUnread>0&&<em>{chatUnread}</em>}</button></Fragment>;
      })}</nav>
      </div>
      <div className="admin"><span>{initials(viewAs?viewAs.name:user.name)}</span><div><b>{viewAs?viewAs.name:user.name}</b><small>{viewAs?"İstifadəçi":isAdmin?"Baş administrator":"İstifadəçi"}</small><small>{viewAs?(viewAs.email||"—"):user.email}</small></div><button className="logoutbtn" title="Çıxış" onClick={()=>void signOut()}><LogOut/></button></div>
    </aside>
    <main className={user.backgroundKey?"hasbg":undefined} style={user.backgroundKey?{backgroundImage:`linear-gradient(rgba(246,248,255,.2),rgba(242,246,251,.2)), url(/api/file?key=${encodeURIComponent(user.backgroundKey)})`,backgroundSize:"cover",backgroundPosition:"center",backgroundAttachment:"fixed"}:undefined}>
      <header><button className="hamb" onClick={()=>setMenu(true)}><Menu/></button><div><div className="headrow">{back&&<button className="backbtn" title={`${back.label} bölməsinə qayıt`} onClick={back.go}><ChevronLeft/>{back.label}</button>}<h1>{subTitle||title[page]}</h1></div><p>{effectiveView?`${effectiveView.name} tapşırıqları`:"İstifadəçiləri, tapşırıqları və nəticələri vahid sistemdə idarə edin"}</p></div><div className="actions"><button onClick={()=>void load()} title="Yenilə"><RefreshCw/></button>{!viewAs&&can("chat")&&<div className="bellwrap"><button className={page==="chat"?"bellbtn chatbtn on":"bellbtn chatbtn"} title="Çat" onClick={()=>{askChatNotificationPermission();openChat()}}><MessageCircle/>{chatUnread>0&&<em className="headerbadge">{chatUnread}</em>}</button></div>}<div className="bellwrap">{notifOpen&&<button className="notifshade" aria-label="Bağla" onClick={()=>setNotifOpen(false)}/>}<button className="bellbtn" title="Bildirişlər" onClick={()=>setNotifOpen(v=>!v)}><Bell/>{(shownRequestsPending+unseenOverdue.length+unseenOverdueDocs.length+(isAdmin&&!viewAs?pendingDateRequests.length:0))>0&&<em className="headerbadge">{shownRequestsPending+unseenOverdue.length+unseenOverdueDocs.length+(isAdmin&&!viewAs?pendingDateRequests.length:0)}</em>}</button>{notifOpen&&<div className="notifpanel">{!viewAs&&can("tasks.requests")&&<div className="notifsection"><b>Sorğular</b><button onClick={()=>{setNotifOpen(false);setPage("requests")}}>{requestsPending>0?`${requestsPending} sorğu sizi gözləyir`:"Gözləyən sorğu yoxdur"}</button></div>}<div className="notifsection"><b>Gecikən tapşırıqlar</b>{overdue.length?<>{overdue.slice(0,5).map(t=><button key={t.id} onClick={()=>{setNotifOpen(false);setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks")}}>{t.title} — {t.employee_name}</button>)}{overdue.length>5&&<small>+{overdue.length-5} daha</small>}</>:<small>Gecikən tapşırıq yoxdur</small>}</div>{shownOverdueDocs.length>0&&<div className="notifsection"><b>Qayıtmayan imzalı nüsxələr</b>{shownOverdueDocs.slice(0,5).map(d=><button key={d.id} onClick={()=>{setNotifOpen(false);setOutgoingPreset(p=>({nonce:(p?.nonce??0)+1}));setDocumentSubTab("outgoing");setPage("documents")}}>№{d.outgoing_no} {d.document_type||"Sənəd"} — {d.organization_name||"—"} (son tarix {formatDateOnly(d.return_due_date)})</button>)}{shownOverdueDocs.length>5&&<small>+{shownOverdueDocs.length-5} daha</small>}</div>}{isAdmin&&!viewAs&&<div className="notifsection"><b>Tarix dəyişikliyi tələbləri</b>{pendingDateRequests.length?<>{pendingDateRequests.slice(0,5).map(r=><button key={r.id} onClick={()=>{setNotifOpen(false);setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks")}}>{r.task_title} — {r.employee_name} → {formatDate(r.proposed_due_at)}</button>)}{pendingDateRequests.length>5&&<small>+{pendingDateRequests.length-5} daha</small>}</>:<small>Gözləyən tələb yoxdur</small>}</div>}</div>}</div></div></header>
      {viewAs&&<div className="viewasbar"><div><strong>{viewAs.name}</strong><span>İstifadəçi görünüşündəsiniz</span></div><button onClick={()=>{setViewAs(null);setPage("employees")}}>Admin görünüşünə qayıt</button></div>}
      {error&&<div className="errorbox">{error}</div>}
      {loading?<div className="loading">Məlumatlar yüklənir...</div>:<>
        {!pageAllowed&&<PlaceholderPage title="Bu bölmə bağlıdır" text="Admin bu bölməni sizin üçün bağlayıb."/>}
        {page==="dashboard"&&<Dashboard showDocuments={can("documents.outgoing")} showViolations={can("hr.violations")} userName={user.name} avatarKey={ownAvatarKey} onEditAvatar={()=>{setOwnAvatarFile(null);setDialog("avatar")}} tasks={visibleTasks} goTasks={status=>{setTaskStatusFilter(status||null);setTaskSubTab("tasks");setTasksSection("manager");setPage("tasks")}} goViolations={employee=>{setViolationEmployeeFilter(employee);setHrSubTab("violations");setPage("hr")}} evaluationEmployees={effectiveView?[effectiveView]:data.employees} ownEmployeeId={effectiveView?effectiveView.id:null} activeCompanyId={activeCompanyId}/>}
        {pageAllowed&&page==="tasks"&&<>
        {taskSubTab==="overview"&&<SectionOverview cards={[
          {key:"manager",title:"Verilən tapşırıqlar",text:"Rəhbərin verdiyi tapşırıqlar, icra və qiymətləndirmə.",stats:[{label:"aktiv",value:activeTasks.length},{label:"gecikən",value:overdue.length,alert:true}],onOpen:()=>{setTaskSubTab("tasks");setTasksSection("manager")}},
          ...(!viewAs&&can("tasks.requests")?[{key:"requests",title:"Sorğular",text:"Şöbələr arası sorğular.",stats:[{label:"cavabımı gözləyir",value:requestsPending,alert:true}],onOpen:()=>setPage("requests")}]:[]),
          ...(can("tasks.mine")?[{key:"mine",title:"Şəxsi işlərim",text:"Özünüz üçün yazdığınız işlər və yoxlama siyahıları.",onOpen:()=>{setTaskSubTab("tasks");setTasksSection("mine")}}]:[]),
          ...(can("tasks.fixed")?[{key:"fixed",title:"Sabit işlər",text:"Həftəlik, aylıq, rüblük, yarımillik və illik təkrarlanan işlər.",stats:[{label:"gecikən",value:FIXED_FREQUENCIES.reduce((n,f)=>n+fixedOverdue(f),0),alert:true}],onOpen:()=>setTaskSubTab("fixed")}]:[]),
        ]}/>}
        {taskSubTab==="tasks"&&<>
        {tasksSection==="manager"&&<TasksPage approvals={viewAs?[]:data.approvals||[]} employeeView={Boolean(effectiveView)} statusFilter={taskStatusFilter} onClearStatusFilter={()=>setTaskStatusFilter(null)} tasks={visibleTasks} onDelete={task=>void deleteTaskItem(task)} onStatus={(task,status,extra)=>void request("PATCH",{action:"task",id:task.id,status,userMode:Boolean(effectiveView),...(extra||{})})} onEvaluate={(task)=>{setSelectedTask(task);open("evaluate",{evaluation:String(task.evaluation||10),evaluationNote:task.evaluation_note||""})}} dateRequests={data.dateRequests} onRequestDate={(taskId,proposedDueAt,reason)=>void request("POST",{action:"date-request",taskId,proposedDueAt,reason})} onResolveDateRequest={(id,approve,adminNote,finalDueAt)=>void request("PATCH",{action:"resolve-date-request",id,approve,adminNote,finalDueAt})} employees={data.employees} isAdmin={isAdmin}/>}
        {tasksSection==="mine"&&<PersonalWorksPage isAdmin={isAdmin} currentUserId={user.id} viewAsEmployeeId={viewAs?.id??null} companies={companyScopeActive?myCompanies:data.companies} employees={activeEmployees} activeCompanyId={activeCompanyId}/>}</>}
        {taskSubTab==="fixed"&&<>{effectiveView&&teamFixed.hasTeam&&<div className="fixedsubtabs"><button className={fixedTeamView?"":"on"} onClick={()=>setFixedScope("mine")}>Mənim sabit işlərim ({ownScopedFixed.length})</button><button className={fixedTeamView?"on":""} onClick={()=>setFixedScope("team")}>Əməkdaşlarımın sabit işləri ({teamFixedScoped.length}){teamFixedOverdue>0&&<em className="requestbadge" title={`${teamFixedOverdue} gecikən`}>{teamFixedOverdue}</em>}</button></div>}<div className="fixedsubtabs fixedfreqtabs">{shownFixedFreqs.map(f=>{const late=shownFixedOverdue(f);const count=effectiveView?scopedFixed.filter(a=>a.frequency===f).length:data.workItems.filter(i=>i.frequency===f).length;return <button key={f} className={activeFixedFreq===f?"on":""} onClick={()=>setFixedFreq(f)}>{FREQUENCY_TITLES[f]} ({count}){late>0&&<em className="requestbadge" title={`${late} gecikən`}>{late}</em>}</button>})}</div>{isAdmin&&!viewAs&&<div className="fixedsubtabs"><button className={fixedTab==="catalog"?"on":""} onClick={()=>setFixedTab("catalog")}>Sabit işlərin siyahısı</button><button className={fixedTab==="assignments"?"on":""} onClick={()=>setFixedTab("assignments")}>Personal sabit işlər</button></div>}<WorkList key={`${activeFixedFreq}-${fixedTeamView?"team":"mine"}`} employeeView={Boolean(effectiveView)} team={fixedTeamView} tab={fixedTab} frequency={activeFixedFreq} items={data.workItems} assignments={scopedFixed} completions={fixedCompletions} employees={activeEmployees} companies={data.companies.filter(c=>Boolean(c.active))} form={form} setForm={setForm} onAdd={()=>void request("POST",{action:"work-item",title:form.workTitle,description:form.workDescription,frequency:activeFixedFreq})} onDue={(item,dueDay,dueMonth)=>void request("PATCH",{action:"work-item",id:item.id,dueDay,dueMonth})} onEditWork={(item,title,description)=>void request("PATCH",{action:"work-item",id:item.id,title,description})} onDeleteWork={item=>void deleteWorkDefinition(item)} onAssign={()=>void request("POST",{action:"work-assignment",workDefinitionId:Number(form.assignWorkId),companyIds:(form.assignCompanyIds||"").split(",").filter(Boolean).map(Number),employeeId:Number(form.assignEmployeeId)})} onCatalogAssign={(workDefinitionId,companyId,employeeId)=>void request("POST",{action:"work-assignment",workDefinitionId,companyIds:[companyId],employeeId})} onCatalogUnassign={(workDefinitionId,companyId,employeeId)=>void request("PATCH",{action:"work-assignment",workDefinitionId,companyId,employeeId,selected:false})} onComplete={(assignmentId,periodKey)=>void request("PATCH",{action:"work-completion",assignmentId,periodKey})} onUncomplete={(assignmentId,periodKey)=>void request("PATCH",{action:"work-uncompletion",assignmentId,periodKey})} isAdmin={isAdmin} fixedStart={data.fixedWorksStart||DEFAULT_FIXED_START} onFixedStart={value=>void request("PATCH",{action:"fixed-works-start",value})}/></>}</>}
        {pageAllowed&&page==="requests"&&<RequestsPage isAdmin={isAdmin} companies={companyScopeActive?myCompanies:data.companies.filter(c=>Boolean(c.active))} activeCompanyId={companyScopeActive?activeCompanyId:null} onActionable={setRequestsPending}/>}
        {page==="employees"&&<EmployeesPage employees={data.employees} companies={data.companies} tasks={data.tasks} onNew={()=>{setEmployeePhoto(null);open("employee")}} onEdit={e=>{setEmployeePhoto(null);open("employee",{id:String(e.id),name:e.name,email:e.email||"",companyIds:e.company_ids||"",companyPositions:companyPositionsForm(e.company_positions),mainCompanyId:e.main_company_id?String(e.main_company_id):"",hiddenSections:e.hidden_sections||"[]",companyPermissions:e.company_permissions||"{}"})}} onView={e=>{setViewAs(e);setPage("dashboard")}} onToggle={e=>void request("PATCH",{action:"employee",id:e.id,active:!Boolean(e.active)})} onDelete={e=>void deleteWorker(e)}/>}
        {pageAllowed&&page==="chat"&&!viewAs&&<ChatPage key={chatFocus?.nonce??0} currentUser={user} onUnread={setChatUnread} initialThread={chatFocus?.thread??0} onViewing={id=>{viewingThreadRef.current=id}} sound={chatSound} onToggleSound={toggleChatSound} full={chatFull} controls={<span className="chatpagectl"><button title="Yığ" onClick={()=>leaveChat(true)}><Minus/></button><button title={chatFull?"Kiçilt":"Bütün ekrana böyüt"} onClick={()=>setChatFull(v=>!v)}>{chatFull?<Minimize2/>:<Maximize2/>}</button><button title="Bağla" onClick={()=>leaveChat(false)}><X/></button></span>}/>}
        {page==="settings"&&<SectionOverview cards={[
          ...(isAdmin&&!viewAs?[{key:"companies",title:"Firmalar",text:"Firmaların məlumatları və strukturu (şöbələr, vəzifələr, tabeçilik).",stats:[{label:"aktiv firma",value:data.companies.filter(c=>Boolean(c.active)).length}],onOpen:()=>setPage("companies")},
            {key:"employees",title:"İstifadəçilər",text:"Proqramın istifadəçiləri, firmaları, vəzifələri və giriş icazələri.",stats:[{label:"aktiv istifadəçi",value:data.employees.filter(e=>Boolean(e.active)).length}],onOpen:()=>setPage("employees")}]:[]),
          ...(isAdmin&&!viewAs?[{key:"audit",title:"Əməliyyat jurnalı",text:"Proqramda edilən əməliyyatların xronoloji siyahısı.",onOpen:()=>setPage("audit")}]:[]),
          {key:"password",title:"Şifrəni dəyiş",text:"Öz giriş şifrənizi dəyişin.",onOpen:()=>{setForm({});setDialog("password")}},
          {key:"background",title:"Fon şəkli",text:"Yalnız sizin görəcəyiniz fon şəkli.",onOpen:()=>{setBackgroundFile(null);setDialog("background")}},
          {key:"avatar",title:"Profil şəkli",text:"Adınızın yanında görünən şəkil.",onOpen:()=>{setOwnAvatarFile(null);setDialog("avatar")}},
        ]}/>}
        {page==="companies"&&<CompaniesPage companies={data.companies} tasks={data.tasks} onNew={()=>open("company")} onEdit={c=>open("company",{id:String(c.id),name:c.name,voen:c.voen||"",manager:c.manager||""})} onToggle={c=>void request("PATCH",{action:"company",id:c.id,active:!Boolean(c.active)})}/>}
        {pageAllowed&&page==="customers"&&<CustomersPage isAdmin={isAdmin} canSeePersonnel={can("hr.personnel")} rights={{add:can("dashboard.customers:add"),edit:can("dashboard.customers:edit"),remove:can("dashboard.customers:delete")}}/>}
        {page==="audit"&&<AuditPage/>}
        {page==="guides"&&<GuidesPage ctx={{isAdmin:isAdmin&&!viewAs,viewEmployeeId:viewAs?.id??null,
          sections:{"chat":can("chat")&&!viewAs,"settings":true,"tasks.manager":true,"tasks.mine":can("tasks.mine"),"tasks.requests":can("tasks.requests")&&!viewAs,"tasks.fixed":can("tasks.fixed"),"documents.incoming":canDocument("incoming"),"documents.outgoing":canDocument("outgoing"),"documents.templates":canTemplates,"dashboard.customers":can("dashboard.customers")},
          rights:{"documents.incoming":can("documents.incoming"),"documents.outgoing":can("documents.outgoing")}}}/>}
        {pageAllowed&&page==="documents"&&<>
        {documentSubTab==="overview"&&<DocumentsOverview showCustomers={can("dashboard.customers")} onOpenCustomers={()=>setPage("customers")} openOverdue={filter=>{setOutgoingPreset(p=>({...filter,nonce:(p?.nonce??0)+1}));setDocumentSubTab("outgoing")}} showTemplates={canTemplates} showOutgoing={canDocument("outgoing")} showIncoming={canDocument("incoming")} activeCompanyId={companyScopeActive?activeCompanyId:null} open={tab=>setDocumentSubTab(tab)}/>}
        {documentSubTab==="templates"&&canTemplates&&<DocumentsPage isAdmin={isAdmin} companies={data.companies.filter(c=>Boolean(c.active))}/>}
        {documentSubTab==="outgoing"&&<OutgoingDocumentsPage preset={outgoingPreset} onPresetUsed={()=>setOutgoingPreset(null)} isAdmin={isAdmin} companies={companyScopeActive?myCompanies:data.companies.filter(c=>Boolean(c.active))} activeCompanyId={companyScopeActive?activeCompanyId:null}/>}
        {documentSubTab==="incoming"&&<IncomingDocumentsPage onPending={n=>{if(!viewAs)setIncomingPending(n)}} isAdmin={isAdmin} companies={companyScopeActive?myCompanies:data.companies.filter(c=>Boolean(c.active))} activeCompanyId={companyScopeActive?activeCompanyId:null}/>}</>}
        {pageAllowed&&page==="hr"&&hrSubTab==="overview"&&<HrOverview showViolations={can("hr.violations")} showPersonnel={can("hr.personnel")} showOrders={can("hr.orders")} activeCompanyId={companyScopeActive?activeCompanyId:null} open={tab=>setHrSubTab(tab)}/>}
        {pageAllowed&&page==="hr"&&hrSubTab!=="overview"&&hrSubTab!=="violations"&&hrSubTab!=="orders"&&<HrPage section={hrSubTab}/>}
        {pageAllowed&&page==="hr"&&hrSubTab==="orders"&&<OrdersPage/>}
        {pageAllowed&&page==="hr"&&hrSubTab==="violations"&&<ViolationsPage isAdmin={isAdmin} employeeFilter={violationEmployeeFilter} onClearEmployeeFilter={()=>setViolationEmployeeFilter(null)} employees={data.employees} companies={data.companies} activeCompanyId={activeCompanyId}/>}
      </>}
    </main>
    {chatMini&&page!=="chat"&&!viewAs&&can("chat")&&<div className="chatmini"><button className="chatminiopen" title="Çatı aç" onClick={openChat}><MessageCircle/><b>Çat</b>{chatUnread>0&&<em>{chatUnread}</em>}</button><button className="chatminiclose" title="Bağla" onClick={()=>setChatMini(false)}><X/></button></div>}
    {chatToast&&<div className={chatMini&&page!=="chat"?"chattoast abovemini":"chattoast"} role="status"><button className="chattoastbody" onClick={()=>openChatAt(chatToast.threadId)}><i className={chatToast.senderAvatar?"hasphoto":""}>{chatToast.threadType==="group"?<Users/>:avatarNode(chatToast.senderAvatar,chatToast.senderName)}</i><span><b>{chatToast.threadType==="group"?`${chatToast.threadName} · ${chatToast.senderName}`:chatToast.senderName}</b><small>{chatToast.unread>1?`${chatToast.unread} yeni mesaj · `:""}{chatToast.text}</small></span></button><button className="chattoastclose" title="Bağla" onClick={()=>setChatToast(null)}><X/></button></div>}
    <Dialog open={dialog!==null} onOpenChange={v=>!v&&setDialog(null)}><DialogContent className="businessdialog" resizable>
      {dialog==="employee"&&<FormShell title={form.id?"İstifadəçi məlumatlarını redaktə et":"Yeni istifadəçi"} desc={form.id?"Ad, e-poçt, firmalar və hər firma üzrə vəzifəni yeniləyin.":"İstifadəçi, giriş hesabı və işləyəcəyi firmalar birlikdə təyin ediləcək."}><Field label="Ad və soyad" value={form.name||""} set={v=>setForm({...form,name:v})}/><Field label="E-poçt" type="email" value={form.email||""} set={v=>setForm({...form,email:v})}/><label className="field filefield">Şəkil (istəyə bağlı, maks. 5 MB)<Input type="file" accept="image/*" onChange={e=>setEmployeePhoto(e.target.files?.[0]||null)}/>{employeePhoto&&<small>{employeePhoto.name}</small>}</label>{!form.id&&<Field label="Müvəqqəti şifrə (ən az 8 simvol)" type="password" value={form.password||""} set={v=>setForm({...form,password:v})}/>}<label className="field">Əsas iş yeri<select value={form.mainCompanyId||""} onChange={e=>{const id=e.target.value;setForm(f=>{const ids=new Set((f.companyIds||"").split(",").filter(Boolean));if(id)ids.add(id);return {...f,mainCompanyId:id,companyIds:[...ids].join(",")}})}}><option value="">Firma seçin</option>{data.companies.filter(c=>Boolean(c.active)||String(c.id)===form.mainCompanyId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><EmployeeCompanyPicker companies={data.companies.filter(c=>Boolean(c.active))} companyIds={form.companyIds||""} companyPositions={form.companyPositions||"{}"} onChange={(companyIds,companyPositions)=>setForm(f=>({...f,companyIds,companyPositions,mainCompanyId:companyIds.split(",").includes(f.mainCompanyId||"")?f.mainCompanyId:""}))}/><PermissionTree hidden={parseHiddenSections(form.hiddenSections)} onChange={next=>setForm(f=>({...f,hiddenSections:JSON.stringify(next)}))} firms={parseCompanyPermissions(form.companyPermissions||"{}")} onFirmsChange={next=>setForm(f=>({...f,companyPermissions:JSON.stringify(next)}))} companies={data.companies.filter(c=>(form.companyIds||"").split(",").includes(String(c.id)))} employee={form.id?data.employees.find(e=>String(e.id)===form.id)||null:null} assignments={data.workAssignments} copyFrom={data.employees.filter(e=>Boolean(e.active)&&String(e.id)!==form.id)}/><Button disabled={uploadingPhoto||(form.id?(!form.name||!form.email):(!form.name||!form.email||(form.password||"").length<8))} onClick={()=>form.id?void saveEmployeeEdit():void createPersonnel()}>{uploadingPhoto?"Şəkil yüklənir...":form.id?"Dəyişiklikləri saxla":"İstifadəçini və giriş hesabını yarat"}</Button></FormShell>}
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

type ChatLatest={id:number;threadId:number;threadName:string;threadType:string;senderName:string;senderAvatar:string|null;text:string;unread:number};
// A short two-note chime made by the browser (no sound file); a browser that blocks it simply stays quiet.
function playChatSound(){
  try{
    const Ctx=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!Ctx)return;
    const ctx=new Ctx();const now=ctx.currentTime;
    [880,1318.5].forEach((freq,i)=>{const osc=ctx.createOscillator();const gain=ctx.createGain();const t=now+i*0.13;osc.type="sine";osc.frequency.value=freq;gain.gain.setValueAtTime(0.0001,t);gain.gain.exponentialRampToValueAtTime(0.16,t+0.02);gain.gain.exponentialRampToValueAtTime(0.0001,t+0.4);osc.connect(gain).connect(ctx.destination);osc.start(t);osc.stop(t+0.45)});
    setTimeout(()=>void ctx.close(),1200);
  }catch{}
}
function askChatNotificationPermission(){try{if("Notification" in window&&Notification.permission==="default")void Notification.requestPermission()}catch{}}
function showChatBrowserNotification(latest:ChatLatest,onOpen:()=>void){
  try{
    if(!("Notification" in window)||Notification.permission!=="granted")return;
    const title=latest.threadType==="group"?`${latest.threadName} · ${latest.senderName}`:latest.senderName;
    const n=new Notification(title,{body:latest.unread>1?`${latest.unread} yeni mesaj · ${latest.text}`:latest.text,tag:`chat-${latest.threadId}`});
    n.onclick=()=>{window.focus();onOpen();n.close()};
  }catch{}
}
// Çat page (2.71 again since Versiya 2.74, opened from 💬 next to the bell). Chat panel size (Versiya 2.66): its left/right edges, bottom edge and bottom corners resize it (it stays centred), and the line
// between the conversation list and the conversation moves. A smaller panel is moved by its top bars: left/right (2.67, CSS keeps
// it inside the work area) and up/down (2.68, never above the page title nor below the bottom of the window). Remembered per browser; a double click on a handle or a top bar restores the default.
type ChatLayout={width:number|null;height:number|null;list:number;x:number;y:number};
const CHAT_LAYOUT_DEFAULT:ChatLayout={width:null,height:null,list:320,x:0,y:0};
type ChatHandle="l"|"r"|"b"|"bl"|"br"|"list"|"move";
function useChatLayout(){
  const [layout,setLayout]=useState<ChatLayout>(CHAT_LAYOUT_DEFAULT);
  useEffect(()=>{try{const raw=window.localStorage.getItem("chat:layout");if(raw)setLayout({...CHAT_LAYOUT_DEFAULT,...JSON.parse(raw)})}catch{}},[]);
  const save=(next:ChatLayout)=>{setLayout(next);try{window.localStorage.setItem("chat:layout",JSON.stringify(next))}catch{}};
  const clamp=(value:number,min:number,max:number)=>Math.min(Math.max(value,min),Math.max(min,max));
  const startDrag=(kind:ChatHandle)=>(e:React.PointerEvent)=>{
    // Each handle sits directly inside the chat panel; a top bar is found from inside it (its buttons and fields keep working).
    if(kind==="move"&&(e.target as HTMLElement).closest("button,input,textarea,select,a"))return;
    const panel=kind==="move"?(e.currentTarget as HTMLElement).closest<HTMLElement>(".chatpanel"):(e.currentTarget as HTMLElement).parentElement;if(!panel||e.button!==0)return;
    e.preventDefault();
    const rect=panel.getBoundingClientRect();
    const room=panel.parentElement?.clientWidth||rect.width;
    const start={x:e.clientX,y:e.clientY,w:rect.width,h:rect.height,list:layout.list,offset:layout.x,offsetY:layout.y,top:rect.top-layout.y};
    let latest=layout;
    const move=(ev:PointerEvent)=>{
      const dx=ev.clientX-start.x,dy=ev.clientY-start.y;
      const next={...latest};
      if(kind==="move"){
        const free=Math.max(0,(room-start.w)/2);next.x=clamp(start.offset+dx,-free,free);
        next.y=clamp(start.offsetY+dy,0,window.innerHeight-start.top-start.h-12);
      }
      else if(kind==="list")next.list=clamp(start.list+dx,200,start.w-360);
      else{
        // The panel is centred, so a side edge moves by the cursor while the width changes on both sides.
        if(kind==="l"||kind==="bl")next.width=clamp(start.w-2*dx,560,room);
        if(kind==="r"||kind==="br")next.width=clamp(start.w+2*dx,560,room);
        if(kind==="b"||kind==="bl"||kind==="br")next.height=clamp(start.h+dy,420,4000);
      }
      latest=next;setLayout(next);
    };
    const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);document.body.classList.remove("chatresizing");save(latest)};
    document.body.classList.add("chatresizing");
    window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);
  };
  const reset=(kind:ChatHandle)=>()=>save(kind==="move"?{...layout,x:0,y:0}:kind==="list"?{...layout,list:CHAT_LAYOUT_DEFAULT.list}:{...layout,width:null,height:null,x:0,y:0});
  const style={"--chat-list":`${layout.list}px`,"--chat-x":`${layout.x}px`,"--chat-y":`${layout.y}px`,...(layout.width?{"--chat-w":`${layout.width}px`}:{}),...(layout.height?{"--chat-h":`${layout.height}px`}:{})} as React.CSSProperties;
  const handles=(["l","r","b","bl","br","list"] as const).map(kind=><span key={kind} className={`chathandle chathandle-${kind}`} title={kind==="list"?"Sürüşdürün — siyahının eni (ikiqat klik: ilkin)":"Sürüşdürün — çatın ölçüsü (ikiqat klik: ilkin)"} onPointerDown={startDrag(kind)} onDoubleClick={reset(kind)}/>);
  const mover={onPointerDown:startDrag("move"),onDoubleClick:reset("move"),title:"Sürüşdürün — çatı sağa-sola, yuxarı-aşağı aparın (ikiqat klik: ilkin yerinə)"};
  return {style,handles,mover,className:`panel chatpanel${layout.width||layout.height?" sized":""}${layout.width?" haswidth":""}`};
}
function ChatPage({currentUser,onUnread,initialThread=0,onViewing,sound,onToggleSound,full=false,controls}:{currentUser:AppUser;onUnread:(value:number)=>void;initialThread?:number;onViewing?:(threadId:number|null)=>void;sound:boolean;onToggleSound:()=>void;full?:boolean;controls?:React.ReactNode}){
  const chatLayout=useChatLayout();
  const [chat,setChat]=useState<ChatData|null>(null);
  const [selected,setSelected]=useState(initialThread);
  // The open conversation gets no new-message notification (Versiya 2.73).
  useEffect(()=>{onViewing?.(selected||null);return()=>onViewing?.(null)},[selected,onViewing]);
  const [message,setMessage]=useState("");
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [chatError,setChatError]=useState("");
  const [threadQuery,setThreadQuery]=useState("");
  const endRef=useRef<HTMLDivElement|null>(null);
  const loadChat=async(threadId=selected,quiet=false)=>{try{if(!quiet)setChatError("");const response=await fetch(`/api/chat${threadId?`?threadId=${threadId}`:""}`);const body=await response.json();if(!response.ok)throw new Error(body.error);setChat(body);setSelected(body.selectedThreadId);onUnread(Number(body.totalUnread||0));await fetch("/api/chat",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({threadId:body.selectedThreadId})});}catch(e){if(!quiet)setChatError(e instanceof Error?e.message:"Çat açıla bilmədi.")}};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void loadChat(initialThread)},[]);
  useEffect(()=>{const timer=setInterval(()=>void loadChat(selected,true),5000);return()=>clearInterval(timer)},[selected]);
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth"})},[chat?.messages.length,selected]);
  const choose=async(id:number)=>{setSelected(id);await loadChat(id)};
  const startDirect=async(userId:number)=>{setBusy(true);setChatError("");try{const response=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"direct",userId})});const body=await response.json();if(!response.ok)throw new Error(body.error);setChat(body);setSelected(body.selectedThreadId);onUnread(Number(body.totalUnread||0))}catch(e){setChatError(e instanceof Error?e.message:"Söhbət yaradıla bilmədi.")}finally{setBusy(false)}};
  const send=async()=>{if((!message.trim()&&!file)||busy)return;setBusy(true);setChatError("");try{let attachment:Record<string,unknown>={};if(file){if(file.size>25*1024*1024)throw new Error("Faylın həcmi 25 MB-dan çox ola bilməz.");const form=new FormData();form.append("file",file);const uploaded=await fetch("/api/file",{method:"POST",body:form});const result=await uploaded.json();if(!uploaded.ok)throw new Error(result.error);attachment={attachmentKey:result.key,attachmentName:result.name,attachmentSize:result.size,attachmentType:result.type}}const response=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"send",threadId:selected,message,...attachment})});const body=await response.json();if(!response.ok)throw new Error(body.error);setChat(body);setMessage("");setFile(null);onUnread(Number(body.totalUnread||0))}catch(e){setChatError(e instanceof Error?e.message:"Mesaj göndərilmədi.")}finally{setBusy(false)}};
  const active=chat?.threads.find(t=>t.id===selected);
  // Versiya 2.80: one list — the group chat on top, then everyone you wrote with (latest first), then the colleagues you have not
  // written with yet (by name). Picking one of those opens a new conversation there; the open conversation no longer jumps to the top.
  type ChatEntry={key:string;threadId:number|null;userId:number|null;type:"group"|"direct";name:string;avatar_key:string|null;last_message:string|null;last_message_at:string|null;unread:number};
  const directWith=new Set((chat?.threads||[]).filter(t=>t.type==="direct"&&t.other_user_id).map(t=>Number(t.other_user_id)));
  const chatEntries:ChatEntry[]=[
    ...(chat?.threads||[]).map(t=>({key:`t${t.id}`,threadId:t.id,userId:t.other_user_id??null,type:t.type,name:t.name,avatar_key:t.avatar_key,last_message:t.last_message,last_message_at:t.last_message_at,unread:Number(t.unread||0)})),
    ...(chat?.users||[]).filter(u=>!directWith.has(u.id)).map(u=>({key:`u${u.id}`,threadId:null,userId:u.id,type:"direct" as const,name:u.name,avatar_key:u.avatar_key,last_message:null,last_message_at:null,unread:0})),
  ].sort((a,b)=>(a.type==="group"?0:1)-(b.type==="group"?0:1)||(b.last_message_at?1:0)-(a.last_message_at?1:0)||String(b.last_message_at||"").localeCompare(String(a.last_message_at||""))||a.name.localeCompare(b.name,"az"));
  const filteredEntries=chatEntries.filter(e=>e.name.toLocaleLowerCase("az-AZ").includes(threadQuery.trim().toLocaleLowerCase("az-AZ")));
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
  return <section className={full?`${chatLayout.className} fullscreen`:chatLayout.className} style={chatLayout.style}>
    {!full&&chatLayout.handles}
    <aside className="chatlist"><div className="chatlisthead" {...chatLayout.mover}><div><span className="sectioneyebrow">DAXİLİ YAZIŞMA</span><h2>Söhbətlər</h2></div><button className="chatsound" title={sound?"Yeni mesajda səs: açıq (söndür)":"Yeni mesajda səs: söndürülüb (yandır)"} onClick={onToggleSound}>{sound?<Volume2/>:<VolumeX/>}</button></div>
      <div className="chatsearch"><input placeholder="Axtarış..." value={threadQuery} onChange={e=>setThreadQuery(e.target.value)}/></div>
      <div className="threadlist">{filteredEntries.map(t=><button key={t.key} disabled={busy&&!t.threadId} className={t.threadId&&t.threadId===selected?"active":""} onClick={()=>void(t.threadId?choose(t.threadId):startDirect(Number(t.userId)))}><i className={t.type!=="group"&&t.avatar_key?"hasphoto":""}>{t.type==="group"?<Users/>:avatarNode(t.avatar_key,t.name)}</i><span><b>{t.name}</b><small>{t.last_message||(t.last_message_at?"📎 Fayl":t.threadId?"Hələ mesaj yoxdur":"Yazışma yoxdur")}</small></span><span className="threadside">{t.last_message_at&&<time>{threadTime(t.last_message_at)}</time>}{t.unread>0&&<em>{t.unread}</em>}</span></button>)}{!filteredEntries.length&&chat&&<small className="chatnoresult">Axtarışa uyğun ad tapılmadı.</small>}</div>
    </aside>
    <div className="chatroom"><header className="chatroomhead" {...chatLayout.mover}><i className={active&&active.type!=="group"&&active.avatar_key?"hasphoto":""}>{active?.type==="group"?<Users/>:active?avatarNode(active.avatar_key,active.name):<MessageCircle/>}</i><div><h2>{active?.name||"Çat yüklənir..."}</h2><p>{active?.type==="group"?"Bütün aktiv istifadəçilər":"Şəxsi yazışma"}</p></div>{controls}</header>
      {chatError&&<div className="chaterror">{chatError}</div>}
      <div className="messages">{timeline.length?timeline.map(item=>item.kind==="date"?<div className="datedivider" key={item.key}><span>{item.label}</span></div>:<article key={item.message.id} className={`${item.mine?"mine":""}${item.grouped?" grouped":""}`}><div className="messagebubble">{item.showName&&<span className="msgsender"><i className={item.message.sender_avatar_key?"hasphoto":""}>{avatarNode(item.message.sender_avatar_key,item.message.sender_name)}</i><b>{item.message.sender_name}</b></span>}{item.message.body&&<p>{item.message.body}</p>}{item.message.attachment_key&&<a href={`/api/file?key=${encodeURIComponent(item.message.attachment_key)}`}><FileText/><span>{item.message.attachment_name||"Fayl"}<small>{chatFileSize(item.message.attachment_size||0)}</small></span><Download/></a>}<time>{new Intl.DateTimeFormat("az-AZ",{hour:"2-digit",minute:"2-digit"}).format(new Date(item.message.created_at))}{item.ticks&&<span className={`ticks ${item.ticks}`}>{item.ticks==="read"?"✓✓":"✓"}</span>}</time></div></article>):<div className="chatempty"><MessageCircle/><h3>İlk mesajı yazın</h3><p>Bu söhbətdə hələ mesaj yoxdur.</p></div>}<div ref={endRef}/></div>
      <div className="composer">{file&&<div className="selectedfile"><Paperclip/><span>{file.name}<small>{chatFileSize(file.size)}</small></span><button onClick={()=>setFile(null)}><X/></button></div>}<div><label title="Fayl əlavə et"><Paperclip/><input type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/></label><Textarea placeholder="Mesajınızı yazın..." value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send()}}}/><Button title={busy?"Göndərilir...":"Göndər"} disabled={busy||(!message.trim()&&!file)} onClick={()=>void send()}><Send/></Button></div></div>
    </div>
  </section>
}

function chatFileSize(size:number){if(!size)return "";if(size<1024)return `${size} B`;if(size<1024*1024)return `${(size/1024).toFixed(1)} KB`;return `${(size/1024/1024).toFixed(1)} MB`}
function threadTime(iso:string){const d=new Date(iso);const now=new Date();if(d.toDateString()===now.toDateString())return new Intl.DateTimeFormat("az-AZ",{hour:"2-digit",minute:"2-digit"}).format(d);const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);if(d.toDateString()===yesterday.toDateString())return "Dünən";return new Intl.DateTimeFormat("az-AZ",{day:"2-digit",month:"2-digit"}).format(d)}
function dayLabel(iso:string){const d=new Date(iso);const now=new Date();if(d.toDateString()===now.toDateString())return "Bugün";const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);if(d.toDateString()===yesterday.toDateString())return "Dünən";return new Intl.DateTimeFormat("az-AZ",{day:"2-digit",month:"long",year:"numeric"}).format(d)}

function Dashboard({showDocuments=true,showViolations=true,userName,avatarKey,onEditAvatar,tasks,goTasks,goViolations,evaluationEmployees,ownEmployeeId,activeCompanyId}:{showDocuments?:boolean;showViolations?:boolean;goViolations?:(employee:{id:number;name:string})=>void;userName:string;avatarKey:string|null;onEditAvatar:()=>void;tasks:Task[];goTasks:(status?:string)=>void;evaluationEmployees:Employee[];ownEmployeeId:number|null;activeCompanyId?:number|null}){return <><section className="welcome"><div><small>{new Intl.DateTimeFormat("az-AZ",{day:"2-digit",month:"long",year:"numeric"}).format(new Date()).toUpperCase()}</small><h2>Salam, {userName}</h2><p>Bu gün komandanızın iş vəziyyətini buradan izləyə bilərsiniz.</p></div><div className="welcomeaside"><button className={avatarKey?"welcomephotobtn":"welcomephotobtn empty"} title={avatarKey?"Profil şəklini dəyiş":"Profil şəkli əlavə et"} onClick={onEditAvatar}>{avatarKey?<img className="welcomephoto" src={`/api/file?key=${encodeURIComponent(avatarKey)}`} alt={userName}/>:<span className="welcomephoto">{initials(userName)}</span>}</button><Bell/></div></section><EvaluationSection employees={evaluationEmployees} tasks={tasks}/>{ownEmployeeId&&showViolations&&<MyViolationsPanel employeeId={ownEmployeeId} activeCompanyId={activeCompanyId}/>}<div className="modulecharts"><TaskStatusChart tasks={tasks} onViewAll={goTasks}/>{showDocuments&&<DocumentsOverviewChart/>}{showViolations&&<ViolationsChart onOpenEmployee={goViolations}/>}</div></>}
// The dashboard groups "Bağlandı" with "Təsdiqlənib"; the donut and the status filter it opens on the Tasks page share this label.
const TASK_STATUS_COLORS:[string,string][]=[["Yeni","#64748b"],["İcradadır","#0C8599"],["Geri qaytarılıb","#7c3aed"],["Təqdim edilib","#f59e0b"],["Qiymətləndirmə gözləyir","#ea580c"],["Təsdiqlənib","#16a34a"],["Gecikib","#dc2626"]];
function dashboardTaskStatus(t:Task){const shown=displayStatus(t);return shown==="Bağlandı"?"Təsdiqlənib":shown}
function TaskStatusChart({tasks,onViewAll}:{tasks:Task[];onViewAll:(status?:string)=>void}){
  const [hover,setHover]=useState<string|null>(null);
  const counts=Object.fromEntries(TASK_STATUS_COLORS.map(([label])=>[label,0])) as Record<string,number>;
  tasks.forEach(t=>{const label=dashboardTaskStatus(t);if(label in counts)counts[label]++});
  const rows=TASK_STATUS_COLORS.filter(([label])=>counts[label]>0);
  const total=rows.reduce((sum,[label])=>sum+counts[label],0);
  const pct=(n:number)=>total?Math.round(n/total*100):0;
  // A circle of circumference 100, so each segment's dash length is its percentage; segments start at 12 o'clock.
  const segments=rows.reduce<{label:string;color:string;share:number;start:number}[]>((acc,[label,color])=>{const prev=acc[acc.length-1];acc.push({label,color,share:counts[label]/total*100,start:prev?prev.start+prev.share:0});return acc},[]);
  const focus=hover&&counts[hover]?hover:null;
  return <section className="panel modulepanel"><div className="head"><div><h3>Tapşırıqlar</h3><p>Status üzrə paylanma</p></div><button onClick={()=>onViewAll()}>Hamısına bax</button></div>
    {rows.length?<div className="donutwrap">
      <div className="donut"><svg viewBox="0 0 42 42" role="img" aria-label="Tapşırıqların status üzrə paylanması">
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#eef2f7" strokeWidth="6"/>
        {segments.map(seg=><circle key={seg.label} className={`donutseg${focus&&focus!==seg.label?" dim":""}`} cx="21" cy="21" r="15.9155" fill="none" stroke={seg.color} strokeWidth={focus===seg.label?7.5:6} strokeDasharray={`${seg.share} ${100-seg.share}`} strokeDashoffset={25-seg.start} onMouseEnter={()=>setHover(seg.label)} onMouseLeave={()=>setHover(null)} onClick={()=>onViewAll(seg.label)}><title>{`${seg.label}: ${counts[seg.label]} (${pct(counts[seg.label])}%)`}</title></circle>)}
      </svg><div className="donutcenter"><b>{focus?counts[focus]:total}</b><small>{focus||"tapşırıq"}</small></div></div>
      <div className="donutlegend">{rows.map(([label,color])=><button key={label} className={focus===label?"on":""} onMouseEnter={()=>setHover(label)} onMouseLeave={()=>setHover(null)} onClick={()=>onViewAll(label)} title={`${label} statusunda olan tapşırıqlara bax`}><i style={{background:color}}/><span>{label}</span><b>{counts[label]}</b><small>{pct(counts[label])}%</small></button>)}</div>
    </div>:<Empty text="Hələ tapşırıq yoxdur."/>}
  </section>;
}
function DocumentsOverviewChart(){
  const [counts,setCounts]=useState<{templates:number;outgoing:number}|null>(null);
  useEffect(()=>{let cancelled=false;Promise.all([fetch("/api/documents").then(r=>r.ok?r.json():{items:[]}),fetch("/api/documents/outgoing").then(r=>r.ok?r.json():{items:[]})]).then(([tpl,out])=>{if(!cancelled)setCounts({templates:(tpl.items||[]).length,outgoing:(out.items||[]).length})}).catch(()=>{if(!cancelled)setCounts({templates:0,outgoing:0})});return()=>{cancelled=true}},[]);
  const cards:[string,number,string][]=[["Şablonlar",counts?.templates||0,"#0C8599"],["Çıxan sənədlər",counts?.outgoing||0,"#d97706"]];
  return <section className="panel modulepanel"><div className="head"><div><h3>Sənədlər</h3><p>Ümumi say üzrə</p></div></div>
    {!counts?<small className="checklistempty">Yüklənir...</small>:<div className="doccounts">{cards.map(([label,count,color])=><div className="doccount" key={label} style={{borderTopColor:color}}><small>{label}</small><b style={{color}}>{count}</b></div>)}</div>}
  </section>;
}
type ViolationPeriod="month"|"3m"|"year"|"all";
const VIOLATION_PERIODS:[ViolationPeriod,string][]=[["month","Bu ay"],["3m","3 ay"],["year","Bu il"],["all","Hamısı"]];
const SHORT_MONTHS=["Yan","Fev","Mar","Apr","May","İyn","İyl","Avq","Sen","Okt","Noy","Dek"];
// The chosen period and the equally long stretch right before it ("Bu ay"/"Bu il" compare to the same days of last month/year).
function violationPeriodRange(period:ViolationPeriod,now:Date){
  const y=now.getFullYear(),m=now.getMonth(),d=now.getDate();
  const shift=(months:number)=>{const first=new Date(y,m+months,1);const last=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();return new Date(first.getFullYear(),first.getMonth(),Math.min(d,last),now.getHours(),now.getMinutes(),now.getSeconds())};
  if(period==="month")return {start:new Date(y,m,1),prevStart:new Date(y,m-1,1),prevEnd:shift(-1),prevLabel:"keçən ayın eyni dövrü ilə müqayisədə"};
  if(period==="3m")return {start:shift(-3),prevStart:shift(-6),prevEnd:shift(-3),prevLabel:"əvvəlki 3 ay ilə müqayisədə"};
  if(period==="year")return {start:new Date(y,0,1),prevStart:new Date(y-1,0,1),prevEnd:shift(-12),prevLabel:"keçən ilin eyni dövrü ilə müqayisədə"};
  return null;
}
function ViolationsChart({onOpenEmployee}:{onOpenEmployee?:(employee:{id:number;name:string})=>void}){
  const [items,setItems]=useState<Violation[]|null>(null);
  const [period,setPeriod]=useState<ViolationPeriod>("3m");
  const [now]=useState(()=>new Date());
  useEffect(()=>{let cancelled=false;fetch("/api/violations").then(r=>r.ok?r.json():{items:[]}).then(body=>{if(!cancelled)setItems(body.items||[])}).catch(()=>{if(!cancelled)setItems([])});return()=>{cancelled=true}},[]);
  const all=(items||[]).map(v=>({v,at:new Date(v.created_at)}));
  const range=violationPeriodRange(period,now);
  const current=range?all.filter(x=>x.at>=range.start):all;
  const previous=range?all.filter(x=>x.at>=range.prevStart&&x.at<range.prevEnd).length:0;
  const delta=current.length-previous;
  const byEmployee=new Map<number,{id:number;name:string;count:number;companies:Set<string>}>();
  current.forEach(({v})=>{const row=byEmployee.get(v.employee_id)||{id:v.employee_id,name:v.employee_name,count:0,companies:new Set<string>()};row.count++;if(v.company_name)row.companies.add(v.company_name);byEmployee.set(v.employee_id,row)});
  const ranked=[...byEmployee.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"az"));
  const rows=ranked.slice(0,6);
  const max=Math.max(...rows.map(r=>r.count),1);
  const months=Array.from({length:6},(_,i)=>{const start=new Date(now.getFullYear(),now.getMonth()-5+i,1);const end=new Date(start.getFullYear(),start.getMonth()+1,1);return {key:`${start.getFullYear()}-${start.getMonth()}`,label:SHORT_MONTHS[start.getMonth()],count:all.filter(x=>x.at>=start&&x.at<end).length}});
  const monthMax=Math.max(...months.map(x=>x.count),1);
  return <section className="panel modulepanel"><div className="head"><div><h3>Kadrlar</h3><p>İstifadəçilər üzrə qeydə alınan noqsanlar</p></div><div className="hrperiods">{VIOLATION_PERIODS.map(([key,label])=><button key={key} className={period===key?"on":""} onClick={()=>setPeriod(key)}>{label}</button>)}</div></div>
    {items===null?<small className="checklistempty">Yüklənir...</small>:!items.length?<Empty text="Qeydə alınmış noqsan yoxdur."/>:<div className="hrchart">
      <div className="hrsummary"><b>{current.length}</b><span>noqsan</span>{range&&<><em className={delta>0?"up":delta<0?"down":""}>{delta>0?`+${delta} ↑`:delta<0?`−${-delta} ↓`:"dəyişməyib"}</em><small>{range.prevLabel}</small></>}</div>
      <div className="hrtrend" aria-label="Son 6 ay üzrə noqsanlar">{months.map((x,i)=><div key={x.key} className={i===months.length-1?"now":""} title={`${x.label}: ${x.count} noqsan`}><small>{x.count||""}</small><span style={{height:`${x.count?Math.max(x.count/monthMax*100,6):0}%`}}/><i>{x.label}</i></div>)}</div>
      {rows.length?<div className="trendbars">{rows.map(r=><button type="button" className="trendrow hrrow" key={r.id} onClick={()=>onOpenEmployee?.({id:r.id,name:r.name})} title={`${r.name} — noqsanlara bax`}><span className="trendname">{r.name}{r.companies.size>0&&<small>{[...r.companies].join(", ")}</small>}</span><div className="trendtrack"><span className="trendfill" style={{left:0,width:`${(r.count/max)*100}%`,background:"#dc2626",borderRadius:6}}/></div><span className="trendcount">{r.count}</span></button>)}{ranked.length>rows.length&&<small className="hrmore">+{ranked.length-rows.length} işçi daha</small>}</div>:<small className="checklistempty">Bu dövrdə noqsan qeydə alınmayıb.</small>}
    </div>}
  </section>;
}
function MyViolationsPanel({employeeId,activeCompanyId}:{employeeId:number;activeCompanyId?:number|null}){
  const [items,setItems]=useState<Violation[]|null>(null);
  useEffect(()=>{let cancelled=false;void fetch("/api/violations").then(r=>r.ok?r.json():{items:[]}).then(body=>{if(cancelled)return;const own=(body.items||[]).filter((i:Violation)=>i.employee_id===employeeId&&(!activeCompanyId||i.company_id===activeCompanyId));setItems(own)}).catch(()=>{if(!cancelled)setItems([])});return()=>{cancelled=true}},[employeeId,activeCompanyId]);
  if(items===null)return null;
  return <section className="panel">
    <div className="head"><div><h3>Nöqsanlarım</h3><p>{items.length?`Ümumi ${items.length} qeyd`:"Qeydə alınmış noqsan yoxdur"}</p></div></div>
    {items.length?<div className="auditlist">{items.slice(0,5).map(item=><article key={item.id}><b>{formatDate(item.created_at)}</b><span>{item.title}</span><span>{item.company_name||"—"}</span><span>{item.note||"—"}</span></article>)}</div>:<Empty text="Hələ qeydə alınmış noqsanınız yoxdur."/>}
  </section>;
}
function TasksPage({approvals=[],employeeView,statusFilter,onClearStatusFilter,tasks:allTasks,onDelete,onStatus,onEvaluate,dateRequests,onRequestDate,onResolveDateRequest,employees,isAdmin}:{approvals?:Task[];employeeView:boolean;statusFilter?:string|null;onClearStatusFilter?:()=>void;tasks:Task[];onDelete:(t:Task)=>void;onStatus:(t:Task,s:string,extra?:Record<string,unknown>)=>void;onEvaluate:(t:Task)=>void;dateRequests:DateRequest[];onRequestDate:(taskId:number,proposedDueAt:string,reason:string)=>void;onResolveDateRequest:(id:number,approve:boolean,adminNote:string,finalDueAt:string)=>void;employees:Employee[];isAdmin:boolean}){
  const tasks=statusFilter?allTasks.filter(t=>dashboardTaskStatus(t)===statusFilter):allTasks;
  // Versiya 2.82: tasks this user gave (handed-on steps, the director's dərkənar) that were submitted and wait for their approval.
  const [view,setView]=useState<"mine"|"approve">("mine");
  if(view==="approve")return <section className="panel pagepanel">
    <div className="fixedsubtabs"><button onClick={()=>setView("mine")}>Mənim tapşırıqlarım ({tasks.length})</button><button className="on">Təsdiqimi gözləyir ({approvals.length})</button></div>
    <div className="pageactions"><div><h2>Təsdiqimi gözləyir</h2><p>Verdiyiniz və təqdim edilmiş tapşırıqlar — qiymətləndirin və ya səbəbini yazıb geri qaytarın</p></div></div>
    {approvals.length?<TaskGrid tasks={approvals} employeeView={false} onStatus={onStatus} onEvaluate={onEvaluate} onDelete={onDelete} dateRequests={[]} onRequestDate={onRequestDate} onResolveDateRequest={onResolveDateRequest} employees={employees} isAdmin={false}/>:<Empty text="Təsdiqinizi gözləyən tapşırıq yoxdur."/>}
  </section>;
  return <section className="panel pagepanel">
    {approvals.length>0&&<div className="fixedsubtabs"><button className="on">Mənim tapşırıqlarım ({tasks.length})</button><button onClick={()=>setView("approve")}>Təsdiqimi gözləyir ({approvals.length})<em className="requestbadge">{approvals.length}</em></button></div>}
    <div className="pageactions"><div><h2>{employeeView?"Mənim tapşırıqlarım":"Bütün tapşırıqlar"}</h2><p>{tasks.length} tapşırıq göstərilir</p></div>{statusFilter&&<button className="statusfilterchip" onClick={onClearStatusFilter} title="Süzgəci sil">Status: {statusFilter} <X/></button>}</div>
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
  const [newFiles,setNewFiles]=useState<File[]>([]);
  const [busy,setBusy]=useState(false);
  const [detailItem,setDetailItem]=useState<PersonalWork|null>(null);
  const [editingWork,setEditingWork]=useState(false);
  const [editFiles,setEditFiles]=useState<File[]>([]);
  const [editKept,setEditKept]=useState<FileRef[]>([]);
  const [checklist,setChecklist]=useState<PersonalWorkChecklistItem[]>([]);
  const [delegateCandidates,setDelegateCandidates]=useState<DelegateCandidate[]>([]);
  const [requestDepartments,setRequestDepartments]=useState<string[]>([]);
  const [checklistLoading,setChecklistLoading]=useState(false);
  const [checklistTitle,setChecklistTitle]=useState("");
  const [checklistBusy,setChecklistBusy]=useState(false);
  const [checklistError,setChecklistError]=useState("");
  const [checklistAttachBusy,setChecklistAttachBusy]=useState<number|null>(null);
  const [history,setHistory]=useState<{workId:number;events:WorkHistoryEvent[]}|null>(null);
  // Versiya 2.85: "Əməkdaşlarımın işləri" — the personal works of everyone below the viewer in the firm's structure, read-only with notes.
  const [tab,setTab]=useState<"mine"|"team">("mine");
  const [teamItems,setTeamItems]=useState<PersonalWork[]>([]);
  const [hasTeam,setHasTeam]=useState(false);
  const [onlyLate,setOnlyLate]=useState(false);
  const [note,setNote]=useState("");
  const [noteBusy,setNoteBusy]=useState(false);
  const [noteError,setNoteError]=useState("");
  const loadTeam=async()=>{try{const response=await fetch(worksUrl("scope=team"));const body=await response.json();if(response.ok){setTeamItems(body.items||[]);setHasTeam(Boolean(body.hasTeam))}}catch{}};
  // Quiet refresh (no loading flash) so the "İcraçılar" column updates right after a step is added, ticked or handed over.
  const reloadItems=async()=>{try{const response=await fetch(worksUrl());const body=await response.json();if(response.ok)setItems(body.items||[])}catch{}};
  const load=async()=>{setLoading(true);setError("");try{const response=await fetch(worksUrl());const body=await response.json();if(!response.ok)throw new Error(body.error);setItems(body.items||[])}catch(e){setError(e instanceof Error?e.message:"Siyahı açıla bilmədi.")}finally{setLoading(false)}};
  useEffect(()=>{void load();void loadTeam()},[]);
  const create=async()=>{
    if(!form.title.trim())return;
    setBusy(true);setError("");
    try{
      const files=await uploadFiles(newFiles);
      const response=await fetch(worksUrl(),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:form.title,description:form.description,companyId:form.companyId||undefined,dueAt:form.dueAt?new Date(form.dueAt).toISOString():undefined,files})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(body.items||[]);setForm({title:"",description:"",companyId:"",dueAt:""});setNewFiles([]);setCreating(false);
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
  const openDetail=(item:PersonalWork)=>{setDetailItem(item);setEditingWork(false);setNote("");setNoteError("")};
  const startEditWork=(item:PersonalWork)=>{setForm({id:String(item.id),title:item.title,description:item.description||"",companyId:item.company_id?String(item.company_id):"",dueAt:item.due_at?toDateTimeLocal(item.due_at):""});setEditFiles([]);setEditKept(rowFiles(item.files,item.attachment_key,item.attachment_name,item.attachment_size));setEditingWork(true)};
  const cancelEditWork=()=>{setEditingWork(false);setEditFiles([])};
  // Versiya 2.102: a completed work's files are still changed (its other details stay fixed); 2.104: several files.
  const changeWorkFiles=async(work:PersonalWork,keep:FileRef[],add:File[])=>{
    setBusy(true);setError("");
    try{
      const files=[...keep,...await uploadFiles(add)];
      const response=await fetch(worksUrl(),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:work.id,action:"file",files})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(body.items||[]);
      const updated=(body.items||[]).find((i:PersonalWork)=>i.id===work.id);
      if(updated)setDetailItem(updated);
    }catch(e){setError(e instanceof Error?e.message:"Fayl dəyişdirilmədi.")}finally{setBusy(false)}
  };
  const saveWorkEdit=async()=>{
    if(!detailItem||!form.title.trim())return;
    setBusy(true);setError("");
    try{
      const files=[...editKept,...await uploadFiles(editFiles)];
      const response=await fetch(worksUrl(),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:Number(form.id),title:form.title,description:form.description,companyId:form.companyId||undefined,dueAt:form.dueAt?new Date(form.dueAt).toISOString():undefined,files})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(body.items||[]);
      const updated=(body.items||[]).find((i:PersonalWork)=>i.id===Number(form.id));
      if(updated)setDetailItem(updated);
      setEditingWork(false);setEditFiles([]);setForm({title:"",description:"",companyId:"",dueAt:""});
    }catch(e){setError(e instanceof Error?e.message:"İş yenilənmədi.")}
    finally{setBusy(false)}
  };
  const personalWorkColumns:Array<{key:string;label:string;width:number;search:(item:PersonalWork)=>string;values?:(item:PersonalWork)=>string[];sort?:(item:PersonalWork)=>string|number|null;render:(item:PersonalWork)=>React.ReactNode}>=[
    {key:"owner",label:"Əməkdaş",width:160,search:i=>i.owner_name,render:i=><b>{i.owner_name}</b>},
    {key:"status",label:"Status",width:120,search:i=>i.status,render:i=>workLate(i)?<><span className="tablestatus late">Gecikib</span><LateDays due={i.due_at}/></>:<span className={`tablestatus ${statusTone(i.status)}`}>{i.status}</span>},
    {key:"company",label:"Firma",width:140,search:i=>i.company_name||"",render:i=><b>{i.company_name||"—"}</b>},
    {key:"title",label:"İş",width:170,search:i=>i.title,render:i=><button className="taskdetailbtn" onClick={()=>openDetail(i)}>{i.title}</button>},
    {key:"description",label:"Açıqlama",width:220,search:i=>i.description||"—",render:i=><>{i.description||"—"}</>},
    {key:"document",label:"Əlavə olunan sənəd",width:150,search:i=>rowFiles(i.files,i.attachment_key,i.attachment_name).map(f=>f.name).join(", ")||"Sənəd yoxdur",render:i=><FileLinks files={rowFiles(i.files,i.attachment_key,i.attachment_name,i.attachment_size)} empty={<span className="nodocument">Sənəd yoxdur</span>}/>},
    {key:"created",label:"Yaranma tarixi",width:140,search:i=>formatDate(i.created_at),sort:i=>new Date(i.created_at).getTime(),render:i=><time>{formatDate(i.created_at)}</time>},
    {key:"due",label:"Son tarix",width:150,search:i=>i.due_at?formatDate(i.due_at):"—",sort:i=>i.due_at?new Date(i.due_at).getTime():null,render:i=>i.due_at?<time>{formatDate(i.due_at)}</time>:"—"},
    {key:"shared",label:"İcraçılar",width:200,search:i=>workExecutors(i).map(x=>x.label).join(", ")||"—",values:i=>workExecutors(i).map(x=>x.label),render:i=>{const people=workExecutors(i);return people.length?<div className="sharedlist">{people.map(x=><span key={x.key} className={`sharedname${x.own?" own":""}${x.done>=x.total?" done":""}`} title={x.done>=x.total?"Bütün addımlar tamamlanıb":"İcra edir"}>{x.name}{x.own&&<em> (özüm)</em>}{x.dept&&<em> (şöbə)</em>}<small> {x.done}/{x.total}</small></span>)}</div>:<span className="nodocument">—</span>}},
  ];
  const {order,widths,setWidth,moveColumn}=useTableColumns("personalworks2",personalWorkColumns.map(c=>c.key));
  const resize=useEdgeResize(setWidth,60);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(personalWorkColumns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(personalWorkColumns.map(c=>[c.key,c.width]));
  const scopeCompany=!isAdmin||Boolean(viewAsEmployeeId);
  const inScope=(item:PersonalWork)=>!scopeCompany||!activeCompanyId||item.company_id===activeCompanyId;
  const team=tab==="team"&&hasTeam;
  const excelMine=useExcelFilters("personalworks",personalWorkColumns.filter(c=>c.key!=="owner"),items.filter(inScope));
  const teamScoped=teamItems.filter(inScope);
  const teamLate=teamScoped.filter(workLate).length;
  const excelTeam=useExcelFilters("personalworksteam",personalWorkColumns,onlyLate?teamScoped.filter(workLate):teamScoped);
  const excel=team?excelTeam:excelMine;
  const filtered=excel.rows;
  const visibleOrder=team?order:order.filter(key=>key!=="owner");
  const current=detailItem&&(items.find(i=>i.id===detailItem.id)||teamItems.find(i=>i.id===detailItem.id))||detailItem;
  const addNote=async()=>{
    if(!current||!note.trim())return;
    setNoteBusy(true);setNoteError("");
    try{
      const response=await fetch("/api/personal-work-history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({personalWorkId:current.id,text:note})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setHistory({workId:current.id,events:body.events||[]});setNote("");
    }catch(e){setNoteError(e instanceof Error?e.message:"Qeyd əlavə olunmadı.")}
    finally{setNoteBusy(false)}
  };
  const currentOwn=Boolean(current&&isOwn(current));
  const unfinishedSteps=checklist.filter(i=>!i.done).length;
  // Every change in the dialog (status, steps, files, hand-overs) replaces `checklist` or `status`, so the history refreshes with it.
  const currentId=current?.id;
  const currentStatus=current?.status;
  useEffect(()=>{if(!currentId)return;let cancelled=false;void fetch(`/api/personal-work-history?personalWorkId=${currentId}`).then(r=>r.ok?r.json():{events:[]}).then(body=>{if(!cancelled)setHistory({workId:currentId,events:body.events||[]})});return()=>{cancelled=true}},[currentId,currentStatus,checklist]);
    useEffect(()=>{if(!current){setChecklist([]);setChecklistError("");return}let cancelled=false;setChecklistLoading(true);void fetch(`/api/personal-work-checklist?personalWorkId=${current.id}`).then(r=>r.ok?r.json():{items:[]}).then(body=>{if(!cancelled){setChecklist(body.items||[]);setDelegateCandidates(body.candidates||[]);setRequestDepartments(body.canRequest?body.requestDepartments||[]:[])}}).finally(()=>{if(!cancelled)setChecklistLoading(false)});return()=>{cancelled=true}},[current?.id,current?.company_id]);
  const addChecklistItem=async()=>{
    if(!current||!checklistTitle.trim())return;
    setChecklistBusy(true);setChecklistError("");
    try{
      const response=await fetch("/api/personal-work-checklist",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({personalWorkId:current.id,title:checklistTitle})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);setChecklistTitle("");
      void reloadItems();
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
      if(response.ok){setChecklist(body.items||[]);void reloadItems()}
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
  // Versiya 2.104: a step keeps up to 10 files — the chosen ones are added, ✕ removes one.
  const attachChecklistFile=async(item:ChecklistLikeItem,files:File[])=>{
    const left=MAX_FILES-rowFiles(item.files,item.attachment_key,item.attachment_name).length;
    if(files.length>left){setChecklistError(`Bir addıma ən çox ${MAX_FILES} fayl əlavə etmək olar — ${Math.max(left,0)} fayl seçilə bilər.`);return}
    setChecklistError("");setChecklistAttachBusy(item.id);
    try{
      const addFiles=await uploadFiles(files);
      const response=await fetch("/api/personal-work-checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,addFiles})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);
    }catch(e){setChecklistError(e instanceof Error?e.message:"Fayl əlavə olunmadı.")}
    finally{setChecklistAttachBusy(null)}
  };
  const detachChecklistFile=async(item:ChecklistLikeItem,file:FileRef)=>{
    if(!window.confirm(`“${file.name}” faylı silinsin?`))return;
    setChecklistError("");
    try{
      const response=await fetch("/api/personal-work-checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,removeFileKey:file.key})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);
    }catch(e){setChecklistError(e instanceof Error?e.message:"Fayl silinmədi.")}
  };
  const reviewDelegated=async(item:ChecklistLikeItem,approve:boolean,score:number,note:string)=>{setChecklistError("");try{await reviewHandedOnTask(item,approve,score,note);await refreshChecklist();return true}catch(e){setChecklistError(e instanceof Error?e.message:"Tapşırıq yenilənmədi.");return false}};
  const refreshChecklist=async()=>{if(!current)return;const response=await fetch(`/api/personal-work-checklist?personalWorkId=${current.id}`);const body=await response.json();if(response.ok)setChecklist(body.items||[])};
  // A step sent to another department becomes an ordinary request in Sorğular; the step keeps its status and answer.
  const requestChecklistItem=async(item:ChecklistLikeItem,input:StepRequestInput)=>{
    setChecklistError("");
    try{
      const files=await uploadFiles(input.files);
      const response=await fetch("/api/personal-work-checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,requestDepartment:input.department,title:input.title,description:input.description,desiredDueAt:input.dueDate,files})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);
      return true;
    }catch(e){setChecklistError(e instanceof Error?e.message:"Sorğu göndərilmədi.");return false}
  };
  // Accepting or returning the answer, and withdrawing a still-new request, go through Sorğular itself.
  const actOnStepRequest=async(item:ChecklistLikeItem,action:"close"|"reopen"|"withdraw",text?:string)=>{
    if(!item.request_id)return false;
    if(action==="withdraw"&&!window.confirm(`${item.request_department} şöbəsinə göndərilmiş sorğunu geri çağırmaq istəyirsiniz?`))return false;
    setChecklistError("");
    try{
      const response=action==="withdraw"?await fetch(`/api/requests?id=${item.request_id}`,{method:"DELETE"}):await fetch("/api/requests",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.request_id,action,text})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      await refreshChecklist();
      return true;
    }catch(e){setChecklistError(e instanceof Error?e.message:"Sorğu yenilənmədi.");return false}
  };
  return <section className="panel pagepanel">
    <div className="pageactions"><div><h2>{team?"Əməkdaşlarımın işləri":"Şəxsi işlərim"}</h2><p>{team?`Tabeliyinizdəki əməkdaşların öz işləri — yalnız baxış və qeyd. ${filtered.length} iş göstərilir`:viewAsEmployeeId?`${employees.find(e=>e.id===viewAsEmployeeId)?.name||"Personal"} adına ${filtered.length} iş göstərilir`:`${filtered.length} iş göstərilir`}</p></div>{!team&&(isAdmin?<small className="adminnote" title="Admin hesabı iş və tapşırıq yaratmır — bunu öz istifadəçi hesabınızdan edin.">Admin hesabı iş əlavə etmir</small>:<Button onClick={()=>{if(!creating&&activeCompanyId)setForm(f=>({...f,companyId:f.companyId||String(activeCompanyId)}));setCreating(v=>!v)}}><Plus/>Yeni iş</Button>)}</div>
    {hasTeam&&<div className="fixedsubtabs"><button className={!team?"on":""} onClick={()=>setTab("mine")}>Mənim işlərim ({items.filter(inScope).length})</button><button className={team&&!onlyLate?"on":""} onClick={()=>{setTab("team");setOnlyLate(false);setCreating(false);void loadTeam()}}>Əməkdaşlarımın işləri ({teamScoped.length})</button>{teamLate>0&&<button className={team&&onlyLate?"on":""} onClick={()=>{setTab("team");setOnlyLate(true);setCreating(false);void loadTeam()}}>Gecikənlər<em className="requestbadge">{teamLate}</em></button>}</div>}
    {!team&&creating&&<div className="inlinetaskrow personalworkrow"><Field label="İşin adı" value={form.title||""} set={v=>setForm({...form,title:v})}/><SelectCompany companies={companies.filter(c=>Boolean(c.active))} value={form.companyId||""} set={v=>setForm({...form,companyId:v})}/><Field label="Açıqlama (istəyə bağlı)" value={form.description||""} set={v=>setForm({...form,description:v})}/><DateTimeField label="Son tarix (istəyə bağlı)" value={form.dueAt||""} set={v=>setForm({...form,dueAt:v})}/><FilePicker label="Əlavə fayllar (istəyə bağlı)" files={newFiles} onChange={setNewFiles}/><div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>setCreating(false)}>Ləğv et</button><Button disabled={busy||!form.title.trim()} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable personalworktable"><ColGroup order={visibleOrder} defaultWidths={defaultWidths} widths={widths} extraKeys={["actions"]}/><thead><tr>{visibleOrder.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}>{excel.header(col)}</SortableTh>})}<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader/></th></tr></thead><tbody>{filtered.map(item=><tr key={item.id}>
      {visibleOrder.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      <td data-label="Əməliyyat"><button type="button" className="openbtn" onClick={()=>openDetail(item)}>Aç</button></td>
    </tr>)}</tbody></table>{!filtered.length&&<Empty text={team?(teamItems.length?"Axtarışa uyğun iş tapılmadı.":"Əməkdaşlarınız hələ öz işini əlavə etməyib."):items.length?"Axtarışa uyğun iş tapılmadı.":"Hələ öz işinizi əlavə etməmisiniz."}/>}</div>}
    <Dialog open={Boolean(current)} onOpenChange={v=>{if(!v){setDetailItem(null);setEditingWork(false)}}}><DialogContent className="businessdialog" resizable>{current&&<FormShell title={current.title} desc={currentOwn?"Öz işim":current.owner_name} formClass="taskdetailform"><div className="taskdetailleft">{editingWork?<div className="taskdetailinfo edititem"><Field label="İşin adı" value={form.title||""} set={v=>setForm({...form,title:v})}/><SelectCompany companies={companies.filter(c=>Boolean(c.active))} value={form.companyId||""} set={v=>setForm({...form,companyId:v})}/><Field label="Açıqlama (istəyə bağlı)" value={form.description||""} set={v=>setForm({...form,description:v})}/><DateTimeField label="Son tarix (istəyə bağlı)" value={form.dueAt||""} set={v=>setForm({...form,dueAt:v})}/>{editKept.length>0&&<div className="field"><span>Əlavə olunan fayllar</span><FileLinks files={editKept} onRemove={f=>setEditKept(list=>list.filter(x=>x.key!==f.key))}/></div>}<FilePicker label="Yeni fayllar (istəyə bağlı)" files={editFiles} onChange={setEditFiles} kept={editKept.length}/>{error&&<div className="errorbox">{error}</div>}<div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={cancelEditWork}>Ləğv et</button><Button disabled={busy||!form.title.trim()} onClick={()=>void saveWorkEdit()}>{busy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div>:<div className="taskdetailinfo"><p><b>Açıqlama</b><span>{current.description||"—"}</span></p><p><b>Firma</b><span>{current.company_name||"—"}</span></p><p><b>Yaranma tarixi</b><span>{formatDate(current.created_at)}</span></p><p><b>Son tarix</b><span>{current.due_at?formatDate(current.due_at):"—"}</span></p>{(()=>{const files=rowFiles(current.files,current.attachment_key,current.attachment_name,current.attachment_size);const completedOwn=currentOwn&&current.status==="Tamamlanıb";return <>{(files.length>0||completedOwn)&&<p><b>Əlavə olunan sənədlər</b><span><FileLinks files={files} empty={<span className="nodocument">Sənəd yoxdur</span>} busy={busy} onRemove={completedOwn?f=>{if(window.confirm(`“${f.name}” faylı silinsin?`))void changeWorkFiles(current,files.filter(x=>x.key!==f.key),[])}:undefined}/></span></p>}{completedOwn&&files.length<MAX_FILES&&<p><b>Fayl əlavə et</b><span className="workfilechange"><label className="workfilepick">{busy?"Yüklənir...":"Fayl seçin"}<input type="file" multiple hidden disabled={busy} onChange={e=>{const chosen=[...(e.target.files||[])];e.target.value="";const left=MAX_FILES-files.length;if(chosen.length>left)window.alert(`Ən çox ${MAX_FILES} fayl olar — ${left} fayl əlavə edilə bilər.`);if(chosen.length)void changeWorkFiles(current,files,chosen.slice(0,left))}}/></label></span></p>}</>})()}</div>}<div className="field"><span>Status</span>{workLate(current)?<><strong className="detailstatus late">Gecikib</strong><LateDays due={current.due_at}/></>:<strong className={`detailstatus ${statusTone(current.status)}`}>{current.status}</strong>}{!editingWork&&currentOwn&&current.status!=="Tamamlanıb"&&<Button disabled={current.status==="İcradadır"&&(checklistLoading||unfinishedSteps>0)} onClick={()=>void advance(current)}>{current.status==="Yeni"?"İcraya al":"Tamamla"}</Button>}{currentOwn&&current.status==="İcradadır"&&!checklistLoading&&unfinishedSteps>0&&<small className="completehint">Tamamlamaq üçün iş axınındakı bütün addımlarda ✓ olmalıdır ({unfinishedSteps} addım qalıb).</small>}</div>{!editingWork&&currentOwn&&current.status!=="Tamamlanıb"&&<button type="button" className="editcompanybtn" onClick={()=>startEditWork(current)}>Redaktə et</button>}{!editingWork&&currentOwn&&current.status==="Yeni"&&<button className="deletetaskbtn detaildelete" onClick={()=>{setDetailItem(null);void remove(current)}}>İşi sil</button>}</div><div className="taskdetailright"><ChecklistSection heading={currentOwn?undefined:"İş axını"} onReview={reviewDelegated} employeeView={currentOwn} checklist={checklist} loading={checklistLoading} title={checklistTitle} setTitle={setChecklistTitle} busy={checklistBusy} error={checklistError} onAdd={()=>void addChecklistItem()} onToggle={item=>void toggleChecklistDone(item)} onRemove={item=>void removeChecklistItem(item)} locked={current.status==="Tamamlanıb"} stepsActionable={current.status==="İcradadır"} canDelegate={currentOwn} delegateEmployees={delegateCandidates} onDelegate={(item,employeeId,comment)=>void delegateChecklistItem(item,employeeId,comment)} onAttach={(item,files)=>void attachChecklistFile(item,files)} onDetach={(item,file)=>void detachChecklistFile(item,file)} attachBusyId={checklistAttachBusy} request={currentOwn?{departments:requestDepartments,workTitle:current.title,workDueAt:current.due_at,hasCompany:Boolean(current.company_id),onSend:requestChecklistItem,onAct:actOnStepRequest}:undefined}/><WorkHistory events={history?.workId===current.id?history.events:null}/>{!currentOwn&&<div className="worknote"><b>Rəhbərin qeydi</b><small>Qeyd işin tarixçəsinə yazılır, əməkdaş onu “Aç” pəncərəsində görür.</small><textarea value={note} maxLength={2000} placeholder="Məsələn: bu işi cümə gününədək bitirin" onChange={e=>setNote(e.target.value)}/>{noteError&&<div className="errorbox">{noteError}</div>}<div className="inlineactions"><Button disabled={noteBusy||!note.trim()} onClick={()=>void addNote()}>{noteBusy?"Yazılır...":"Qeydi yaz"}</Button></div></div>}</div></FormShell>}</DialogContent></Dialog>
  </section>;
}
function TaskGrid({tasks,employeeView,onStatus,onEvaluate,onDelete,dateRequests,onRequestDate,onResolveDateRequest,employees,isAdmin}:{tasks:Task[];employeeView:boolean;onStatus:(t:Task,s:string,extra?:Record<string,unknown>)=>void;onEvaluate:(t:Task)=>void;onDelete:(t:Task)=>void;dateRequests:DateRequest[];onRequestDate:(taskId:number,proposedDueAt:string,reason:string)=>void;onResolveDateRequest:(id:number,approve:boolean,adminNote:string,finalDueAt:string)=>void;employees:Employee[];isAdmin:boolean}){
  const [dateOpen,setDateOpen]=useState(false);
  const [dateForm,setDateForm]=useState({proposedDueAt:"",reason:""});
  const [resolveNote,setResolveNote]=useState("");
  const [resolveDate,setResolveDate]=useState("");
  const [detailTask,setDetailTask]=useState<Task|null>(null);
  const [submitFiles,setSubmitFiles]=useState<File[]>([]);
  const [submitNote,setSubmitNote]=useState("");
  const [submitBusy,setSubmitBusy]=useState(false);
  const [submitError,setSubmitError]=useState("");
  const [checklist,setChecklist]=useState<ChecklistItem[]>([]);
  const [delegateCandidates,setDelegateCandidates]=useState<DelegateCandidate[]>([]);
  const [checklistLoading,setChecklistLoading]=useState(false);
  const [checklistTitle,setChecklistTitle]=useState("");
  const [checklistBusy,setChecklistBusy]=useState(false);
  const [checklistError,setChecklistError]=useState("");
  const [checklistAttachBusy,setChecklistAttachBusy]=useState<number|null>(null);
  const hasPendingRequest=(t:Task)=>dateRequests.some(r=>r.task_id===t.id&&r.status==="Gözləyir");
  const rowStatusLabel=(t:Task)=>hasPendingRequest(t)?"Dəyişiklik tələb olunur":displayStatus(t);
  const rowStatusClass=(t:Task)=>hasPendingRequest(t)?"changerequested":statusClass(t);
  const openDetail=(t:Task)=>{setSubmitFiles([]);setSubmitError("");setDateOpen(false);setDateForm({proposedDueAt:"",reason:""});setResolveNote("");setResolveDate("");setDetailTask(t)};
  const taskColumns:Array<{key:string;label:string;width:number;search:(t:Task)=>string;sort?:(t:Task)=>string|number|null;render:(t:Task)=>React.ReactNode}>=[
    {key:"status",label:"Status",width:120,search:t=>rowStatusLabel(t),render:t=><><button className={`tablestatus statusopen ${rowStatusClass(t)}`} onClick={()=>openDetail(t)}>{rowStatusLabel(t)}</button>{statusClass(t)==="late"&&<LateDays due={t.due_at}/>}</>},
    {key:"company",label:"Firma",width:140,search:t=>t.company_name||"",render:t=><b>{t.company_name||"—"}</b>},
    {key:"type",label:"Tapşırığın tipi",width:150,search:t=>t.request_id?"Sorğu əsasında":"Rəhbər tərəfindən",render:t=>t.request_id?<><span className="tasktype request">Sorğu əsasında</span><small className="requestsub">№{t.request_id}{t.request_from?` • ${t.request_from}`:""}</small></>:<span className="tasktype">Rəhbər tərəfindən</span>},
    {key:"employee",label:"Personal",width:150,search:t=>t.employee_name,render:t=><>{t.employee_name}</>},
    {key:"assignedBy",label:"Tapşırığı verən",width:170,search:t=>t.assigned_by||"",render:t=><>{t.assigned_by||"—"}</>},
    {key:"position",label:"Vəzifəsi",width:140,search:t=>t.employee_position,render:t=><>{t.employee_position}</>},
    {key:"title",label:"Tapşırıq",width:170,search:t=>t.title,render:t=><button className="taskdetailbtn" onClick={()=>openDetail(t)}>{t.title}</button>},
    {key:"description",label:"Tapşırığın açıqlaması",width:220,search:t=>t.description||"",render:t=><>{t.description||"—"}</>},
    {key:"document",label:"Əlavə olunan sənəd",width:150,search:t=>rowFiles(t.files,t.attachment_key,t.attachment_name).map(f=>f.name).join(", ")||"Sənəd yoxdur",render:t=><FileLinks files={rowFiles(t.files,t.attachment_key,t.attachment_name,t.attachment_size)} empty={<span className="nodocument">Sənəd yoxdur</span>}/>},
    {key:"created",label:"Yaranma tarixi",width:140,search:t=>formatDate(t.created_at),sort:t=>new Date(t.created_at).getTime(),render:t=><time>{formatDate(t.created_at)}</time>},
    {key:"due",label:"Tapşırığın son tarixi",width:150,search:t=>formatDate(t.due_at),sort:t=>new Date(t.due_at).getTime(),render:t=><time>{formatDate(t.due_at)}</time>},
    {key:"evaluation",label:"Qiymətləndirmə",width:160,search:t=>t.evaluation?`${t.evaluation} bal`:displayStatus(t),sort:t=>t.evaluation??null,render:t=><div className="tableactions"><RatingCell evaluation={t.evaluation} note={t.evaluation_note} compact twoRows/>{!employeeView&&t.status==="Təqdim edilib"?<button className="evaluatebtn" onClick={()=>onEvaluate(t)}>Qiymətləndir</button>:!t.evaluation&&!t.evaluation_note&&<span>—</span>}{!employeeView&&t.status==="Yeni"&&<button className="deletetaskbtn" onClick={()=>onDelete(t)}>Sil</button>}</div>},
  ];
  const {order,widths,setWidth,moveColumn}=useTableColumns("tasks2",taskColumns.map(c=>c.key));
  const resize=useEdgeResize(setWidth,60);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(taskColumns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(taskColumns.map(c=>[c.key,c.width]));
  const excel=useExcelFilters("tasks",taskColumns,tasks);
  const filtered=excel.rows;
  // An employee sees only their own tasks inside one chosen firma, so firma, name and position add nothing there.
  const severalFirms=new Set(tasks.map(t=>t.company_id)).size>1;
  const shownOrder=order.filter(k=>columnsByKey[k]&&!(employeeView&&(k==="company"?!severalFirms:["employee","position"].includes(k))));
  const current=detailTask&&tasks.find(t=>t.id===detailTask.id)||detailTask;
  useEffect(()=>{if(!current){setChecklist([]);setChecklistError("");return}let cancelled=false;setChecklistLoading(true);void fetch(`/api/checklist?taskId=${current.id}`).then(r=>r.ok?r.json():{items:[]}).then(body=>{if(!cancelled){setChecklist(body.items||[]);setDelegateCandidates(body.candidates||[])}}).finally(()=>{if(!cancelled)setChecklistLoading(false)});return()=>{cancelled=true}},[current?.id]);
  const reviewDelegated=async(item:ChecklistLikeItem,approve:boolean,score:number,note:string)=>{if(!current)return false;setChecklistError("");try{await reviewHandedOnTask(item,approve,score,note);const response=await fetch(`/api/checklist?taskId=${current.id}`);const body=await response.json();if(response.ok)setChecklist(body.items||[]);return true}catch(e){setChecklistError(e instanceof Error?e.message:"Tapşırıq yenilənmədi.");return false}};
  const nextStatus=current?.status==="Yeni"?"İcradadır":(current?.status==="İcradadır"||current?.status==="Geri qaytarılıb")?"Təqdim edilib":null;
  const needsSubmissionFile=Boolean(current&&current.attachment_key&&!current.submission_attachment_key&&!current.request_id);
  const pendingRequest=current?dateRequests.find(r=>r.task_id===current.id&&r.status==="Gözləyir"):undefined;
  const taskRequest=current?dateRequests.find(r=>r.task_id===current.id):undefined;
  const submitDateRequest=()=>{if(!current||!dateForm.proposedDueAt)return;onRequestDate(current.id,new Date(dateForm.proposedDueAt).toISOString(),dateForm.reason);setDateOpen(false);setDateForm({proposedDueAt:"",reason:""})};
  const resolveDateRequest=(approve:boolean)=>{if(!pendingRequest)return;const finalDueAt=approve?new Date(resolveDate||toDateTimeLocal(pendingRequest.proposed_due_at)).toISOString():pendingRequest.proposed_due_at;onResolveDateRequest(pendingRequest.id,approve,resolveNote,finalDueAt);setResolveNote("");setResolveDate("")};
  const submitTask=async()=>{
    if(!current)return;
    setSubmitError("");
    if(needsSubmissionFile&&!submitFiles.length){setSubmitError("Doldurulmuş faylı yükləyin.");return}
    setSubmitBusy(true);
    try{
      let extra:Record<string,unknown>={};
      // Versiya 2.104: the work is submitted with up to 10 files.
      const uploaded=await uploadFiles(submitFiles);
      if(uploaded.length)extra={submissionFiles:uploaded};
      // A request-linked task's answer text goes back to whoever sent the request (Sorğular and their İşlərim step).
      if(current.request_id&&submitNote.trim())extra={...extra,submissionNote:submitNote.trim()};
      onStatus(current,"Təqdim edilib",extra);
      setDetailTask({...current,status:"Təqdim edilib",employee_status_changed:Number(current.employee_status_changed)+1,...(uploaded.length?{submission_files:uploaded,submission_attachment_key:uploaded[0].key,submission_attachment_name:uploaded[0].name,submission_attachment_size:uploaded[0].size,submission_attachment_type:uploaded[0].type}:{})});
      setSubmitFiles([]);setSubmitNote("");
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
  // Versiya 2.104: a step keeps up to 10 files — the chosen ones are added, ✕ removes one.
  const attachChecklistFile=async(item:ChecklistLikeItem,files:File[])=>{
    const left=MAX_FILES-rowFiles(item.files,item.attachment_key,item.attachment_name).length;
    if(files.length>left){setChecklistError(`Bir addıma ən çox ${MAX_FILES} fayl əlavə etmək olar — ${Math.max(left,0)} fayl seçilə bilər.`);return}
    setChecklistError("");setChecklistAttachBusy(item.id);
    try{
      const addFiles=await uploadFiles(files);
      const response=await fetch("/api/checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,addFiles})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setChecklist(body.items||[]);
    }catch(e){setChecklistError(e instanceof Error?e.message:"Fayl əlavə olunmadı.")}
    finally{setChecklistAttachBusy(null)}
  };
  const detachChecklistFile=async(item:ChecklistLikeItem,file:FileRef)=>{
    if(!window.confirm(`“${file.name}” faylı silinsin?`))return;
    setChecklistError("");
    try{
      const response=await fetch("/api/checklist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,removeFileKey:file.key})});
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
    return <><div className="tasktablewrap"><table className="tasktable"><ColGroup order={shownOrder} defaultWidths={defaultWidths} widths={widths} extraKeys={["actions"]}/><thead><tr>{shownOrder.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}>{excel.header(col)}</SortableTh>})}<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader/></th></tr></thead><tbody>{filtered.map(t=><tr key={t.id}>
      {shownOrder.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(t)}</td>})}
      <td data-label="Əməliyyat"><button type="button" className="openbtn" onClick={()=>openDetail(t)}>Aç</button></td>
    </tr>)}</tbody></table>{!filtered.length&&<Empty text={tasks.length?"Axtarışa uyğun tapşırıq tapılmadı.":"Hələ tapşırıq yaradılmayıb."}/>}</div>
    <Dialog open={Boolean(current)} onOpenChange={v=>!v&&setDetailTask(null)}><DialogContent className="businessdialog" resizable>{current&&<FormShell title={current.title} desc={`${current.employee_name} • ${current.company_name||"Firma qeyd edilməyib"}`} formClass="taskdetailform"><div className="taskdetailleft"><div className="taskdetailinfo"><p><b>Tapşırıq</b><span>{current.description||"—"}</span></p><p><b>Yaranma tarixi</b><span>{formatDate(current.created_at)}</span></p><p><b>Son icra tarixi</b><span>{formatDate(current.due_at)}{current.original_due_at&&current.original_due_at!==current.due_at&&<small className="daterequestnote"> (ilkin tarix: {formatDate(current.original_due_at)})</small>}</span></p>{current.attachment_key&&<p><b>Tapşırıqla göndərilən fayllar</b><span><FileLinks files={rowFiles(current.files,current.attachment_key,current.attachment_name,current.attachment_size)}/></span></p>}{current.submission_attachment_key&&<p><b>İşlənib təqdim olunan fayllar</b><span><FileLinks files={rowFiles(current.submission_files,current.submission_attachment_key,current.submission_attachment_name,current.submission_attachment_size)}/></span></p>}</div>{employeeView?<div className="field"><span>Status</span><strong className={`detailstatus ${pendingRequest?"changerequested":statusClass(current)}`}>{pendingRequest?"Dəyişiklik tələb olunur":displayStatus(current)}</strong><RatingCell evaluation={current.evaluation} note={current.evaluation_note} twoRows/>{nextStatus&&Number(current.employee_status_changed)<2&&<>{nextStatus==="Təqdim edilib"&&current.request_id&&<label className="field">Cavab mətni (sorğunu göndərənə göstəriləcək, istəyə bağlı)<Textarea placeholder="Nə edildiyini, nəticəni və ya əlavə izahı yazın" value={submitNote} onChange={e=>setSubmitNote(e.target.value)}/></label>}{nextStatus==="Təqdim edilib"&&<FilePicker label={`İşlənmiş fayllar${needsSubmissionFile?" (ən azı bir fayl mütləqdir)":" (istəyə bağlı)"}`} files={submitFiles} onChange={setSubmitFiles}/>}{submitError&&<div className="errorbox">{submitError}</div>}<Button disabled={submitBusy} onClick={()=>nextStatus==="İcradadır"?(onStatus(current,nextStatus),setDetailTask({...current,status:nextStatus,employee_status_changed:Number(current.employee_status_changed)+1})):void submitTask()}>{submitBusy?"Göndərilir...":nextStatus==="İcradadır"?"İcraya al":"Təqdim et"}</Button></>}</div>:<div className="field"><span>Status</span><strong className={`detailstatus ${pendingRequest?"changerequested":statusClass(current)}`}>{pendingRequest?"Dəyişiklik tələb olunur":displayStatus(current)}</strong><RatingCell evaluation={current.evaluation} note={current.evaluation_note} twoRows/></div>}<DateRequestSection employeeView={employeeView} current={current} pendingRequest={pendingRequest} taskRequest={taskRequest} dateOpen={dateOpen} setDateOpen={setDateOpen} dateForm={dateForm} setDateForm={setDateForm} onSubmit={submitDateRequest} resolveNote={resolveNote} setResolveNote={setResolveNote} resolveDate={resolveDate} setResolveDate={setResolveDate} onResolve={resolveDateRequest}/>{!employeeView&&current.status==="Təqdim edilib"&&<Button onClick={()=>onEvaluate(current)}>Qiymətləndir</Button>}{!employeeView&&current.status==="Yeni"&&<button className="deletetaskbtn detaildelete" onClick={()=>{setDetailTask(null);onDelete(current)}}>Tapşırığı sil</button>}</div><div className="taskdetailright"><ChecklistSection onReview={reviewDelegated} employeeView={employeeView} checklist={checklist} loading={checklistLoading} title={checklistTitle} setTitle={setChecklistTitle} busy={checklistBusy} error={checklistError} onAdd={()=>void addChecklistItem()} onToggle={item=>void toggleChecklistDone(item)} onRemove={item=>void removeChecklistItem(item)} locked={current.status==="Təqdim edilib"||current.status==="Təsdiqlənib"} canDelegate={canDelegateTask} delegateEmployees={delegateCandidates} onDelegate={(item,employeeId,comment)=>void delegateChecklistItem(item,employeeId,comment)} onAttach={(item,files)=>void attachChecklistFile(item,files)} onDetach={(item,file)=>void detachChecklistFile(item,file)} attachBusyId={checklistAttachBusy}/></div></FormShell>}</DialogContent></Dialog>
  </>
}
function EmployeesPage({employees,companies,tasks,onNew,onEdit,onView,onDelete}:{employees:Employee[];companies:Company[];tasks:Task[];onNew:()=>void;onEdit:(e:Employee)=>void;onView:(e:Employee)=>void;onToggle:(e:Employee)=>void;onDelete:(e:Employee)=>void}){
  const [accounts,setAccounts]=useState<ManagedUser[]>([]);const [reset,setReset]=useState<ManagedUser|null>(null);const [password,setPassword]=useState("");const [error,setError]=useState("");
  const loadAccounts=async()=>{const response=await fetch("/api/users");const body=await response.json();if(response.ok)setAccounts(body.users||[])};
  useEffect(()=>{void loadAccounts()},[]);
  const toggle=async(account:ManagedUser)=>{const response=await fetch("/api/users",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:account.id,active:!Boolean(account.active)})});const body=await response.json();if(response.ok){setAccounts(body.users);location.reload()}else setError(body.error)};
  const savePassword=async()=>{if(!reset)return;const response=await fetch("/api/users",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:reset.id,password})});const body=await response.json();if(!response.ok){setError(body.error);return}setAccounts(body.users);setReset(null);setPassword("")};
  return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><span className="sectioneyebrow">İSTİFADƏÇİLƏR VƏ GİRİŞ HESABLARI</span><h2>İstifadəçilər</h2><p>İstifadəçilərin məlumatları və proqrama giriş icazələri vahid bölmədə idarə olunur</p></div><Button onClick={onNew}><Plus/>Yeni personal</Button></div>{error&&<div className="errorbox">{error}</div>}<div className="employeecards officialcards">{employees.length?employees.map(e=>{const own=tasks.filter(t=>t.employee_id===e.id);const done=own.filter(t=>t.status==="Təsdiqlənib");const activeCount=own.filter(t=>t.status!=="Təsdiqlənib").length;const rated=done.filter(t=>t.evaluation);const avg=rated.length?(rated.reduce((s,t)=>s+(t.evaluation||0),0)/rated.length).toFixed(1):"—";const account=accounts.find(a=>a.employee_id===e.id);const active=account?Boolean(account.active):Boolean(e.active);return <article key={e.id} className={!active?"inactivecard":""}><div className="identityblock"><i className={e.avatar_key?"hasphoto":""}>{e.avatar_key?<img src={`/api/file?key=${encodeURIComponent(e.avatar_key)}`} alt={e.name}/>:initials(e.name)}</i><div><div className="identitytitle"><h3>{e.name}</h3><span className={active?"recordstatus active":"recordstatus inactive"}>{active?"Aktiv":"Deaktiv"}</span></div>{(()=>{const main=e.main_company_id?companies.find(c=>c.id===e.main_company_id):null;const title=e.main_company_id?parseCompanyPositions(e.company_positions).find(p=>p.company_id===e.main_company_id)?.position_title:null;return <><p><b>Əsas iş yeri:</b> {main?.name||"Seçilməyib"}</p><p><b>Vəzifə:</b> {title||"Seçilməyib"}</p></>})()}<p><b>E-poçt və giriş adı:</b> {e.email||"Qeyd edilməyib"}</p><p><b>Giriş hesabı:</b> {account?"Yaradılıb":"Yaradılmayıb"}</p></div></div><div className="recordmetrics"><span><small>Ümumi tapşırıq</small><b>{own.length}</b></span><span><small>İcrada</small><b>{activeCount}</b></span><span><small>Tamamlanıb</small><b>{done.length}</b></span><span><small>Orta qiymət</small><b>{avg}</b></span></div><div className="employeeactions recordactions"><button className="editcompanybtn" onClick={()=>onEdit(e)}>Redaktə et</button>{active&&<button className="viewasbtn" onClick={()=>onView(e)}>İstifadəçi görünüşü</button>}{account&&<button className="editcompanybtn" onClick={()=>{setReset(account);setPassword("")}}>Şifrəni yenilə</button>}{account&&<button className={active?"deactivatebtn":"activatebtn"} onClick={()=>{if(!active||window.confirm(`${e.name} adlı personalı deaktiv etmək istəyirsiniz?`))void toggle(account)}}>{active?"Deaktiv et":"Aktiv et"}</button>}{!active&&own.length===0&&<button className="deleteworkerbtn" onClick={()=>onDelete(e)}>Sil</button>}</div></article>}):<Empty text="İlk personalı əlavə edin."/>}</div><Dialog open={Boolean(reset)} onOpenChange={v=>!v&&setReset(null)}><DialogContent className="businessdialog" resizable>{reset&&<FormShell title="İstifadəçinin şifrəsini yenilə" desc={`${reset.name} üçün yeni müvəqqəti şifrə təyin edin.`}><Field label="Yeni şifrə (ən az 8 simvol)" type="password" value={password} set={setPassword}/><Button disabled={password.length<8} onClick={()=>void savePassword()}>Şifrəni yenilə</Button></FormShell>}</DialogContent></Dialog></section>
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
  const structureColumns:ExcelColumn<StructurePosition>[]=[{key:"department",label:"Şöbə",search:i=>i.department},{key:"title",label:"Vəzifə",search:i=>i.title},{key:"reportsTo",label:"Tabe olduğu",search:i=>i.reports_to||"Ən yuxarı vəzifə"}];
  const excel=useExcelFilters("structure",structureColumns,items,{sortable:false});
  const filtered=excel.rows;
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
      {structureColumns.map(col=><th key={col.key}>{excel.header(col)}</th>)}
      <th className="opencolumn"><ActionsHeader/></th>
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
const FOREIGN_SUPPLIER="Xarici təchizatçı";
// Every country except Azərbaycan (local customers are Hüquqi şəxs / Fərdi sahibkar / Fiziki şəxs), sorted the Azerbaijani way.
const COUNTRIES:string[]=["Əfqanıstan","Albaniya","Əlcəzair","Andorra","Anqola","Antiqua və Barbuda","Argentina","Ermənistan","Avstraliya","Avstriya","Baham adaları","Bəhreyn","Banqladeş","Barbados","Belarus","Belçika","Beliz","Benin","Butan","Boliviya","Bosniya və Herseqovina","Botsvana","Braziliya","Bruney","Bolqarıstan","Burkina-Faso","Burundi","Kabo-Verde","Kamboca","Kamerun","Kanada","Mərkəzi Afrika Respublikası","Çad","Çili","Çin","Kolumbiya","Komor adaları","Konqo Respublikası","Konqo Demokratik Respublikası","Kosta-Rika","Kot-d'İvuar","Xorvatiya","Kuba","Kipr","Çexiya","Danimarka","Cibuti","Dominika","Dominikan Respublikası","Ekvador","Misir","Salvador","Ekvatorial Qvineya","Eritreya","Estoniya","Esvatini","Efiopiya","Fici","Finlandiya","Fransa","Qabon","Qambiya","Gürcüstan","Almaniya","Qana","Yunanıstan","Qrenada","Qvatemala","Qvineya","Qvineya-Bisau","Qayana","Haiti","Honduras","Honq Konq","Macarıstan","İslandiya","Hindistan","İndoneziya","İran","İraq","İrlandiya","İsrail","İtaliya","Yamayka","Yaponiya","İordaniya","Qazaxıstan","Keniya","Kiribati","Kosovo","Küveyt","Qırğızıstan","Laos","Latviya","Livan","Lesoto","Liberiya","Liviya","Lixtenşteyn","Litva","Lüksemburq","Madaqaskar","Malavi","Malayziya","Maldiv adaları","Mali","Malta","Marşall adaları","Mavritaniya","Mavriki","Meksika","Mikroneziya","Moldova","Monako","Monqolustan","Monteneqro","Mərakeş","Mozambik","Myanma","Namibiya","Nauru","Nepal","Niderland","Yeni Zelandiya","Nikaraqua","Niger","Nigeriya","Şimali Koreya","Şimali Makedoniya","Norveç","Oman","Pakistan","Palau","Fələstin","Panama","Papua-Yeni Qvineya","Paraqvay","Peru","Filippin","Polşa","Portuqaliya","Qətər","Rumıniya","Rusiya","Ruanda","Sent-Kits və Nevis","Sent-Lusiya","Sent-Vinsent və Qrenadinlər","Samoa","San-Marino","San-Tome və Prinsipi","Səudiyyə Ərəbistanı","Seneqal","Serbiya","Seyşel adaları","Syerra-Leone","Sinqapur","Slovakiya","Sloveniya","Solomon adaları","Somali","Cənubi Afrika Respublikası","Cənubi Koreya","Cənubi Sudan","İspaniya","Şri-Lanka","Sudan","Surinam","İsveç","İsveçrə","Suriya","Tayvan","Tacikistan","Tanzaniya","Tailand","Şərqi Timor","Toqo","Tonqa","Trinidad və Tobaqo","Tunis","Türkiyə","Türkmənistan","Tuvalu","Uqanda","Ukrayna","Birləşmiş Ərəb Əmirlikləri","Böyük Britaniya","Amerika Birləşmiş Ştatları","Uruqvay","Özbəkistan","Vanuatu","Vatikan","Venesuela","Vyetnam","Yəmən","Zambiya","Zimbabve"].sort((a,b)=>a.localeCompare(b,"az"));
// Company tax-number formats checked exactly; every other country accepts 5–20 letters, digits or dashes.
type TaxRule={chars:RegExp;lengths:number[];hint:string;prefix?:string};
const digits=(lengths:number[],hint:string):TaxRule=>({chars:/[0-9]/,lengths,hint});
const COUNTRY_TAX_RULES:Record<string,TaxRule>={
  "Türkiyə":digits([10],"VKN — 10 rəqəm"),
  "Rusiya":digits([10,12],"ИНН — 10 rəqəm (fərdi sahibkar 12)"),
  "Gürcüstan":digits([9,11],"9 rəqəm (fiziki şəxs 11)"),
  "Qazaxıstan":digits([12],"BİN — 12 rəqəm"),
  "Özbəkistan":digits([9],"STIR — 9 rəqəm"),
  "Ukrayna":digits([8,10],"ЄДРПОУ — 8 rəqəm (fiziki şəxs 10)"),
  "Belarus":digits([9],"УНП — 9 rəqəm"),
  "Qırğızıstan":digits([14],"İNN — 14 rəqəm"),
  "Tacikistan":digits([9],"İNN — 9 rəqəm"),
  "Moldova":digits([13],"IDNO — 13 rəqəm"),
  "İran":digits([11],"Şenase-ye melli — 11 rəqəm"),
  "Birləşmiş Ərəb Əmirlikləri":digits([15],"TRN — 15 rəqəm"),
  "Səudiyyə Ərəbistanı":digits([15],"ƏDV nömrəsi — 15 rəqəm"),
  "İtaliya":digits([11],"Partita IVA — 11 rəqəm"),
  "Polşa":digits([10],"NIP — 10 rəqəm"),
  "Fransa":digits([9],"SIREN — 9 rəqəm"),
  "Amerika Birləşmiş Ştatları":digits([9],"EIN — 9 rəqəm"),
  "Kanada":digits([9],"BN — 9 rəqəm"),
  "Avstraliya":digits([11],"ABN — 11 rəqəm"),
  "Braziliya":digits([14],"CNPJ — 14 rəqəm"),
  "Yaponiya":digits([13],"Korporativ nömrə — 13 rəqəm"),
  "Cənubi Koreya":digits([10],"10 rəqəm"),
  "İsrail":digits([9],"9 rəqəm"),
  "Misir":digits([9],"9 rəqəm"),
  "Çin":{chars:/[0-9A-Z]/,lengths:[18],hint:"USCC — 18 simvol (hərf və rəqəm)"},
  "Hindistan":{chars:/[0-9A-Z]/,lengths:[15],hint:"GSTIN — 15 simvol (hərf və rəqəm)"},
  "İspaniya":{chars:/[0-9A-Z]/,lengths:[9],hint:"NIF — 9 simvol"},
  "Almaniya":{chars:/[0-9A-Z]/,lengths:[11],hint:"DE + 9 rəqəm",prefix:"DE"},
  "Böyük Britaniya":{chars:/[0-9A-Z]/,lengths:[11,14],hint:"GB + 9 rəqəm",prefix:"GB"},
  "Avstriya":{chars:/[0-9A-Z]/,lengths:[11],hint:"ATU + 8 rəqəm",prefix:"ATU"},
  "İsveçrə":{chars:/[0-9A-Z]/,lengths:[12],hint:"CHE + 9 rəqəm",prefix:"CHE"},
};
const GENERIC_TAX_RULE:TaxRule={chars:/[0-9A-Z-]/,lengths:[5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],hint:"5–20 simvol (hərf, rəqəm, tire)"};
const customerColumns:Array<{key:string;label:string;width:number;search:(item:Customer)=>string;render:(item:Customer)=>React.ReactNode}>=[
  {key:"status",label:"Statusu",width:130,search:i=>i.entity_type||"",render:i=><>{i.entity_type||"—"}</>},
  {key:"country",label:"Ölkə",width:130,search:i=>i.country||(i.entity_type?"Azərbaycan":""),render:i=><>{i.country||(i.entity_type?"Azərbaycan":"—")}</>},
  {key:"voen",label:"VÖEN/FİN / Vergi nömrəsi",width:130,search:i=>i.voen||"",render:i=><>{i.voen||"—"}</>},
  {key:"name",label:"Müştərinin adı",width:200,search:i=>i.name||"",render:i=><b>{i.name}</b>},
  {key:"address",label:"Hüquqi ünvan",width:340,search:i=>i.legal_address||"",render:i=><>{i.legal_address||"—"}</>},
  {key:"manager",label:"Rəhbər",width:160,search:i=>i.manager||"",render:i=><>{i.manager||"—"}</>},
  {key:"phone",label:"Telefon",width:140,search:i=>formatPhone(i.phone),render:i=><>{formatPhone(i.phone)||"—"}</>},
];
// Open to every user (the companies are all in one group): everyone can view and add customers; editing and deleting stay admin-only.
function CustomersPage({canSeePersonnel=false,rights}:{isAdmin:boolean;canSeePersonnel?:boolean;rights:{add:boolean;edit:boolean;remove:boolean}}){
  // Which of our people worked at each customer (HR prior jobs) — only for users who may see personnel data.
  const [formerStaff,setFormerStaff]=useState<Map<number,FormerStaff[]>|null>(null);
  const [formerOpen,setFormerOpen]=useState<number|null>(null);
  useEffect(()=>{
    if(!canSeePersonnel)return;
    let cancelled=false;
    fetch("/api/hr?report=customers").then(r=>r.ok?r.json():{rows:[]}).then((body:{rows?:FormerStaff[]})=>{
      if(cancelled)return;
      const map=new Map<number,FormerStaff[]>();
      (body.rows||[]).forEach(row=>map.set(row.customer_id,[...(map.get(row.customer_id)||[]),row]));
      setFormerStaff(map);
    }).catch(()=>{});
    return()=>{cancelled=true};
  },[canSeePersonnel]);
  // Versiya 2.86: each customer's outgoing and incoming documents (by VÖEN) — only those this user may see in the document sections.
  const [customerDocs,setCustomerDocs]=useState<Map<string,CustomerDocument[]>>(new Map());
  const [docsOpen,setDocsOpen]=useState<number|null>(null);
  useEffect(()=>{
    let cancelled=false;
    fetch("/api/customers?documents=1").then(r=>r.ok?r.json():{documents:[]}).then((body:{documents?:CustomerDocument[]})=>{
      if(cancelled)return;
      const map=new Map<string,CustomerDocument[]>();
      (body.documents||[]).forEach(d=>map.set(d.voen,[...(map.get(d.voen)||[]),d]));
      setCustomerDocs(map);
    }).catch(()=>{});
    return()=>{cancelled=true};
  },[]);
  const docsOf=(item:Customer)=>item.voen?.trim()?customerDocs.get(item.voen.trim())||[]:[];
  const unreturnedOf=(item:Customer)=>docsOf(item).filter(d=>{const r=customerDocReturn(d);return Boolean(r&&r.kind!=="done")}).length;
  // "Sənəd dövriyyəsi" (Versiya 2.87): its own column instead of a button among the actions; a click opens the history below the row.
  const columns=[...customerColumns,{key:"docs",label:"Sənəd dövriyyəsi",width:170,
    search:(i:Customer)=>{const d=docsOf(i);if(!d.length)return "";const n=unreturnedOf(i);return `Çıxan ${d.filter(x=>x.kind==="outgoing").length} · Daxil olan ${d.filter(x=>x.kind==="incoming").length}${n?` · ${n} qayıtmayıb`:""}`},
    values:(i:Customer)=>!docsOf(i).length?[]:unreturnedOf(i)?["Sənəd var","Qayıtmayan var"]:["Sənəd var"],
    sort:(i:Customer)=>docsOf(i).length||null,
    render:(i:Customer)=>{const d=docsOf(i);if(!d.length)return <span className="nodocument">—</span>;const n=unreturnedOf(i);
      return <button className={`docsflowbtn${docsOpen===i.id?" on":""}`} title="Sənədlərin tarixçəsini aç" onClick={()=>setDocsOpen(v=>v===i.id?null:i.id)}><span>➡ {d.filter(x=>x.kind==="outgoing").length}</span><span>⬅ {d.filter(x=>x.kind==="incoming").length}</span>{n>0&&<em className="docsunreturned">{n} qayıtmayıb</em>}</button>}}];
  const {order,widths,setWidth,moveColumn}=useTableColumns("customers2",columns.map(c=>c.key));
  const resize=useEdgeResize(setWidth,60);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(columns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(columns.map(c=>[c.key,c.width]));
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
  // A foreign supplier needs its country; its tax number is optional, but when given it must fit that country's format.
  const requiredFilled=(values:Record<string,string>)=>{
    const foreign=values.entityType===FOREIGN_SUPPLIER;
    const common=Boolean((values.entityType||"").trim()&&(values.name||"").trim()&&(values.legalAddress||"").trim()&&(values.manager||"").trim()&&(values.phone||"").trim());
    if(!foreign)return common&&Boolean((values.voen||"").trim());
    return common&&Boolean(values.country)&&taxNumberError(values)===null;
  };
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
  const startEdit=(item:Customer)=>{setEditingId(item.id);setEditForm({entityType:item.entity_type||"",country:item.country||"",voen:item.voen||"",name:item.name||"",legalAddress:item.legal_address||"",manager:item.manager||"",phone:item.phone||""})};
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
  const entityTypeOptions=["Hüquqi şəxs","Fərdi sahibkar","Fiziki şəxs",FOREIGN_SUPPLIER];
  const taxRule=(country:string)=>COUNTRY_TAX_RULES[country]||GENERIC_TAX_RULE;
  const sanitizeTaxNumber=(value:string,country:string)=>{const rule=taxRule(country);return value.toUpperCase().split("").filter(ch=>rule.chars.test(ch)).join("").slice(0,Math.max(...rule.lengths))};
  const taxNumberError=(values:Record<string,string>)=>{
    const value=(values.voen||"").trim();
    if(!value)return null;
    const rule=taxRule(values.country||"");
    if(rule.prefix&&!value.startsWith(rule.prefix))return `${rule.prefix} ilə başlamalıdır`;
    return rule.lengths.includes(value.length)?null:rule.hint;
  };
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
    status:(values,set)=><label className="field statusfield" key="status">Statusu<select value={values.entityType||""} onChange={e=>{const entityType=e.target.value;const wasForeign=values.entityType===FOREIGN_SUPPLIER,isForeign=entityType===FOREIGN_SUPPLIER;set({...values,entityType,country:isForeign?values.country||"":"",voen:wasForeign!==isForeign?"":isForeign?values.voen||"":sanitizeVoen(values.voen||"",entityType)})}}><option value="">Seçin</option>{entityTypeOptions.map(o=><option key={o} value={o}>{o}</option>)}</select></label>,
    country:(values,set)=>values.entityType===FOREIGN_SUPPLIER?<label className="field countryfield" key="country">Ölkə<select value={values.country||""} onChange={e=>set({...values,country:e.target.value,voen:sanitizeTaxNumber(values.voen||"",e.target.value)})}><option value="">Ölkəni seçin</option>{COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>:<label className="field countryfield" key="country">Ölkə<Input value={values.entityType?"Azərbaycan":""} disabled/></label>,
    voen:(values,set)=>{if(values.entityType===FOREIGN_SUPPLIER){const rule=taxRule(values.country||"");const problem=taxNumberError(values);return <label className="field voenfield wide" key="voen">Vergi nömrəsi<small className={problem?"voenhint bad":"voenhint"}>{rule.hint} • istəyə bağlı</small><Input value={values.voen||""} disabled={!values.country} placeholder={values.country?rule.prefix||"":"Əvvəlcə ölkəni seçin"} onChange={e=>set({...values,voen:sanitizeTaxNumber(e.target.value,values.country||"")})}/></label>}const rule=voenRule(values.entityType||"");return <label className="field voenfield" key="voen">VÖEN/FİN{rule&&<small className="voenhint">{rule.hint}</small>}<Input value={values.voen||""} maxLength={rule?.length} onChange={e=>set({...values,voen:sanitizeVoen(e.target.value,values.entityType||"")})}/></label>},
    name:(values,set)=><label className="field" key="name">Müştərinin adı<Input value={values.name||""} onChange={e=>set({...values,name:e.target.value})}/></label>,
    address:(values,set)=><label className="field addressfield" key="address">Hüquqi ünvan<Input value={values.legalAddress||""} onChange={e=>set({...values,legalAddress:e.target.value})} onBlur={e=>set({...values,legalAddress:properCase(e.target.value)})}/></label>,
    manager:(values,set)=><label className="field" key="manager">Rəhbər<Input value={values.manager||""} onChange={e=>set({...values,manager:e.target.value})} onBlur={e=>set({...values,manager:properCase(e.target.value)})}/></label>,
    phone:(values,set)=><label className="field" key="phone">Telefon<Input inputMode="tel" placeholder="+99412 345 67 89" value={values.phone||""} onChange={e=>set({...values,phone:e.target.value})} onBlur={()=>set({...values,phone:formatPhone(values.phone)})}/></label>,
  };
  const fields=(values:Record<string,string>,set:(next:Record<string,string>)=>void)=><>{order.map(key=>fieldRenderers[key]?.(values,set))}</>;
  const excel=useExcelFilters("customers",columns,items);
  const filtered=excel.rows;
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>Müştərilər</h2><p>{filtered.length} müştəri göstərilir</p></div>{rights.add&&<Button onClick={()=>setCreating(v=>!v)}><Plus/>Yeni müştəri</Button>}</div>
    {creating&&<div className="inlinetaskrow documentrow customerrow">{fields(form,setForm)}<div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>{setCreating(false);setForm({})}}>Ləğv et</button><Button disabled={busy||!requiredFilled(form)} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable documenttable customertable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} extraKeys={["actions"]}/><thead><tr>{order.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}>{excel.header(col)}</SortableTh>})}<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader/></th></tr></thead><tbody>{filtered.map(item=>editingId===item.id?<tr key={item.id}><td colSpan={order.length+1}><div className="inlinetaskrow documentrow customerrow documenteditrow">{fields(editForm,setEditForm)}<div className="inlineactions"><button className="inlinecancel" disabled={editBusy} onClick={cancelEdit}>Ləğv et</button><Button disabled={editBusy||!requiredFilled(editForm)} onClick={()=>void saveEdit(item.id)}>{editBusy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div></td></tr>:<Fragment key={item.id}><tr>
      {order.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      <td data-label="Əməliyyat"><div className="tableactions">{rights.edit&&<button className="editcompanybtn" onClick={()=>startEdit(item)}>Redaktə et</button>}{rights.remove&&!item.usage_count&&<button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button>}{(formerStaff?.get(item.id)?.length||0)>0&&<button className={`formerbtn${formerOpen===item.id?" on":""}`} onClick={()=>setFormerOpen(v=>v===item.id?null:item.id)}>Keçmiş əməkdaşlar ({formerStaff?.get(item.id)?.length})</button>}</div></td>
    </tr>{formerOpen===item.id&&<tr className="formerrow"><td colSpan={order.length+1}><FormerStaffList rows={formerStaff?.get(item.id)||[]}/></td></tr>}{docsOpen===item.id&&<tr className="formerrow"><td colSpan={order.length+1}><CustomerHistory rows={docsOf(item)}/></td></tr>}</Fragment>)}</tbody></table>{!filtered.length&&<Empty text={items.length?"Axtarışa uyğun müştəri tapılmadı.":"Hələ müştəri əlavə edilməyib."}/>}</div>}
  </section>;
}
// Versiya 2.86: a customer's history — its outgoing and incoming documents in one list, newest first, with where each signed copy stands.
type CustomerDocument={kind:"outgoing"|"incoming";id:number;voen:string;company_name:string|null;no:string;date:string|null;document_type:string|null;document_number:string|null;document_date?:string|null;note:string|null;returns_signed_copy?:number;return_due_date?:string|null;returned_no?:string|null;returned_date?:string|null;draft_name?:string|null;final_name?:string|null;has_draft?:boolean;has_final?:boolean;status?:string;file_name?:string|null};
const customerDocReturn=(d:CustomerDocument)=>d.kind==="outgoing"?outgoingReturnState({returns_signed_copy:d.returns_signed_copy,return_due_date:d.return_due_date,final_name:d.has_final?"1":null}):null;
function CustomerHistory({rows}:{rows:CustomerDocument[]}){
  const [direction,setDirection]=useState<"all"|"outgoing"|"incoming"|"unreturned">("all");
  const [docType,setDocType]=useState("");
  const [from,setFrom]=useState("");
  const [to,setTo]=useState("");
  const types=[...new Set(rows.map(r=>r.document_type||"").filter(Boolean))].sort((a,b)=>a.localeCompare(b,"az"));
  const unreturned=rows.filter(r=>{const s=customerDocReturn(r);return Boolean(s&&s.kind!=="done")});
  const shown=(direction==="unreturned"?unreturned:rows).filter(r=>(direction==="all"||direction==="unreturned"||r.kind===direction)&&(!docType||r.document_type===docType)&&(!from||String(r.date||"")>=from)&&(!to||String(r.date||"")<=to));
  const count=(kind:"outgoing"|"incoming")=>rows.filter(r=>r.kind===kind).length;
  const fileLink=(r:CustomerDocument)=>r.kind==="incoming"?(r.file_name?<a className="filelink" href={`/api/documents/incoming/file?id=${r.id}`} target="_blank" rel="noreferrer">Aç</a>:<span className="nodocument">—</span>)
    :r.has_final?<a className="filelink" href={`/api/documents/outgoing/file?id=${r.id}&kind=final`} target="_blank" rel="noreferrer" title={r.final_name||""}>Hazır</a>
    :r.has_draft?<a className="filelink" href={`/api/documents/outgoing/file?id=${r.id}&kind=draft`} target="_blank" rel="noreferrer" title={r.draft_name||""}>İlkin</a>:<span className="nodocument">—</span>;
  const state=(r:CustomerDocument)=>{
    if(r.kind==="incoming")return <span className="nodocument">{r.status||"—"}</span>;
    const s=customerDocReturn(r);
    if(!s)return <span className="nodocument">{r.returns_signed_copy===0?"Qaytarılmır":"Müddət yoxdur"}</span>;
    if(s.kind==="done")return <span className="returnchip done" title={r.returned_no?`Daxil olma №${r.returned_no}`:""}>✓ Qayıdıb{r.returned_date?` — ${formatDateOnly(r.returned_date)}`:""}</span>;
    return s.kind==="overdue"?<span className="returnchip late">Yubanır — {-s.days} gün</span>:<span className="returnchip wait">Gözlənilir — {s.days===0?"bu gün son gündür":`${s.days} gün qalıb`}</span>;
  };
  return <div className="formerlist customerhistory"><b>Müştəri üzrə sənədlərin tarixçəsi</b>
    <div className="historyfilters">
      <div className="fixedsubtabs"><button className={direction==="all"?"on":""} onClick={()=>setDirection("all")}>Hamısı ({rows.length})</button><button className={direction==="outgoing"?"on":""} onClick={()=>setDirection("outgoing")}>➡ Çıxan ({count("outgoing")})</button><button className={direction==="incoming"?"on":""} onClick={()=>setDirection("incoming")}>⬅ Daxil olan ({count("incoming")})</button><button className={direction==="unreturned"?"on":""} onClick={()=>setDirection("unreturned")}>Qayıtmayanlar ({unreturned.length})</button></div>
      {types.length>1&&<select value={docType} onChange={e=>setDocType(e.target.value)}><option value="">Bütün növlər</option>{types.map(t=><option key={t} value={t}>{t}</option>)}</select>}
      <label>Tarixdən<Input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Tarixədək<Input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
    </div>
    <table><thead><tr><th>Tarix</th><th>İstiqamət</th><th>№</th><th>Firma</th><th>Növ</th><th>Sənədin nömrəsi</th><th>Qısa məzmun / qeyd</th><th>Vəziyyət</th><th>Fayl</th></tr></thead><tbody>
      {shown.map(r=><tr key={`${r.kind}-${r.id}`}><td>{formatDateOnly(r.date)}</td><td>{r.kind==="outgoing"?<span className="historydir out">➡ Çıxan</span>:<span className="historydir in">⬅ Daxil olan</span>}</td><td>{r.no}</td><td>{r.company_name||"—"}</td><td>{r.document_type||"—"}</td><td>{r.document_number||"—"}{r.document_date?` · ${formatDateOnly(r.document_date)}`:""}</td><td>{r.note||"—"}</td><td>{state(r)}</td><td>{fileLink(r)}</td></tr>)}
    </tbody></table>{!shown.length&&<small className="nodocument">Seçimə uyğun sənəd yoxdur.</small>}
  </div>;
}
function FormerStaffList({rows}:{rows:FormerStaff[]}){
  return <div className="formerlist"><b>Bu müştəridə işləmiş əməkdaşlarımız</b><table><thead><tr><th>İşçi</th><th>Oradakı vəzifəsi</th><th>Dövr</th><th>Oradan çıxma əsası</th><th>İndi bizdə</th></tr></thead><tbody>
    {rows.map((r,i)=><tr key={`${r.hr_employee_id}-${i}`}><td>{[r.last_name,r.first_name,r.patronymic].filter(Boolean).join(" ")}</td><td>{r.prior_position}</td><td>{formatDateOnly(r.start_date)} – {formatDateOnly(r.end_date)}</td><td>{TERMINATION_REASONS.find(x=>x.key===r.prior_termination_reason)?.label||"—"}</td><td>{r.termination_date?<span className="formergone">İşdən çıxıb ({formatDateOnly(r.termination_date)})</span>:[r.company_name,r.current_position].filter(Boolean).join(" · ")||"—"}</td></tr>)}
  </tbody></table></div>;
}
function AuditPage(){
  const [items,setItems]=useState<AuditItem[]>([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  useEffect(()=>{void(async()=>{try{const response=await fetch("/api/audit");const body=await response.json();if(!response.ok)throw new Error(body.error);setItems(body.items||[])}catch(e){setError(e instanceof Error?e.message:"Əməliyyat jurnalı yüklənmədi.")}finally{setLoading(false)}})()},[]);
  return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><span className="sectioneyebrow">ADMİN ƏMƏLİYYATLARI</span><h2>Əməliyyat jurnalı</h2><p>Son admin əməliyyatları xronoloji ardıcıllıqla</p></div></div>{error&&<div className="errorbox">{error}</div>}{loading?<div className="loading">Əməliyyat jurnalı yüklənir...</div>:<div className="auditlist">{items.length?items.map(item=><article key={item.id}><b>{formatDate(item.created_at)}</b><span>{item.actor_name}</span><span>{item.action}</span><span>{item.target_label||"—"}</span></article>):<Empty text="Hələ qeyd yoxdur."/>}</div>}</section>
}
type ViolationsMeta={can:{add:boolean;edit:boolean;delete:boolean};manager:boolean;employees?:Array<{id:number;name:string}>;companies?:Array<{id:number;name:string}>};
const violationColumns:Array<{key:string;label:string;width:number;search:(item:Violation)=>string;render:(item:Violation)=>React.ReactNode}>=[
  {key:"date",label:"Tarix",width:130,search:i=>formatDate(i.created_at),render:i=><time>{formatDate(i.created_at)}</time>},
  {key:"employee",label:"İşçi",width:170,search:i=>i.employee_name||"",render:i=><b>{i.employee_name}</b>},
  {key:"company",label:"Firma",width:190,search:i=>i.company_name||"",render:i=><>{i.company_name||"—"}</>},
  {key:"title",label:"Nöqsanın başlığı",width:220,search:i=>i.title||"",render:i=><>{i.title}</>},
  {key:"note",label:"Qeyd",width:220,search:i=>i.note||"",render:i=><>{i.note||"—"}</>},
  {key:"author",label:"Qeyd edən",width:160,search:i=>i.created_by_name||"",render:i=><>{i.created_by_name||"—"}</>},
];
function ViolationsPage({isAdmin,employeeFilter,onClearEmployeeFilter,employees,companies,activeCompanyId}:{isAdmin:boolean;employeeFilter?:{id:number;name:string}|null;onClearEmployeeFilter?:()=>void;employees:Employee[];companies:Company[];activeCompanyId?:number|null}){
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
  // Rights come from the server (Versiya 2.62): a manager (the admin, or an employee with Əlavə et / Dəyişiklik et / Sil) sees
  // the violations of their firms and gets the people and firms to pick from; otherwise only their own violations.
  const [meta,setMeta]=useState<ViolationsMeta>({can:{add:isAdmin,edit:isAdmin,delete:isAdmin},manager:isAdmin});
  const apply=(body:{items?:Violation[]}&Partial<ViolationsMeta>)=>{setItems(body.items||[]);setMeta({can:body.can||{add:false,edit:false,delete:false},manager:Boolean(body.manager),employees:body.employees,companies:body.companies})};
  const pickEmployees=meta.employees||employees;
  const pickCompanies=meta.companies||companies;
  const load=async()=>{setLoading(true);setError("");try{const response=await fetch("/api/violations");const body=await response.json();if(!response.ok)throw new Error(body.error);apply(body)}catch(e){setError(e instanceof Error?e.message:"Qeydlər yüklənmədi.")}finally{setLoading(false)}};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void load()},[]);
  const startEdit=(item:Violation)=>{setForm({id:String(item.id),employeeId:String(item.employee_id),companyId:item.company_id?String(item.company_id):"",title:item.title,note:item.note||""});setCreating(true)};
  const create=async()=>{
    if(!form.employeeId||!(form.title||"").trim())return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/violations",{method:form.id?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:form.id?Number(form.id):undefined,employeeId:Number(form.employeeId),companyId:form.companyId?Number(form.companyId):undefined,title:form.title,note:form.note})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      apply(result);setForm({});setCreating(false);
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
      apply(result);
    }catch(e){setError(e instanceof Error?e.message:"Qeyd silinmədi.")}
  };
  const shownItems=employeeFilter?items.filter(item=>item.employee_id===employeeFilter.id):items;
  const counts=Object.values(shownItems.reduce((acc,item)=>{
    const existing=acc[item.employee_id];
    if(existing){existing.count+=1;if(item.created_at>existing.last)existing.last=item.created_at}
    else acc[item.employee_id]={employeeId:item.employee_id,name:item.employee_name,count:1,last:item.created_at};
    return acc;
  },{} as Record<number,{employeeId:number;name:string;count:number;last:string}>)).sort((a,b)=>b.count-a.count);
  const excel=useExcelFilters("violations",violationColumns,shownItems.filter(item=>isAdmin||!activeCompanyId||item.company_id===activeCompanyId));
  const filtered=excel.rows;
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">PERSONAL NƏZARƏTİ</span><h2>Nöqsanlar</h2><p>{meta.manager?`${filtered.length} qeyd göstərilir`:"Sizin adınıza qeydə alınmış noqsanlar"}</p></div>{employeeFilter&&<button className="statusfilterchip" onClick={onClearEmployeeFilter} title="Süzgəci sil">İşçi: {employeeFilter.name} <X/></button>}{meta.can.add&&<Button onClick={()=>{setForm({});setCreating(v=>!v||Boolean(form.id))}}><Plus/>Yeni qeyd</Button>}</div>
    {creating&&<div className="inlinetaskrow documentrow customerrow">
      <label className="field">İşçi<select value={form.employeeId||""} disabled={Boolean(form.id)} onChange={e=>setForm({...form,employeeId:e.target.value})}><option value="">Seçin</option>{(form.id&&!pickEmployees.some(e=>String(e.id)===form.employeeId)?[...pickEmployees,{id:Number(form.employeeId),name:items.find(i=>String(i.id)===form.id)?.employee_name||""}]:pickEmployees).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label className="field">Firma (istəyə bağlı)<select value={form.companyId||""} onChange={e=>setForm({...form,companyId:e.target.value})}><option value="">Seçin</option>{pickCompanies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="field">Nöqsanın başlığı<Input value={form.title||""} onChange={e=>setForm({...form,title:e.target.value})}/></label>
      <label className="field">Qeyd (istəyə bağlı)<Input value={form.note||""} onChange={e=>setForm({...form,note:e.target.value})}/></label>
      <div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>{setCreating(false);setForm({})}}>Ləğv et</button><Button disabled={busy||!form.employeeId||!(form.title||"").trim()} onClick={()=>void create()}>{busy?"Saxlanılır...":form.id?"Yadda saxla":"Əlavə et"}</Button></div>
    </div>}
    {error&&<div className="errorbox">{error}</div>}
    {meta.manager&&!loading&&<div className="employeecards officialcards">{counts.length?counts.map(c=><article key={c.employeeId}><div className="identityblock"><i>{initials(c.name)}</i><div><div className="identitytitle"><h3>{c.name}</h3></div><p><b>Son qeyd:</b> {formatDate(c.last)}</p></div></div><div className="recordmetrics"><span><small>Nöqsan sayı</small><b>{c.count}</b></span></div></article>):<Empty text="Hələ heç bir noqsan qeydə alınmayıb."/>}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable documenttable customertable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} extraKeys={meta.can.edit||meta.can.delete?["actions"]:[]}/><thead><tr>{order.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}>{excel.header(col)}</SortableTh>})}{(meta.can.edit||meta.can.delete)&&<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader/></th>}</tr></thead><tbody>{filtered.map(item=><tr key={item.id}>
      {order.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      {(meta.can.edit||meta.can.delete)&&<td data-label="Əməliyyat"><div className="tableactions">{meta.can.edit&&<button className="editcompanybtn" onClick={()=>startEdit(item)}>Redaktə et</button>}{meta.can.delete&&<button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button>}</div></td>}
    </tr>)}</tbody></table>{!filtered.length&&<Empty text={items.length?"Axtarışa uyğun qeyd tapılmadı.":"Hələ qeyd yoxdur."}/>}</div>}
  </section>;
}
// Versiya 2.76: every template belongs to one firm and one group; the page shows one firm and one group at a time.
type TemplateGroupKey="outgoing"|"incoming"|"other_order";
const TEMPLATE_GROUP_TABS:Array<{key:TemplateGroupKey;label:string}>=[{key:"outgoing",label:"Çıxan sənəd"},{key:"incoming",label:"Daxil olan sənəd"},{key:"other_order",label:"Kadrlar"}];
const templateGroupOf=(t:DocumentTemplate):TemplateGroupKey=>t.template_group==="incoming"||t.template_group==="other_order"?t.template_group:"outgoing";
const templateGroupLabel=(key:string)=>TEMPLATE_GROUP_TABS.find(g=>g.key===key)?.label||key;
function DocumentsPage({isAdmin,companies}:{isAdmin:boolean;companies:Company[]}){
  const [items,setItems]=useState<DocumentTemplate[]>([]);
  const [notice,setNotice]=useState("");
  // The firm and group being looked at (remembered in this browser).
  const [companyId,setCompanyIdState]=useState<number>(()=>{try{return Number(window.localStorage.getItem("templates:company"))||0}catch{return 0}});
  const [group,setGroupState]=useState<TemplateGroupKey>(()=>{try{const v=window.localStorage.getItem("templates:group");return v==="incoming"||v==="other_order"?v:"outgoing"}catch{return "outgoing"}});
  const firmId=companies.some(c=>c.id===companyId)?companyId:(companies[0]?.id||0);
  const firmName=(id:number|null|undefined)=>companies.find(c=>c.id===id)?.name||"—";
  const setCompanyId=(id:number)=>{setCompanyIdState(id);setEditingId(null);setCopyingId(null);try{window.localStorage.setItem("templates:company",String(id))}catch{}};
  const setGroup=(key:TemplateGroupKey)=>{setGroupState(key);setEditingId(null);setCopyingId(null);setCreating(false);try{window.localStorage.setItem("templates:group",key)}catch{}};
  const shownItems=items.filter(t=>Number(t.company_id)===firmId&&templateGroupOf(t)===group);
  // "Kopyala": the template, with its files, folders and rules, into another firm and/or group.
  const [copyingId,setCopyingId]=useState<number|null>(null);
  const [copyForm,setCopyForm]=useState<{companyId:string;group:TemplateGroupKey;name:string}>({companyId:"",group:"outgoing",name:""});
  const [copyBusy,setCopyBusy]=useState(false);
  // Versiya 2.77: "Aidiyyatı şöbələr" of a type — picked from the firm's structure; the first is the main department.
  const [firmDepts,setFirmDepts]=useState<Record<number,string[]>>({});
  const [newDepartments,setNewDepartments]=useState<string[]>([]);
  const [editDepartments,setEditDepartments]=useState<string[]>([]);
  useEffect(()=>{
    if(!firmId||firmDepts[firmId])return;
    void fetch(`/api/company-structure?companyId=${firmId}`).then(r=>r.ok?r.json():{items:[]}).then(body=>{
      const names=[...new Set(((body.items||[]) as Array<{department:string}>).map(p=>p.department).filter(Boolean))];
      setFirmDepts(current=>({...current,[firmId]:names}));
    });
  },[firmId,firmDepts]);
  const departmentPicker=(picked:string[],put:(list:string[])=>void)=>{
    const options=firmDepts[firmId]||[];
    const lost=picked.filter(d=>!options.includes(d));
    return <div className="field incomingdepartments outgoingrelated" key="departments"><span>Aidiyyatı şöbələr <small>bu tipli sənəd qeydə alınanda avtomatik yazılır; birinci — əsas şöbə. Boş qalsa, qeydiyyatçı özü seçir.</small></span><div>{options.length?options.map(o=>{const at=picked.indexOf(o);return <label key={o}><input type="checkbox" checked={at>=0} onChange={e=>put(e.target.checked?[...picked,o]:picked.filter(d=>d!==o))}/><b>{o}</b>{at===0&&<em className="incomingrelatedtag">əsas</em>}{at>0&&<button type="button" className="hrlink hrlinkok" onClick={ev=>{ev.preventDefault();put([o,...picked.filter(d=>d!==o)])}}>əsas et</button>}</label>}):<small>Firmanın strukturunda şöbə yoxdur (Firmalar → Struktur).</small>}{lost.map(d=><label key={d} className="templateremoved"><b>{d}</b><small>strukturda yoxdur</small><button type="button" className="hrlink" onClick={ev=>{ev.preventDefault();put(picked.filter(x=>x!==d))}}>sil</button></label>)}</div></div>;
  };
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [creating,setCreating]=useState(false);
  const [name,setName]=useState("");
  const [file1,setFile1]=useState<File|null>(null);
  const [file2,setFile2]=useState<File|null>(null);
  const [file3,setFile3]=useState<File|null>(null);
  const [draftFolderPath,setDraftFolderPath]=useState("");
  const [finalFolderPath,setFinalFolderPath]=useState("");
  const [fileNamePattern,setFileNamePattern]=useState("");
  const [incomingFolderPath,setIncomingFolderPath]=useState("");
  const [incomingNamePattern,setIncomingNamePattern]=useState("");
  const [signedReturn,setSignedReturn]=useState("1");
  // Versiya 2.75: in how many days the signed copy must come back; and template files marked to be taken off on saving.
  const [signedDays,setSignedDays]=useState("");
  const [editSignedDays,setEditSignedDays]=useState("");
  const [editRemove,setEditRemove]=useState<Record<number,boolean>>({});
  const [storage,setStorage]=useState<{folderSaving:boolean}|null>(null);
  const [busy,setBusy]=useState(false);
  const [editingId,setEditingId]=useState<number|null>(null);
  const [editName,setEditName]=useState("");
  const [editFile1,setEditFile1]=useState<File|null>(null);
  const [editFile2,setEditFile2]=useState<File|null>(null);
  const [editFile3,setEditFile3]=useState<File|null>(null);
  const [editDraftFolderPath,setEditDraftFolderPath]=useState("");
  const [editFinalFolderPath,setEditFinalFolderPath]=useState("");
  const [editFileNamePattern,setEditFileNamePattern]=useState("");
  const [editIncomingFolderPath,setEditIncomingFolderPath]=useState("");
  const [editIncomingNamePattern,setEditIncomingNamePattern]=useState("");
  const [editSignedReturn,setEditSignedReturn]=useState("1");
  const [editBusy,setEditBusy]=useState(false);
  const load=async()=>{setLoading(true);setError("");try{const response=await fetch("/api/documents");const body=await response.json();if(!response.ok)throw new Error(body.error);setItems(body.items||[]);setStorage(body.storage||null)}catch(e){setError(e instanceof Error?e.message:"Siyahı açıla bilmədi.")}finally{setLoading(false)}};
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
      const body:Record<string,unknown>={name,companyId:firmId,templateGroup:group,departments:group==="other_order"?[]:newDepartments,draftFolderPath,finalFolderPath,fileNamePattern,incomingFolderPath,incomingNamePattern,signedCopyReturns:signedReturn,signedCopyDays:signedReturn==="1"?signedDays:""};
      if(file1){const uploaded=await uploadFile(file1);body.template1Key=uploaded.key;body.template1Name=uploaded.name;body.template1Size=uploaded.size;body.template1Type=uploaded.type}
      if(file2){const uploaded=await uploadFile(file2);body.template2Key=uploaded.key;body.template2Name=uploaded.name;body.template2Size=uploaded.size;body.template2Type=uploaded.type}
      if(file3){const uploaded=await uploadFile(file3);body.template3Key=uploaded.key;body.template3Name=uploaded.name;body.template3Size=uploaded.size;body.template3Type=uploaded.type}
      const response=await fetch("/api/documents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setName("");setFile1(null);setFile2(null);setFile3(null);setDraftFolderPath("");setFinalFolderPath("");setFileNamePattern("");setIncomingFolderPath("");setIncomingNamePattern("");setSignedReturn("1");setSignedDays("");setNewDepartments([]);setCreating(false);
    }catch(e){setError(e instanceof Error?e.message:"Sənəd əlavə olunmadı.")}
    finally{setBusy(false)}
  };
  const startEdit=(item:DocumentTemplate)=>{setEditingId(item.id);setCopyingId(null);setEditName(item.name);setEditDepartments(parseList(item.departments||"[]"));setEditFile1(null);setEditFile2(null);setEditFile3(null);setEditDraftFolderPath(item.draft_folder_path||"");setEditFinalFolderPath(item.final_folder_path||"");setEditFileNamePattern(item.file_name_pattern||"");setEditIncomingFolderPath(item.incoming_folder_path||"");setEditIncomingNamePattern(item.incoming_name_pattern||"");setEditSignedReturn(item.signed_copy_returns===0?"0":"1");setEditSignedDays(item.signed_copy_days?String(item.signed_copy_days):"");setEditRemove({})};
  const cancelEdit=()=>{setEditingId(null);setEditFile1(null);setEditFile2(null);setEditFile3(null)};
  const saveEdit=async(item:DocumentTemplate)=>{
    setEditBusy(true);setError("");
    try{
      const body:Record<string,unknown>={id:item.id,name:editName,...(templateGroupOf(item)==="other_order"?{}:{departments:editDepartments}),draftFolderPath:editDraftFolderPath,finalFolderPath:editFinalFolderPath,fileNamePattern:editFileNamePattern,incomingFolderPath:editIncomingFolderPath,incomingNamePattern:editIncomingNamePattern,signedCopyReturns:editSignedReturn,signedCopyDays:editSignedReturn==="1"?editSignedDays:"",template1Remove:Boolean(editRemove[1]),template2Remove:Boolean(editRemove[2]),template3Remove:Boolean(editRemove[3])};
      if(editFile1){const uploaded=await uploadFile(editFile1);body.template1Key=uploaded.key;body.template1Name=uploaded.name;body.template1Size=uploaded.size;body.template1Type=uploaded.type}
      if(editFile2){const uploaded=await uploadFile(editFile2);body.template2Key=uploaded.key;body.template2Name=uploaded.name;body.template2Size=uploaded.size;body.template2Type=uploaded.type}
      if(editFile3){const uploaded=await uploadFile(editFile3);body.template3Key=uploaded.key;body.template3Name=uploaded.name;body.template3Size=uploaded.size;body.template3Type=uploaded.type}
      const response=await fetch("/api/documents",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setEditingId(null);setEditFile1(null);setEditFile2(null);setEditFile3(null);setEditRemove({});
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
  const startCopy=(item:DocumentTemplate)=>{setCopyingId(item.id);setEditingId(null);setNotice("");setCopyForm({companyId:String(companies.find(c=>c.id!==firmId)?.id||firmId),group:templateGroupOf(item),name:item.name})};
  const copy=async(item:DocumentTemplate)=>{
    setCopyBusy(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/documents",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"copy",id:item.id,companyId:Number(copyForm.companyId),templateGroup:copyForm.group,name:copyForm.name})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setCopyingId(null);
      const dropped:string[]=result.droppedDepartments||[];
      setNotice(`“${item.name}” kopyalandı → ${firmName(Number(copyForm.companyId))} · ${templateGroupLabel(copyForm.group)}${copyForm.name.trim()&&copyForm.name.trim()!==item.name?` (“${copyForm.name.trim()}”)`:""}.${dropped.length?` O firmanın strukturunda olmayan aidiyyatı şöbələr köçürülmədi: ${dropped.join(", ")} — kopyada yoxlayın.`:""}`);
    }catch(e){setError(e instanceof Error?e.message:"Şablon kopyalanmadı.")}
    finally{setCopyBusy(false)}
  };
  // Versiya 2.83: a template folder is picked on the server; one no longer there is marked ⚠ so the admin picks it again.
  const folderCell=(value:string|null,missing?:boolean)=>value?<span className={joinClass("folderpath",missing?"foldermissing":undefined)} title={missing?`Papka serverdə tapılmadı — yenidən seçin: ${value}`:value}>{missing&&"⚠ "}{value}</span>:<span className="nodocument">Qeyd edilməyib</span>;
  const folderField=(key:string,label:string,value:string,set:(v:string)=>void)=><FolderField key={key} label={label} value={value} set={set} canPick={Boolean(storage?.folderSaving)}/>;
  const templateLink=(key:string|null,name:string|null,size:number|null)=>key?<a className="filelink" href={`/api/file?key=${encodeURIComponent(key)}`}>{name}<small>{formatFileSize(size||0)}</small></a>:<span className="nodocument">Yoxdur</span>;
  const templateLabel=(n:number)=><span className="templatelabel">Sənədin şablonu<br/>{n}</span>;
  const documentColumns:Array<{key:string;label:string;width:number;search:(item:DocumentTemplate)=>string;render:(item:DocumentTemplate)=>React.ReactNode}>=[
    {key:"name",label:"Sənədin adı",width:240,search:item=>item.name,render:item=><b>{item.name}</b>},
    {key:"departments",label:"Aidiyyatı şöbələr",width:180,search:item=>parseList(item.departments||"[]").join(", ")||"Qeydiyyatçı seçir",render:item=>{const list=parseList(item.departments||"[]");return list.length?<>{list.map((d,n)=><div key={d} className="incomingdept"><b>{d}</b>{n===0&&list.length>1&&<small className="requestsub">əsas şöbə</small>}</div>)}</>:<span className="nodocument">Qeydiyyatçı seçir</span>}},
    {key:"signedReturn",label:"İmzalı nüsxə geri qaytarılır",width:140,search:item=>item.signed_copy_returns===0?"Xeyr":item.signed_copy_days?`Bəli ${item.signed_copy_days} gün`:"Bəli",render:item=>item.signed_copy_returns===0?<span className="signedreturn no">Xeyr</span>:<span className="signedreturn yes">Bəli{item.signed_copy_days?` · ${item.signed_copy_days} gün`:""}</span>},
    {key:"fileNamePattern",label:"Çıxan sənəd üçün adlanma qaydası",width:230,search:item=>item.file_name_pattern||DEFAULT_FILE_NAME_PATTERN,render:item=>item.file_name_pattern?<span className="folderpath">{item.file_name_pattern}</span>:<span className="nodocument" title="Qayda yazılmayıb — standart qayda işlədilir">{DEFAULT_FILE_NAME_PATTERN}</span>},
    {key:"template1",label:"Sənədin şablonu 1",width:220,search:item=>item.template1_name||"Yoxdur",render:item=>templateLink(item.template1_key,item.template1_name,item.template1_size)},
    {key:"template2",label:"Sənədin şablonu 2",width:220,search:item=>item.template2_name||"Yoxdur",render:item=>templateLink(item.template2_key,item.template2_name,item.template2_size)},
    {key:"template3",label:"Sənədin şablonu 3",width:220,search:item=>item.template3_name||"Yoxdur",render:item=>templateLink(item.template3_key,item.template3_name,item.template3_size)},
    {key:"draftFolder",label:"Çıxan sənəd üçün ilkin sənəd papkası",width:220,search:item=>item.draft_folder_path||"Qeyd edilməyib",render:item=>folderCell(item.draft_folder_path,item.draft_folder_missing)},
    {key:"finalFolder",label:"Çıxan sənəd üçün hazır sənəd papkası",width:220,search:item=>item.final_folder_path||"Qeyd edilməyib",render:item=>folderCell(item.final_folder_path,item.final_folder_missing)},
    {key:"incomingFolder",label:"Daxil olan sənəd üçün hazır sənəd papkası",width:230,search:item=>item.incoming_folder_path||"Qeyd edilməyib",render:item=>folderCell(item.incoming_folder_path,item.incoming_folder_missing)},
    {key:"incomingNamePattern",label:"Daxil olan sənəd üçün adlanma qaydası",width:230,search:item=>item.incoming_name_pattern||DEFAULT_INCOMING_NAME,render:item=>item.incoming_name_pattern?<span className="folderpath">{item.incoming_name_pattern}</span>:<span className="nodocument" title="Qayda yazılmayıb — standart qayda işlədilir">{DEFAULT_INCOMING_NAME}</span>},
  ];
  // Only the columns (and form fields) of the group being looked at.
  const ALL_GROUPS:TemplateGroupKey[]=["outgoing","incoming","other_order"];
  const columnGroups:Record<string,TemplateGroupKey[]>={name:ALL_GROUPS,departments:["outgoing","incoming"],signedReturn:["outgoing"],fileNamePattern:["outgoing"],template1:["outgoing","other_order"],template2:["outgoing"],template3:["outgoing"],draftFolder:["outgoing"],finalFolder:["outgoing"],incomingFolder:["incoming"],incomingNamePattern:["incoming"]};
  const shownColumns=documentColumns.filter(c=>columnGroups[c.key]?.includes(group));
  const shownKeys=new Set(shownColumns.map(c=>c.key));
  const {order:allOrder,widths,setWidth,moveColumn}=useTableColumns("templates2",documentColumns.map(c=>c.key));
  const order=allOrder.filter(key=>shownKeys.has(key));
  const resize=useEdgeResize(setWidth,60);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(documentColumns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(documentColumns.map(c=>[c.key,c.width]));
  const excel=useExcelFilters("templates",shownColumns,shownItems);
  const createFieldRenderers:Record<string,()=>React.ReactNode>={
    name:()=><Field key="name" label="Sənədin adı" value={name} set={setName}/>,
    departments:()=>departmentPicker(newDepartments,setNewDepartments),
    signedReturn:()=><Fragment key="signedReturn"><label className="field">İmzalı nüsxə geri qaytarılır<select value={signedReturn} onChange={e=>setSignedReturn(e.target.value)}><option value="1">Bəli — qarşı tərəf bir nüsxəni imzalayıb qaytarır</option><option value="0">Xeyr — geri qaytarılmır (məs. məktub)</option></select></label>{signedReturn==="1"&&<label className="field">Qaytarılma müddəti (təqvim günü)<Input type="number" min={1} placeholder="Məs. 10" value={signedDays} onChange={e=>setSignedDays(e.target.value)}/><small>Bu müddət keçəndə imzalı nüsxəsi qayıtmayan sənəd “Yubanır” olur. Boş qoysanız, müddət izlənmir.</small></label>}</Fragment>,
    fileNamePattern:()=><label className="field" key="fileNamePattern">Çıxan sənəd üçün adlanma qaydası<Input value={fileNamePattern} placeholder={DEFAULT_FILE_NAME_PATTERN} onChange={e=>setFileNamePattern(e.target.value)}/></label>,
    template1:()=><label className="field filefield" key="template1">{templateLabel(1)}<Input type="file" onChange={e=>setFile1(e.target.files?.[0]||null)}/>{file1&&<small>{file1.name} • {formatFileSize(file1.size)}</small>}{group==="other_order"&&<small>Əmrin mətni bu Word (.docx) faylından oxunur. Yer tutucular: {ORDER_TEMPLATE_TOKENS.map(t=>"{"+t+"}").join(" ")}</small>}</label>,
    template2:()=><label className="field filefield" key="template2">{templateLabel(2)}<Input type="file" onChange={e=>setFile2(e.target.files?.[0]||null)}/>{file2&&<small>{file2.name} • {formatFileSize(file2.size)}</small>}</label>,
    template3:()=><label className="field filefield" key="template3">{templateLabel(3)}<Input type="file" onChange={e=>setFile3(e.target.files?.[0]||null)}/>{file3&&<small>{file3.name} • {formatFileSize(file3.size)}</small>}</label>,
    draftFolder:()=>folderField("draftFolder","Çıxan sənəd üçün ilkin sənəd papkası",draftFolderPath,setDraftFolderPath),
    finalFolder:()=>folderField("finalFolder","Çıxan sənəd üçün hazır sənəd papkası",finalFolderPath,setFinalFolderPath),
    incomingFolder:()=>folderField("incomingFolder","Daxil olan sənəd üçün hazır sənəd papkası",incomingFolderPath,setIncomingFolderPath),
    incomingNamePattern:()=><label className="field" key="incomingNamePattern">Daxil olan sənəd üçün adlanma qaydası<Input value={incomingNamePattern} placeholder={DEFAULT_INCOMING_NAME} onChange={e=>setIncomingNamePattern(e.target.value)}/></label>,
  };
  const editFieldRenderers=(item:DocumentTemplate):Record<string,()=>React.ReactNode>=>({
    name:()=><Field key="name" label="Sənədin adı" value={editName} set={setEditName}/>,
    departments:()=>departmentPicker(editDepartments,setEditDepartments),
    signedReturn:()=><Fragment key="signedReturn"><label className="field">İmzalı nüsxə geri qaytarılır<select value={editSignedReturn} onChange={e=>setEditSignedReturn(e.target.value)}><option value="1">Bəli — qarşı tərəf bir nüsxəni imzalayıb qaytarır</option><option value="0">Xeyr — geri qaytarılmır (məs. məktub)</option></select></label>{editSignedReturn==="1"&&<label className="field">Qaytarılma müddəti (təqvim günü)<Input type="number" min={1} placeholder="Məs. 10" value={editSignedDays} onChange={e=>setEditSignedDays(e.target.value)}/><small>Bu müddət keçəndə imzalı nüsxəsi qayıtmayan sənəd “Yubanır” olur. Boş qoysanız, müddət izlənmir.</small><small>Dəyişiklik yalnız bundan sonra qeydə alınan sənədlərə aiddir.</small></label>}</Fragment>,
    fileNamePattern:()=><label className="field" key="fileNamePattern">Çıxan sənəd üçün adlanma qaydası<Input value={editFileNamePattern} placeholder={DEFAULT_FILE_NAME_PATTERN} onChange={e=>setEditFileNamePattern(e.target.value)}/></label>,
    template1:()=><label className="field filefield" key="template1">{templateLabel(1)} (əvəz etmək üçün seçin){item.template1_name&&<small className={editRemove[1]?"templateremoved":undefined}>Hazırkı: {item.template1_name} <button type="button" className="templateremove" onClick={e=>{e.preventDefault();setEditRemove(r=>({...r,1:!r[1]}))}}>{editRemove[1]?"Geri al":"✕ Faylı sil"}</button></small>}{editRemove[1]&&<small className="templateremovenote">“Saxla” basılanda fayl silinəcək.</small>}<Input type="file" onChange={e=>setEditFile1(e.target.files?.[0]||null)}/>{editFile1&&<small>{editFile1.name} • {formatFileSize(editFile1.size)}</small>}{group==="other_order"&&<small>Əmrin mətni bu Word (.docx) faylından oxunur. Yer tutucular: {ORDER_TEMPLATE_TOKENS.map(t=>"{"+t+"}").join(" ")}</small>}</label>,
    template2:()=><label className="field filefield" key="template2">{templateLabel(2)} (əvəz etmək üçün seçin){item.template2_name&&<small className={editRemove[2]?"templateremoved":undefined}>Hazırkı: {item.template2_name} <button type="button" className="templateremove" onClick={e=>{e.preventDefault();setEditRemove(r=>({...r,2:!r[2]}))}}>{editRemove[2]?"Geri al":"✕ Faylı sil"}</button></small>}{editRemove[2]&&<small className="templateremovenote">“Saxla” basılanda fayl silinəcək.</small>}<Input type="file" onChange={e=>setEditFile2(e.target.files?.[0]||null)}/>{editFile2&&<small>{editFile2.name} • {formatFileSize(editFile2.size)}</small>}</label>,
    template3:()=><label className="field filefield" key="template3">{templateLabel(3)} (əvəz etmək üçün seçin){item.template3_name&&<small className={editRemove[3]?"templateremoved":undefined}>Hazırkı: {item.template3_name} <button type="button" className="templateremove" onClick={e=>{e.preventDefault();setEditRemove(r=>({...r,3:!r[3]}))}}>{editRemove[3]?"Geri al":"✕ Faylı sil"}</button></small>}{editRemove[3]&&<small className="templateremovenote">“Saxla” basılanda fayl silinəcək.</small>}<Input type="file" onChange={e=>setEditFile3(e.target.files?.[0]||null)}/>{editFile3&&<small>{editFile3.name} • {formatFileSize(editFile3.size)}</small>}</label>,
    draftFolder:()=>folderField("draftFolder","Çıxan sənəd üçün ilkin sənəd papkası",editDraftFolderPath,setEditDraftFolderPath),
    finalFolder:()=>folderField("finalFolder","Çıxan sənəd üçün hazır sənəd papkası",editFinalFolderPath,setEditFinalFolderPath),
    incomingFolder:()=>folderField("incomingFolder","Daxil olan sənəd üçün hazır sənəd papkası",editIncomingFolderPath,setEditIncomingFolderPath),
    incomingNamePattern:()=><label className="field" key="incomingNamePattern">Daxil olan sənəd üçün adlanma qaydası<Input value={editIncomingNamePattern} placeholder={DEFAULT_INCOMING_NAME} onChange={e=>setEditIncomingNamePattern(e.target.value)}/></label>,
  });
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>Sənədlər</h2><p>Sənəd adları və şablonları — hər firmanın öz şablonları</p></div>{isAdmin&&firmId>0&&<Button onClick={()=>{setCreating(v=>!v);setNotice("")}}><Plus/>Yeni sənəd</Button>}</div>
    {isAdmin&&storage&&<div className="docstoragebar">
      <p>{storage.folderSaving?"Papkanı “Papka seç” ilə serverdən seçin: diski açın, içindəki papkalara keçin və lazım olanda “Bu papkanı seç” basın. Papkaları serverdə admin özü yaradır — proqram papka yaratmır. Seçilmiş papka sonradan serverdən silinsə və ya adı dəyişsə, cədvəldə ⚠ görünür və sənəd yüklənmir — papkanı yenidən seçin.":"Proqram hazırda buludda işləyir — sənədlər qaydaya uyğun adla sistemdə saxlanılır. Papkaya yazmaq proqram öz serverdə işləyəndə aktiv olur."}</p>
      <p className="doctokens">Ad qaydasının dəyişənləri: {DOCUMENT_TOKENS.map(t=><code key={t}>{"{"+t+"}"}</code>)}</p>
    </div>}
    {companies.length>0&&<div className="templatescope"><label className="field">Firma<select value={firmId||""} onChange={e=>setCompanyId(Number(e.target.value))}>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><div className="fixedsubtabs">{TEMPLATE_GROUP_TABS.map(g=>{const n=items.filter(t=>Number(t.company_id)===firmId&&templateGroupOf(t)===g.key).length;return <button key={g.key} className={group===g.key?"on":""} onClick={()=>setGroup(g.key)}>{g.label} ({n})</button>})}</div></div>}
    {!companies.length&&!loading&&<div className="errorbox">Aktiv firma yoxdur — şablon firmaya aid olur, əvvəlcə Tənzimləmələr → Firmalar bölməsində firma əlavə edin.</div>}
    {creating&&firmId>0&&<div className="inlinetaskrow documentrow"><small className="templatecreatefor">Yeni şablon: <b>{firmName(firmId)}</b> · <b>{templateGroupLabel(group)}</b></small>{order.map(key=>createFieldRenderers[key]())}<div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>setCreating(false)}>Ləğv et</button><Button disabled={busy||!name.trim()} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {notice&&<div className="hrok">{notice}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable documenttable templatetable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} extraKeys={isAdmin?["actions"]:[]}/><thead><tr>{order.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}>{excel.header(col)}</SortableTh>})}{isAdmin&&<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader/></th>}</tr></thead><tbody>{excel.rows.map(item=>editingId===item.id?<tr key={item.id}><td colSpan={order.length+(isAdmin?1:0)}><div className="inlinetaskrow documentrow documenteditrow">{order.map(key=>editFieldRenderers(item)[key]())}<div className="inlineactions"><button className="inlinecancel" disabled={editBusy} onClick={cancelEdit}>Ləğv et</button><Button disabled={editBusy||!editName.trim()} onClick={()=>void saveEdit(item)}>{editBusy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div></td></tr>:<Fragment key={item.id}><tr>
      {order.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      {isAdmin&&<td data-label="Əməliyyat"><div className="tableactions"><button className="editcompanybtn" onClick={()=>startEdit(item)}>Redaktə et</button><button className="editcompanybtn" onClick={()=>copyingId===item.id?setCopyingId(null):startCopy(item)}>Kopyala</button><button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button></div></td>}
    </tr>{copyingId===item.id&&<tr><td colSpan={order.length+(isAdmin?1:0)}><div className="inlinetaskrow documentrow templatecopyrow">
      <small className="templatecreatefor">“{item.name}” şablonunu faylları, papkaları və qaydaları ilə kopyala:</small>
      <label className="field">Hansı firmaya<select value={copyForm.companyId} onChange={e=>setCopyForm(f=>({...f,companyId:e.target.value}))}>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="field">Hansı qrupa<select value={copyForm.group} onChange={e=>setCopyForm(f=>({...f,group:e.target.value as TemplateGroupKey}))}>{TEMPLATE_GROUP_TABS.map(g=><option key={g.key} value={g.key}>{g.label}</option>)}</select></label>
      <Field label="Adı" value={copyForm.name} set={v=>setCopyForm(f=>({...f,name:v}))}/>
      <div className="inlineactions"><button className="inlinecancel" disabled={copyBusy} onClick={()=>setCopyingId(null)}>Ləğv et</button><Button disabled={copyBusy||!copyForm.name.trim()||!Number(copyForm.companyId)} onClick={()=>void copy(item)}>{copyBusy?"Kopyalanır...":"Kopyala"}</Button></div>
    </div></td></tr>}</Fragment>)}</tbody></table>{!shownItems.length&&<Empty text={items.length?`${firmName(firmId)} · ${templateGroupLabel(group)} qrupunda şablon yoxdur. “Yeni sənəd” ilə əlavə edin və ya başqa firmadan “Kopyala” edin.`:"Hələ sənəd əlavə edilməyib."}/>}</div>}
  </section>;
}
const DEFAULT_FILE_NAME_PATTERN="{ÇıxışNo}_{SənədTipi}_{Təşkilat}_{Tarix}";
const DEFAULT_INCOMING_NAME="{DaxilOlmaNo}_{Təşkilat}_{Tarix}";
const DOCUMENT_TOKENS=["ÇıxışNo","DaxilOlmaNo","SənədNo","SənədTipi","Təşkilat","VÖEN","Firma","Şöbə","Tarix","İl","Ay"];
// Versiya 2.75: where the signed copy of an outgoing document stands against its return date (null: nothing is awaited by a date).
type OutgoingReturn={kind:"done"|"waiting"|"overdue";days:number}|null;
function outgoingReturnState(item:{returns_signed_copy?:number;return_due_date?:string|null;final_name?:string|null;final_path?:string|null;final_key?:string|null}):OutgoingReturn{
  if(item.returns_signed_copy===0||!item.return_due_date)return null;
  if(item.final_name||item.final_path||item.final_key)return {kind:"done",days:0};
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Baku"}).format(new Date());
  const days=Math.round((Date.parse(`${item.return_due_date}T00:00:00Z`)-Date.parse(`${today}T00:00:00Z`))/86400000);
  return {kind:days<0?"overdue":"waiting",days};
}
const outgoingMainDepartment=(item:OutgoingDocument)=>(item.related_departments||[])[0]||item.sending_department||"Şöbə göstərilməyib";
const outgoingResponsible=(item:OutgoingDocument)=>item.responsible_name||item.delivered_by||"Məsul göstərilməyib";
type OverdueSignedCopy={id:number;outgoing_no:string;organization_name:string|null;document_type:string|null;return_due_date:string|null};
type OutgoingPreset={department?:string;responsible?:string;nonce:number};
function OutgoingDocumentsPage({isAdmin,companies,activeCompanyId,preset,onPresetUsed}:{isAdmin:boolean;companies:Company[];activeCompanyId:number|null;preset?:OutgoingPreset|null;onPresetUsed?:()=>void}){
  const [items,setItems]=useState<OutgoingDocument[]>([]);
  const [templates,setTemplates]=useState<DocumentTemplate[]>([]);
  const [customers,setCustomers]=useState<Customer[]>([]);
  const [departments,setDepartments]=useState<Record<number,string[]>>({});
  const [canRegister,setCanRegister]=useState(false);
  const [registerIn,setRegisterIn]=useState<RegisterTarget[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState<Record<string,string>>({});
  const [newFile,setNewFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [editingId,setEditingId]=useState<number|null>(null);
  const [editForm,setEditForm]=useState<Record<string,string>>({});
  const [editBusy,setEditBusy]=useState(false);
  const [uploading,setUploading]=useState<string|null>(null);
  const [onlyApproval,setOnlyApproval]=useState(false);
  // "Yubananlar": documents whose signed copy is late, optionally narrowed to one department or one responsible person.
  const [onlyOverdue,setOnlyOverdue]=useState(false);
  const [overdueDept,setOverdueDept]=useState("");
  const [overdueUser,setOverdueUser]=useState("");
  const [presetSeen,setPresetSeen]=useState(0);
  if(preset&&preset.nonce!==presetSeen){setPresetSeen(preset.nonce);setOnlyOverdue(true);setOnlyApproval(false);setOverdueDept(preset.department||"");setOverdueUser(preset.responsible||"")}
  // Used once: coming back to Çıxan sənədlər from the menu later shows all documents again.
  useEffect(()=>{if(preset)onPresetUsed?.()},[preset,onPresetUsed]);
  const [members,setMembers]=useState<Record<number,Array<{id:number;name:string;department:string}>>>({});
  const load=async()=>{setLoading(true);setError("");try{const [outgoingResponse,templateResponse,customerResponse]=await Promise.all([fetch("/api/documents/outgoing"),fetch("/api/documents"),fetch("/api/customers")]);const outgoingBody=await outgoingResponse.json();if(!outgoingResponse.ok)throw new Error(outgoingBody.error);setItems(outgoingBody.items||[]);setCanRegister(Boolean(outgoingBody.canRegister));setRegisterIn(outgoingBody.registerIn||[]);const templateBody=await templateResponse.json();if(templateResponse.ok)setTemplates((templateBody.items||[]).filter((t:DocumentTemplate)=>templateGroupOf(t)==="outgoing"));const customerBody=await customerResponse.json();if(customerResponse.ok)setCustomers(customerBody.items||[])}catch(e){setError(e instanceof Error?e.message:"Siyahı açıla bilmədi.")}finally{setLoading(false)}};
  const reloadItems=async()=>{const response=await fetch("/api/documents/outgoing");const body=await response.json();if(response.ok)setItems(body.items||[])};
  useEffect(()=>{void load()},[]);
  // An employee files documents for the firm picked in the sidebar; the admin, or an employee in "Bütün firmalar" (2.88), picks it in the form.
  // Versiya 2.99: a new document goes only to a firm where this user may register, and only with the types allowed there.
  const createFirms=companies.filter(c=>registerIn.some(r=>r.companyId===c.id));
  const companyOf=(values:Record<string,string>)=>Number(values.companyId||activeCompanyId||(values!==editForm&&createFirms.length===1?createFirms[0].id:companies.length===1?companies[0].id:0))||0;
  const createCompanyId=companyOf(form);
  const editCompanyId=companyOf(editForm);
  useEffect(()=>{
    for(const companyId of [createCompanyId,editCompanyId]){
      if(!companyId||departments[companyId])continue;
      void fetch(`/api/company-structure?companyId=${companyId}&members=1`).then(r=>r.ok?r.json():{items:[]}).then(body=>{
        const names=[...new Set(((body.items||[]) as Array<{department:string}>).map(p=>p.department).filter(Boolean))];
        setDepartments(current=>({...current,[companyId]:names}));
        setMembers(current=>({...current,[companyId]:body.members||[]}));
      });
    }
  },[createCompanyId,editCompanyId,departments]);
  // Whatever name the file arrives with, the server renames it by the template's rule and writes it into the template's folder.
  const uploadStage=async(item:{id:number;draft_name?:string|null;final_name?:string|null},kind:"draft"|"final",file:File)=>{
    if(file.size>25*1024*1024){setError("Faylın həcmi 25 MB-dan çox ola bilməz.");return}
    const existing=kind==="draft"?item.draft_name:item.final_name;
    if(existing&&!window.confirm(`"${existing}" faylı yenisi ilə əvəz olunacaq. Davam edilsin?`))return;
    setUploading(`${item.id}:${kind}`);setError("");setNotice("");
    try{
      const upload=new FormData();upload.append("file",file);upload.append("id",String(item.id));upload.append("kind",kind);
      const response=await fetch("/api/documents/outgoing/file",{method:"POST",body:upload});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Fayl yüklənmədi.");
      setNotice(result.note||`Sənəd "${result.name}" adı ilə${result.path?` ${result.path} ünvanında`:""} saxlanıldı.`);
      await reloadItems();
    }catch(e){setError(e instanceof Error?e.message:"Fayl yüklənmədi.")}
    finally{setUploading(null)}
  };
  const create=async()=>{
    const voenValue=(form.voen||"").trim();
    if(voenValue&&!customers.some(c=>c.voen===voenValue)){setError("Bu VÖEN müştəri siyahısında tapılmadı. Zəhmət olmasa düzgün VÖEN daxil edin.");return}
    if(!createCompanyId){setError("Firmanı seçin.");return}
    if(!effectiveRelated(form).length){setError("Əlaqəli şöbəni (və ya şöbələri) seçin.");return}
    setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/documents/outgoing",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...form,companyId:createCompanyId,relatedDepartments:effectiveRelated(form),informedDepartments:parseList(form.informedDepartments)})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setForm({});setCreating(false);
      if(newFile&&result.id)await uploadStage({id:result.id},"draft",newFile);
      setNewFile(null);
    }catch(e){setError(e instanceof Error?e.message:"Sənəd əlavə olunmadı.")}
    finally{setBusy(false)}
  };
  const startEdit=(item:OutgoingDocument)=>{setEditingId(item.id);setEditForm({companyId:item.company_id?String(item.company_id):"",outgoingDate:item.outgoing_date||"",incomingNo:item.incoming_no||"",incomingDate:item.incoming_date||"",relatedDepartments:JSON.stringify(item.related_departments||[]),informedDepartments:JSON.stringify(item.informed_departments||[]),documentType:item.document_type||"",sendingMethod:item.sending_method||"",deliveredBy:item.delivered_by||"",responsibleEmployeeId:item.responsible_employee_id?String(item.responsible_employee_id):"",returnDue:item.return_due_date||"",copies:item.copies||"",documentDate:item.document_date||"",voen:item.voen||"",organizationName:item.organization_name||"",phone:item.phone||"",note:item.note||"",signedCopyReturns:item.signed_copy_returns===null||item.signed_copy_returns===undefined?"":String(item.signed_copy_returns)})};
  const cancelEdit=()=>{setEditingId(null);setEditForm({})};
  const saveEdit=async(id:number)=>{
    const voenValue=(editForm.voen||"").trim();
    if(voenValue&&!customers.some(c=>c.voen===voenValue)){setError("Bu VÖEN müştəri siyahısında tapılmadı. Zəhmət olmasa düzgün VÖEN daxil edin.");return}
    setEditBusy(true);setError("");setNotice("");
    try{
      const related=effectiveRelated(editForm);
      const payload:Record<string,unknown>={...editForm,id,relatedDepartments:related,informedDepartments:parseList(editForm.informedDepartments),returnDueDate:editForm.returnDue??undefined};
      delete payload.returnDue;
      // A document from before 2.60 whose department was typed by hand keeps it until departments are picked.
      if(!related.length)delete payload.relatedDepartments;
      const response=await fetch("/api/documents/outgoing",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setItems(result.items||[]);setEditingId(null);setEditForm({});
    }catch(e){setError(e instanceof Error?e.message:"Sənəd yenilənmədi.")}
    finally{setEditBusy(false)}
  };
  const remove=async(item:OutgoingDocument)=>{
    if(!window.confirm(`"${item.outgoing_no}" nömrəli sənədi silmək istəyirsiniz? Serverdəki papkalarda olan fayllar silinmir.`))return;
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
  // Versiya 2.76: the document types are the Çıxan sənəd templates of the document's own firm.
  const firmTemplates=(companyId:number)=>templates.filter(t=>Number(t.company_id)===companyId);
  const allowedTemplates=(companyId:number)=>{const allowed=registerIn.find(r=>r.companyId===companyId)?.types;return firmTemplates(companyId).filter(t=>!allowed||allowed.includes(t.name))};
  // Versiya 2.77: a type whose template names its "Aidiyyatı şöbələr" brings them; otherwise the registrar picks.
  const templateDepts=(values:Record<string,string>)=>parseList(templateFor(values)?.departments||"[]");
  const effectiveRelated=(values:Record<string,string>)=>{const fixed=templateDepts(values);return fixed.length?fixed:parseList(values.relatedDepartments)};
  const templateFor=(values:Record<string,string>)=>{const typeName=(values.documentType||"").trim().toLocaleLowerCase("az-AZ");return typeName?firmTemplates(companyOf(values)).find(t=>t.name.trim().toLocaleLowerCase("az-AZ")===typeName):undefined};
  const companyName=(id:number)=>companies.find(c=>c.id===id)?.name||"—";
  // Fields the system fills itself — the numbers at creation, Daxil olma No / tarixi when the signed document is uploaded — are left out of the new-document form.
  const autoFilled=new Set(["incomingNo","incomingDate","documentNumber","outgoingNo","draft","final","returnDue"]);
  const fieldRenderers:Record<string,(values:Record<string,string>,set:(next:Record<string,string>)=>void)=>React.ReactNode>={
    company:(values,set)=>{const chosen=companyOf(values);const isNew=values!==editForm;const firms=isNew?createFirms:companies;return (isAdmin||isNew)&&firms.length>1&&!activeCompanyId
      ?<label className="field" key="company">Firma<select value={chosen||""} onChange={e=>set({...values,companyId:e.target.value,relatedDepartments:"[]"})}><option value="">Seçin</option>{firms.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      :<label className="field" key="company">Firma<Input value={chosen?companyName(chosen):""} readOnly/></label>},
    outgoingDate:(values,set)=><Field key="outgoingDate" label="Çıxış tarixi" type="date" value={values.outgoingDate||""} set={v=>set({...values,outgoingDate:v})}/>,
    incomingNo:(values,set)=><Field key="incomingNo" label="Daxil olma No" value={values.incomingNo||""} set={v=>set({...values,incomingNo:v})}/>,
    incomingDate:(values,set)=><Field key="incomingDate" label="Daxil olma tarixi" type="date" value={values.incomingDate||""} set={v=>set({...values,incomingDate:v})}/>,
    // Related departments: the first one is the main department — the {Şöbə} of the folder and file-name rules.
    sendingDepartment:(values,set)=>{const fixed=templateDepts(values);if(fixed.length)return <div className="field incomingdepartments outgoingrelated" key="sendingDepartment"><span>Əlaqəli şöbə(lər) <small>sənədin tipinə görə — şablondan</small></span><div>{fixed.map((d,n)=><label key={d}><b>{d}</b>{n===0&&<em className="incomingrelatedtag">əsas</em>}</label>)}</div></div>;const chosen=companyOf(values);const options=chosen?departments[chosen]||[]:[];const picked=parseList(values.relatedDepartments);const put=(list:string[])=>set({...values,relatedDepartments:JSON.stringify(list)});return <div className="field incomingdepartments outgoingrelated" key="sendingDepartment"><span>Əlaqəli şöbə(lər) * <small>birinci seçilən — əsas şöbə (papka və fayl adındakı {"{Şöbə}"})</small></span><div>{!chosen?<small>Əvvəlcə firmanı seçin.</small>:options.length?options.map(o=>{const at=picked.indexOf(o);return <label key={o}><input type="checkbox" checked={at>=0} onChange={e=>put(e.target.checked?[...picked,o]:picked.filter(d=>d!==o))}/><b>{o}</b>{at===0&&<em className="incomingrelatedtag">əsas</em>}{at>0&&<button type="button" className="hrlink hrlinkok" onClick={ev=>{ev.preventDefault();put([o,...picked.filter(d=>d!==o)])}}>əsas et</button>}</label>}):<small>Firmanın strukturunda şöbə yoxdur (Firmalar → Struktur).</small>}</div></div>},
    documentType:(values,set)=>{const chosen=companyOf(values);const list=chosen?allowedTemplates(chosen):[];return <label className="field" key="documentType">Sənədin tipi<Input list={`documentTypeOptions-${chosen}`} value={values.documentType||""} onChange={e=>set({...values,documentType:e.target.value})}/><datalist id={`documentTypeOptions-${chosen}`}>{list.map(t=><option key={t.id} value={t.name}/>)}</datalist>{!chosen?<small>Əvvəlcə firmanı seçin.</small>:!list.length&&<small>Bu firmanın “Çıxan sənəd” şablonu yoxdur (Sənədlər → Şablonlar).</small>}</label>},
    sendingMethod:(values,set)=><label className="field" key="sendingMethod">Göndərilmə Şəkli<select value={values.sendingMethod||""} onChange={e=>set({...values,sendingMethod:e.target.value})}><option value="">Seçin</option>{sendingMethodOptions.map(o=><option key={o} value={o}>{o}</option>)}</select></label>,
    // Versiya 2.75: the person who takes the document out answers for the signed copy coming back — picked from the people
    // of the document's departments. An older document keeps its typed name until someone is picked.
    informedDepartments:(values,set)=>{const chosen=companyOf(values);const related=effectiveRelated(values);const options=(chosen?departments[chosen]||[]:[]).filter(d=>!related.includes(d));const picked=parseList(values.informedDepartments).filter(d=>!related.includes(d));return <div className="field incomingdepartments" key="informedDepartments"><span>Məlumatlandırılan şöbə(lər) <small>istəyə bağlı — sənədi yalnız şöbə rəhbəri görür</small></span><div>{!chosen?<small>Əvvəlcə firmanı seçin.</small>:options.length?options.map(o=><label key={o}><input type="checkbox" checked={picked.includes(o)} onChange={e=>set({...values,informedDepartments:JSON.stringify(e.target.checked?[...picked,o]:picked.filter(d=>d!==o))})}/><b>{o}</b></label>):<small>Başqa şöbə yoxdur.</small>}</div></div>},
    deliveredBy:(values,set)=>{const chosen=companyOf(values);const picked=effectiveRelated(values);const people=(chosen?members[chosen]||[]:[]).filter(m=>!picked.length||picked.includes(m.department));const unique=people.filter((m,i)=>people.findIndex(x=>x.id===m.id)===i);const current=values.responsibleEmployeeId||"";
      return <label className="field" key="deliveredBy">Sənədi götürən şəxs (məsul)<select value={current} onChange={e=>{const person=unique.find(m=>String(m.id)===e.target.value);set({...values,responsibleEmployeeId:e.target.value,deliveredBy:person?person.name:""})}}><option value="">{!current&&values.deliveredBy?`${values.deliveredBy} (köhnə qeyd)`:"Seçin"}</option>{unique.map(m=><option key={m.id} value={m.id}>{m.name} — {m.department}</option>)}</select>{!picked.length&&<small>Əvvəlcə əlaqəli şöbəni seçin.</small>}</label>},
    returnDue:(values,set)=><label className="field" key="returnDue">İmzalı nüsxənin qaytarılma tarixi<Input type="date" value={values.returnDue||""} onChange={e=>set({...values,returnDue:e.target.value})}/><small>Şablondakı müddətlə avtomatik yazılır; lazım olsa dəyişin.</small></label>,
    copies:(values,set)=><label className="field" key="copies">Sənədin nüsxəsi<select value={values.copies||""} onChange={e=>set({...values,copies:e.target.value})}><option value="">Seçin</option>{copiesOptions.map(o=><option key={o} value={o}>{o}</option>)}</select></label>,
    documentDate:(values,set)=><Field key="documentDate" label="Sənədin tarixi" type="date" value={values.documentDate||""} set={v=>set({...values,documentDate:v})}/>,
    voen:(values,set)=><label className="field" key="voen">Voeni<Input value={values.voen||""} onChange={e=>set({...values,voen:e.target.value})} onBlur={e=>{const trimmed=e.target.value.trim();const match=customers.find(c=>c.voen===trimmed);set({...values,voen:trimmed,organizationName:match?match.name:"",phone:match?match.phone||"":values.phone||""})}}/></label>,
    organizationName:(values)=><label className="field" key="organizationName">Təşkilatın adı<Input value={values.organizationName||""} readOnly placeholder="Əvvəlcə VÖEN daxil edin"/></label>,
    // Versiya 2.77: the phone is the customer card's; it is typed only for a document without a VÖEN (no card).
    phone:(values,set)=>{const card=customers.find(c=>c.voen===(values.voen||"").trim()&&(values.voen||"").trim());return card?<label className="field" key="phone">Müştərinin Telefonu<Input value={formatPhone(card.phone)||""} readOnly placeholder="Müştəri kartında telefon yoxdur"/><small>Müştəri kartından</small></label>:<Field key="phone" label="Müştərinin Telefonu" value={values.phone||""} set={v=>set({...values,phone:v})}/>},
    note:(values,set)=><Field key="note" label="Əlavə Qeydlər" value={values.note||""} set={v=>set({...values,note:v})}/>,
  };
  const fields=(values:Record<string,string>,set:(next:Record<string,string>)=>void,isNew:boolean)=><>{order.filter(key=>fieldRenderers[key]&&!(isNew&&autoFilled.has(key))).map(key=>fieldRenderers[key](values,set))}</>;
  // "İmzalı nüsxə geri qaytarılır" comes from the document type's template; one document may differ ("" = follow the template).
  const templateReturns=(values:Record<string,string>)=>{const type=(values.documentType||"").trim();if(!type)return true;const t=templateFor(values);return !t||t.signed_copy_returns!==0};
  const returnsSignedCopy=(values:Record<string,string>)=>values.signedCopyReturns==="1"||values.signedCopyReturns==="0"?values.signedCopyReturns==="1":templateReturns(values);
  const signedReturnBlock=(values:Record<string,string>,set:(next:Record<string,string>)=>void)=>{
    const returns=returnsSignedCopy(values);
    const own=values.signedCopyReturns==="1"||values.signedCopyReturns==="0";
    return <div className="signedreturnfield"><label><input type="checkbox" checked={returns} onChange={e=>{const next=e.target.checked;set({...values,signedCopyReturns:next===templateReturns(values)?"":next?"1":"0"})}}/>İmzalı nüsxə geri qaytarılır</label>
      <small>{own?`Bu sənəd üçün ayrıca seçilib (şablona görə: ${templateReturns(values)?"Bəli":"Xeyr"}).`:templateFor(values)?"Şablona görə.":"Şablon yoxdur — standart olaraq imzalı nüsxə gözlənilir."}</small>
      {returns&&values.copies==="1"&&<small className="signedreturnwarn">⚠ Sənəd 1 nüsxədə göndərilir — imzalı nüsxənin geri qaytarılması gözlənilirsə, nüsxə sayını yoxlayın.</small>}
    </div>;
  };
  const templateBlock=(values:Record<string,string>)=>{
    const matched=templateFor(values);
    const templateSlots=matched?[{n:1,key:matched.template1_key,name:matched.template1_name},{n:2,key:matched.template2_key,name:matched.template2_name},{n:3,key:matched.template3_key,name:matched.template3_name}]:[];
    return matched&&<div className="templateusepanel"><b>Şablondan istifadə et</b><p>Şablonu yükləyib doldurun, sonra yazdığınız sənədi yükləyin — sistem onu “{matched.file_name_pattern||DEFAULT_FILE_NAME_PATTERN}” qaydası ilə adlandırıb papkaya yazacaq.</p><div className="templateuseslots">{templateSlots.map(t=><div className="templateuseslot" key={t.n}><span className="templatelabel">Sənədin şablonu<br/>{t.n}</span>{t.key?<a className="filelink" href={`/api/file?key=${encodeURIComponent(t.key)}`} target="_blank" rel="noreferrer">{t.name}</a>:<span className="nodocument">Yoxdur</span>}</div>)}</div></div>;
  };
  const uploadButton=(item:OutgoingDocument,kind:"draft"|"final",label:string)=>{const mine=uploading===`${item.id}:${kind}`;return <label className={`docuploadbtn${uploading?" disabled":""}`}>{mine?"Yüklənir...":label}<input type="file" hidden disabled={Boolean(uploading)} onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)void uploadStage(item,kind,f)}}/></label>};
  const stageFile=(item:OutgoingDocument,kind:"draft"|"final")=>{
    const name=kind==="draft"?item.draft_name:item.final_name;
    if(!name)return null;
    const size=kind==="draft"?item.draft_size:item.final_size;
    const folder=kind==="draft"?item.draft_path:item.final_path;
    const missing=kind==="draft"?item.draft_missing:item.final_missing;
    return <><a className="filelink" href={`/api/documents/outgoing/file?id=${item.id}&kind=${kind}`} target="_blank" rel="noreferrer" title={folder||"Sistemdə saxlanılıb"}>{name}<small>{formatFileSize(size||0)}</small></a>{folder&&<span className="folderpath docfolder" title={folder}>{folder}</span>}{missing&&<span className="docmissing">Fayl papkada tapılmadı</span>}</>;
  };
  const outgoingColumns:Array<{key:string;label:string;width:number;search:(item:OutgoingDocument)=>string;render:(item:OutgoingDocument)=>React.ReactNode}>=[
    {key:"outgoingNo",label:"Çıxış No",width:110,search:item=>item.outgoing_no,render:item=><b>{item.outgoing_no}</b>},
    {key:"company",label:"Firma",width:150,search:item=>item.company_name||"Firma seçilməyib",render:item=>item.company_name||<span className="nodocument">Firma seçilməyib</span>},
    {key:"outgoingDate",label:"Çıxış tarixi",width:110,search:item=>formatDateOnly(item.outgoing_date),render:item=><>{formatDateOnly(item.outgoing_date)}</>},
    {key:"incomingNo",label:"Daxil olma No",width:130,search:item=>item.incoming_no||"",render:item=><>{item.incoming_no||"—"}</>},
    {key:"incomingDate",label:"Daxil olma tarixi",width:130,search:item=>formatDateOnly(item.incoming_date),render:item=><>{formatDateOnly(item.incoming_date)}</>},
    {key:"sendingDepartment",label:"Əlaqəli şöbələr",width:170,search:item=>(item.related_departments||[]).join(", "),render:item=>(item.related_departments||[]).length?<>{(item.related_departments||[]).map((d,n)=><div key={d} className="incomingdept"><b>{d}</b>{n===0&&(item.related_departments||[]).length>1&&<small className="requestsub">əsas şöbə</small>}</div>)}</>:<span className="nodocument">—</span>},
    {key:"informedDepartments",label:"Məlumatlandırılan şöbələr",width:160,search:item=>(item.informed_departments||[]).join(", "),render:item=>(item.informed_departments||[]).length?<>{(item.informed_departments||[]).map(d=><div key={d} className="incomingdept">{d}</div>)}</>:<span className="nodocument">—</span>},
    {key:"documentType",label:"Sənədin tipi",width:130,search:item=>item.document_type||"",render:item=><>{item.document_type||"—"}</>},
    {key:"sendingMethod",label:"Göndərilmə Şəkli",width:140,search:item=>item.sending_method||"",render:item=><>{item.sending_method||"—"}</>},
    {key:"deliveredBy",label:"Sənədi götürən şəxs (məsul)",width:170,search:item=>item.responsible_name||item.delivered_by||"",render:item=><>{item.responsible_name||item.delivered_by||"—"}</>},
    {key:"copies",label:"Sənədin nüsxəsi",width:110,search:item=>item.copies||"",render:item=><>{item.copies||"—"}</>},
    {key:"documentNumber",label:"Sənədin Nömrəsi",width:130,search:item=>item.document_number||"",render:item=><>{item.document_number||"—"}</>},
    {key:"documentDate",label:"Sənədin tarixi",width:110,search:item=>formatDateOnly(item.document_date),render:item=><>{formatDateOnly(item.document_date)}</>},
    {key:"voen",label:"Voeni",width:100,search:item=>item.voen||"",render:item=><>{item.voen||"—"}</>},
    {key:"organizationName",label:"Təşkilatın adı",width:170,search:item=>item.organization_name||"",render:item=><>{item.organization_name||"—"}</>},
    {key:"phone",label:"Müştərinin Telefonu",width:140,search:item=>formatPhone(item.phone),render:item=><>{formatPhone(item.phone)||"—"}</>},
    {key:"note",label:"Əlavə Qeydlər",width:180,search:item=>item.note||"",render:item=><>{item.note||"—"}</>},
    {key:"draft",label:"İlkin sənəd (Word)",width:210,search:item=>item.draft_name||item.attachment_name||"Yoxdur",render:item=><div className="docstage">
      {stageFile(item,"draft")||(item.attachment_key?<a className="filelink" href={`/api/file?key=${encodeURIComponent(item.attachment_key)}`} target="_blank" rel="noreferrer" title="Köhnə qaydada əlavə olunub">{item.attachment_name||"Fayl"}<small>{formatFileSize(item.attachment_size||0)}</small></a>:<span className="nodocument">Yüklənməyib</span>)}
      {item.can?.upload&&uploadButton(item,"draft",item.draft_name?"Yenisini yüklə":"Sənədi sistemə yüklə")}
    </div>},
    // A document whose signed copy comes back waits for it ("İmza gözləyir"); any other just keeps a copy of what was sent.
    {key:"final",label:"Hazır sənəd (imzalı / sürəti)",width:210,search:item=>item.final_name||(item.returns_signed_copy===0?"Sürəti yüklənməyib":"İmza gözləyir"),render:item=><div className="docstage">
      {stageFile(item,"final")||(item.returns_signed_copy===0?<span className="nodocument">Sürəti yüklənməyib</span>:<span className="tablestatus review">İmza gözləyir</span>)}
      {item.can?.uploadFinal&&uploadButton(item,"final",item.final_name?"Yenisini yüklə":item.returns_signed_copy===0?"Sürətini yüklə":"İmzalı sənədi yüklə")}
    </div>},
    {key:"returnDue",label:"Qaytarılma müddəti",width:150,search:item=>{const r=outgoingReturnState(item);return !r?"—":r.kind==="done"?"Qaytarılıb":r.kind==="overdue"?"Yubanır":"Gözləyir"},render:item=>{const r=outgoingReturnState(item);if(!r)return <>—</>;
      return <div className="returncell">{r.kind==="done"?<span className="returnchip done">✓ Qaytarılıb</span>:r.kind==="overdue"?<span className="returnchip late">Yubanır — {-r.days} gün</span>:<span className="returnchip wait">{r.days===0?"Bu gün son gündür":`${r.days} gün qalıb`}</span>}<small>{formatDateOnly(item.return_due_date??null)}</small></div>}},
    {key:"approval",label:"Təsdiq",width:170,search:item=>item.approval?.required?(item.approval.final?"Təsdiqləndi":item.approval.returned?"Geri qaytarılıb":item.approval.label):"Tələb olunmur",render:item=><ApprovalCell approval={item.approval}/>},
  ];
  const {order,widths,setWidth,moveColumn}=useTableColumns("outgoing2",outgoingColumns.map(c=>c.key));
  const resize=useEdgeResize(setWidth,60);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(outgoingColumns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(outgoingColumns.map(c=>[c.key,c.width]));
  const scopedItems=items.filter(item=>!activeCompanyId||item.company_id===activeCompanyId);
  const waitingApproval=scopedItems.filter(i=>approvalActionable(i.approval));
  const overdueAll=scopedItems.filter(i=>outgoingReturnState(i)?.kind==="overdue");
  const overdueItems=overdueAll.filter(i=>(!overdueDept||outgoingMainDepartment(i)===overdueDept)&&(!overdueUser||outgoingResponsible(i)===overdueUser)).sort((a,b)=>String(a.return_due_date).localeCompare(String(b.return_due_date)));
  const excel=useExcelFilters("outgoing",outgoingColumns,onlyApproval?waitingApproval:onlyOverdue?overdueItems:scopedItems);
  const act=async(item:OutgoingDocument,payload:Record<string,unknown>,message:string)=>{
    setBusy(true);setError("");setNotice("");
    try{const response=await fetch("/api/documents/outgoing",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({...payload,id:item.id})});const result=await response.json();if(!response.ok)throw new Error(result.error);setItems(result.items||[]);setNotice(`Sənəd №${item.outgoing_no}: ${message}`)}
    catch(e){setError(e instanceof Error?e.message:"Təsdiq qeyd olunmadı.")}finally{setBusy(false)}
  };
  const filteredOutgoing=excel.rows;
  const canCreate=canRegister&&createFirms.length>0;
  const showActions=filteredOutgoing.some(item=>item.can?.edit||item.can?.remove||approvalActionable(item.approval));
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>Çıxan sənədlər</h2><p>{!canRegister?"Rəhbəri olduğunuz şöbələrə aid və məsul olduğunuz çıxan sənədlər":activeCompanyId?`${companyName(activeCompanyId)} — göndərilən sənədlərin qeydiyyatı`:"Təşkilatdan göndərilən sənədlərin qeydiyyatı"}</p></div>{canCreate&&<Button onClick={()=>setCreating(v=>!v)}><Plus/>Yeni sənəd</Button>}</div>
    {creating&&<div className="inlinetaskrow documentrow outgoingrow">{fields({relatedDepartments:"[]",...form},setForm,true)}{signedReturnBlock(form,setForm)}{templateBlock(form)}<label className="field filefield">Yazılmış sənəd (istəyə bağlı — sonra cədvəldən də yükləmək olar)<Input type="file" onChange={e=>setNewFile(e.target.files?.[0]||null)}/>{newFile&&<small>{newFile.name} • {formatFileSize(newFile.size)}</small>}</label><div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>{setCreating(false);setForm({});setNewFile(null)}}>Ləğv et</button><Button disabled={busy} onClick={()=>void create()}>{busy?"Yaradılır...":"Əlavə et"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {notice&&<div className="docnotice">{notice}</div>}
    {(waitingApproval.length>0||onlyApproval||overdueAll.length>0||onlyOverdue)&&<div className="fixedsubtabs"><button className={!onlyApproval&&!onlyOverdue?"on":""} onClick={()=>{setOnlyApproval(false);setOnlyOverdue(false)}}>Bütün sənədlər ({scopedItems.length})</button>{(waitingApproval.length>0||onlyApproval)&&<button className={onlyApproval?"on":""} onClick={()=>{setOnlyApproval(true);setOnlyOverdue(false)}}>Təsdiqimi gözləyir ({waitingApproval.length}){waitingApproval.length>0&&<em className="requestbadge">{waitingApproval.length}</em>}</button>}{(overdueAll.length>0||onlyOverdue)&&<button className={onlyOverdue?"on":""} onClick={()=>{setOnlyOverdue(true);setOnlyApproval(false)}}>Yubananlar ({overdueAll.length}){overdueAll.length>0&&<em className="requestbadge">{overdueAll.length}</em>}</button>}</div>}
    {onlyOverdue&&(overdueDept||overdueUser)&&<div className="overduefilters">{overdueDept&&<button className="statusfilterchip" onClick={()=>setOverdueDept("")} title="Süzgəci sil">Şöbə: {overdueDept} <X/></button>}{overdueUser&&<button className="statusfilterchip" onClick={()=>setOverdueUser("")} title="Süzgəci sil">Məsul: {overdueUser} <X/></button>}</div>}
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable documenttable compacttable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} extraKeys={showActions?["actions"]:[]}/><thead><tr>{order.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}>{excel.header(col)}</SortableTh>})}{showActions&&<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader/></th>}</tr></thead><tbody>{filteredOutgoing.map(item=>editingId===item.id?<tr key={item.id}><td colSpan={order.length+(showActions?1:0)}><div className="inlinetaskrow documentrow outgoingrow documenteditrow">{fields(editForm,setEditForm,false)}{signedReturnBlock(editForm,setEditForm)}{templateBlock(editForm)}<div className="inlineactions"><button className="inlinecancel" disabled={editBusy} onClick={cancelEdit}>Ləğv et</button><Button disabled={editBusy} onClick={()=>void saveEdit(item.id)}>{editBusy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div></td></tr>:<tr key={item.id}>
      {order.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      {showActions&&<td data-label="Əməliyyat"><div className="tableactions"><ApprovalButtons approval={item.approval} busy={busy} onAct={(payload,message)=>void act(item,payload,message)}/>{item.can?.edit&&<button className="editcompanybtn" onClick={()=>startEdit(item)}>Redaktə et</button>}{item.can?.remove&&<button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button>}</div></td>}
    </tr>)}</tbody></table>{!filteredOutgoing.length&&<Empty text={scopedItems.length?"Axtarışa uyğun sənəd tapılmadı.":canRegister?"Hələ çıxan sənəd qeydə alınmayıb.":"Şöbənizə aid çıxan sənəd yoxdur."}/>}</div>}
  </section>;
}
type IncomingDocument = { informed_departments?:string[]; sender_phone?:string|null; approval?:DocumentApproval; id:number; company_id:number; company_name:string|null; incoming_no:string; incoming_date:string|null; sender_voen:string|null; sender_name:string|null; sender_doc_no:string|null; sender_doc_date:string|null; document_type:string|null; receive_method:string|null; summary:string|null; pages?:string|null; copies?:string|null; note?:string|null; file_name:string|null; file_size:number|null; file_path:string|null; file_missing:boolean; status:string; info_only?:number; director_pending?:number; sent_to_director_by?:string|null; resolution?:string|null; due_date?:string|null; assigned_by_name?:string|null; created_by_name?:string|null; director_seen_at?:string|null; director_seen_by?:string|null; flow?:number|null; locked:boolean; related_departments:string[]; assignments:Array<{department:string;head_name:string|null;task_status:string|null}>; requests:Array<{id:number;from_department:string|null;to_department:string;status:string}>; can:{edit:boolean;remove:boolean;upload:boolean;direct:boolean;review:boolean;request:boolean} };
type IncomingDepartment = { company_id:number; name:string; heads:Array<{id:number;name:string}>; members:Array<{id:number;name:string;position_title:string}> };
const INCOMING_TYPES=["Məktub","Müqavilə","Akt","Hesab-faktura","Qaimə","Məhkəmə sənədi","Sorğu","Bildiriş","Digər"];
const RECEIVE_METHODS=["Kağız-Əldən","Poçt","E-poçt","Adoc-Vergidən"];
const CUSTOMER_TYPES=["Hüquqi şəxs","Fərdi sahibkar","Fiziki şəxs"];
const incomingStatusTone=(s:string)=>s==="İcra olundu"?"done":s.startsWith("İcradadır")?"inprogress":s==="Məlumat üçün"||s==="Rəhbər tanış olub"?"returned":s==="Rəhbərdə"||s==="Rəhbərin baxışında"?"awaiting":"";
const waitsForDirector=(i:IncomingDocument)=>i.status==="Rəhbərin baxışında"||i.status==="Rəhbərdə";
// Two-level approval (Versiya 2.61): each related department's head approves, then the director gives the final approval
// (or sends the document back with a note). The state comes from the server with what this user may do.
type DocumentApproval={required:boolean;ready:boolean;label:string;locked:boolean;departments:Array<{name:string;approved:{by:string;at:string}|null;openTasks:boolean;canApprove:boolean}>;final:{by:string;at:string;note:string|null}|null;returned:{by:string;at:string;note:string|null}|null;canFinal:boolean;canReturn:boolean};
const approvalActionable=(a:DocumentApproval|undefined)=>Boolean(a&&(a.canFinal||a.departments.some(d=>d.canApprove)));
function ApprovalCell({approval}:{approval?:DocumentApproval}){
  if(!approval||!approval.required)return <span className="nodocument">Tələb olunmur</span>;
  const tone=approval.final?"done":approval.returned?"late":approval.label==="Rəhbərin təsdiqini gözləyir"?"awaiting":"inprogress";
  return <div className="approvalcell"><span className={`tablestatus ${tone}`}>{approval.final?"Təsdiqləndi ✓":approval.returned?"Geri qaytarılıb":approval.label}</span>
    {approval.final&&<small className="requestsub">{approval.final.by} · {formatDate(approval.final.at)}</small>}
    {approval.returned&&<small className="approvalreturn">Rəhbər: {approval.returned.note}</small>}
    {approval.ready&&!approval.final&&approval.departments.map(d=><small key={d.name} className={`approvaldept${d.approved?" ok":""}`} title={d.approved?`${d.approved.by}, ${formatDate(d.approved.at)}`:d.openTasks?"Şöbədə bu sənəd üzrə tapşırıq hələ bağlanmayıb":"Təsdiq gözlənilir"}>{d.approved?"✓":d.openTasks?"⏳":"○"} {d.name}</small>)}
  </div>;
}
function ApprovalButtons({approval,busy,onAct}:{approval?:DocumentApproval;busy:boolean;onAct:(payload:Record<string,unknown>,message:string)=>void}){
  if(!approval)return null;
  const approveDept=(name:string)=>{const note=window.prompt(`“${name}” şöbəsi adından təsdiqləyirsiniz: sənəd üzrə iş şöbədə bitib.\n\nQeyd (istəyə bağlı):`,"");if(note!==null)onAct({action:"approve",level:"department",department:name,note},`“${name}” şöbəsi təsdiqlədi.`)};
  const finalApprove=()=>{const waiting=approval.departments.filter(d=>!d.approved).map(d=>d.name);const note=window.prompt(`Son təsdiq: sənəd bağlanacaq.${waiting.length?`\n\nDiqqət: bu şöbələr hələ təsdiqləməyib — ${waiting.join(", ")}.`:""}\n\nQeyd (istəyə bağlı):`,"");if(note!==null)onAct({action:"approve",level:"director",note},"Sənəd rəhbər tərəfindən təsdiqləndi və bağlandı.")};
  const giveBack=()=>{const note=window.prompt("Sənəd şöbələrə geri qaytarılır — şöbələr yenidən təsdiqləməli olacaq.\n\nSəbəbi (məcburi):","");if(note!==null&&note.trim())onAct({action:"return",level:"director",note},"Sənəd qeydlə şöbələrə geri qaytarıldı.")};
  return <>
    {approval.departments.filter(d=>d.canApprove).map(d=><button key={d.name} className="evaluatebtn" disabled={busy} onClick={()=>approveDept(d.name)}>Təsdiq et{approval.departments.length>1?` — ${d.name}`:""}</button>)}
    {approval.canFinal&&<button className="evaluatebtn approvalfinal" disabled={busy} onClick={finalApprove}>Son təsdiq</button>}
    {approval.canReturn&&<button className="deletetaskbtn" disabled={busy} onClick={giveBack}>Geri qaytar</button>}
  </>;
}
const parseList=(raw:string|undefined)=>{try{const v=JSON.parse(raw||"[]");return Array.isArray(v)?v.map(String):[]}catch{return []}};
// Daxil olan sənədlər (Versiya 2.59): Ümumi şöbə registers and tags the related departments; the firm's director looks at every
// document and gives tasks by dərkənar; related departments see their documents and may raise requests from them.
function IncomingDocumentsPage({isAdmin,companies,activeCompanyId,onPending}:{isAdmin:boolean;companies:Company[];activeCompanyId:number|null;onPending:(n:number)=>void}){
  const [items,setItems]=useState<IncomingDocument[]>([]);
  const [departments,setDepartments]=useState<IncomingDepartment[]>([]);
  const [directorOf,setDirectorOf]=useState<number[]>([]);
  const [canRegister,setCanRegister]=useState(false);
  const [registerIn,setRegisterIn]=useState<RegisterTarget[]>([]);
  const [types,setTypes]=useState<Array<{company_id:number;name:string;departments?:string|null;incoming_folder_path:string|null;incoming_name_pattern:string|null}>>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [view,setView]=useState<"all"|"director"|"approve">("all");
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState<Record<string,string>>({});
  const [newFile,setNewFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [editingId,setEditingId]=useState<number|null>(null);
  const [editForm,setEditForm]=useState<Record<string,string>>({});
  const [acting,setActing]=useState<{id:number;mode:"direct"|"request"}|null>(null);
  const [directForm,setDirectForm]=useState<{departments:string[];employees:number[];dueDate:string;resolution:string}>({departments:[],employees:[],dueDate:"",resolution:""});
  const [requestForm,setRequestForm]=useState<{toDepartment:string;title:string;description:string;dueDate:string}>({toDepartment:"",title:"",description:"",dueDate:""});
  const [uploading,setUploading]=useState<number|null>(null);
  // Sender lookup by VÖEN: "found" fills the name from the customer list, "missing" opens the new-customer card.
  const [voenState,setVoenState]=useState<Record<string,"found"|"missing"|"">>({});
  const [customerForm,setCustomerForm]=useState<Record<string,string>>({});
  const apply=(body:{items?:IncomingDocument[];departments?:IncomingDepartment[];directorOf?:number[];canRegister?:boolean;registerIn?:RegisterTarget[];types?:Array<{company_id:number;name:string;departments?:string|null;incoming_folder_path:string|null;incoming_name_pattern:string|null}>})=>{
    const list=body.items||[];setItems(list);setDepartments(body.departments||[]);setDirectorOf(body.directorOf||[]);setCanRegister(Boolean(body.canRegister));setRegisterIn(body.registerIn||[]);
    onPending(list.filter(i=>waitsForDirector(i)&&(body.directorOf||[]).includes(i.company_id)).length);
    if(body.types)setTypes(body.types);
  };
  const load=async()=>{setLoading(true);setError("");try{const response=await fetch("/api/documents/incoming");const body=await response.json();if(!response.ok)throw new Error(body.error);apply(body)}catch(e){setError(e instanceof Error?e.message:"Siyahı açıla bilmədi.")}finally{setLoading(false)}};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void load()},[]);
  const send=async(method:"POST"|"PATCH"|"DELETE",payload?:Record<string,unknown>,query=""):Promise<Record<string,unknown>>=>{
    const response=await fetch(`/api/documents/incoming${query}`,{method,headers:payload?{"content-type":"application/json"}:undefined,body:payload?JSON.stringify(payload):undefined});
    const body=await response.json();
    if(!response.ok)throw new Error(body.error||"Əməliyyat baş tutmadı.");
    if(body.items)apply(body);
    return body;
  };
  // The firms passed in are the ones this user works for (all firms for the admin).
  // Versiya 2.99: only the firms where this user may register, and there only the allowed types.
  const registerFirms=companies.filter(c=>registerIn.some(r=>r.companyId===c.id));
  const allowedTypes=(companyId:number)=>registerIn.find(r=>r.companyId===companyId)?.types??null;
  const companyOf=(values:Record<string,string>)=>Number(values.companyId||activeCompanyId||(registerFirms.length===1?registerFirms[0].id:0))||0;
  const companyName=(id:number)=>companies.find(c=>c.id===id)?.name||items.find(i=>i.company_id===id)?.company_name||"—";
  const firmDepartments=(companyId:number)=>departments.filter(d=>d.company_id===companyId);
  const lookupVoen=async(key:string,values:Record<string,string>,set:(next:Record<string,string>)=>void)=>{
    const voen=(values.senderVoen||"").trim();
    if(!voen){setVoenState(s=>({...s,[key]:""}));return}
    try{
      const response=await fetch(`/api/documents/incoming?voen=${encodeURIComponent(voen)}`);
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      if(body.customer){set({...values,senderVoen:voen,senderName:body.customer.name,senderPhone:body.customer.phone||""});setVoenState(s=>({...s,[key]:"found"}))}
      else{set({...values,senderVoen:voen,senderName:"",senderPhone:""});setVoenState(s=>({...s,[key]:"missing"}));setCustomerForm({entityType:"Hüquqi şəxs",name:"",legalAddress:"",manager:"",phone:""})}
    }catch(e){setError(e instanceof Error?e.message:"VÖEN yoxlanılmadı.")}
  };
  const createCustomer=async(key:string,values:Record<string,string>,set:(next:Record<string,string>)=>void)=>{
    setBusy(true);setError("");
    try{
      const body=await send("POST",{action:"customer",customer:{...customerForm,voen:(values.senderVoen||"").trim()}});
      const customer=body.customer as {name:string}|null;
      if(!customer)throw new Error("Müştəri yaradılmadı.");
      set({...values,senderName:customer.name});setVoenState(s=>({...s,[key]:"found"}));setNotice(`"${customer.name}" müştəri siyahısına əlavə olundu.`);
    }catch(e){setError(e instanceof Error?e.message:"Müştəri yaradılmadı.")}
    finally{setBusy(false)}
  };
  const uploadScan=async(item:{id:number;file_name?:string|null},file:File)=>{
    if(file.size>25*1024*1024){setError("Faylın həcmi 25 MB-dan çox ola bilməz.");return}
    if(item.file_name&&!window.confirm(`"${item.file_name}" faylı yenisi ilə əvəz olunacaq. Davam edilsin?`))return;
    setUploading(item.id);setError("");setNotice("");
    try{
      const upload=new FormData();upload.append("file",file);upload.append("id",String(item.id));
      const response=await fetch("/api/documents/incoming/file",{method:"POST",body:upload});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Fayl yüklənmədi.");
      setNotice(result.note||`Sənəd "${result.name}" adı ilə${result.path?` ${result.path} ünvanında`:""} saxlanıldı.`);
      const list=await fetch("/api/documents/incoming");if(list.ok)apply(await list.json());
    }catch(e){setError(e instanceof Error?e.message:"Fayl yüklənmədi.")}
    finally{setUploading(null)}
  };
  const create=async()=>{
    const companyId=companyOf(form);
    if(!companyId){setError("Firmanı seçin.");return}
    if(voenState.new==="missing"){setError("Bu VÖEN müştəri siyahısında yoxdur — əvvəlcə müştəri kartını yaradın.");return}
    if(!(form.senderName||"").trim()){setError("Göndərən təşkilatı yazın.");return}
    if(!incomingRelated(form,companyId).length){setError("Aidiyyatı şöbəni (və ya şöbələri) seçin.");return}
    setBusy(true);setError("");setNotice("");
    try{
      const body=await send("POST",{...form,companyId,relatedDepartments:incomingRelated(form,companyId),informedDepartments:parseList(form.informedDepartments)});
      setForm({});setCreating(false);setVoenState(s=>({...s,new:""}));
      if(newFile&&body.id)await uploadScan({id:Number(body.id)},newFile);
      setNewFile(null);
      setNotice("Sənəd qeydə alındı və rəhbərin baxışına düşdü; aidiyyatı (və məlumatlandırılan) şöbələrin rəhbərləri onu öz siyahılarında görür.");
    }catch(e){setError(e instanceof Error?e.message:"Sənəd qeydə alınmadı.")}
    finally{setBusy(false)}
  };
  const startEdit=(item:IncomingDocument)=>{setActing(null);setEditingId(item.id);setVoenState(s=>({...s,edit:item.sender_voen?"found":""}));setEditForm({incomingNo:item.incoming_no||"",incomingDate:item.incoming_date||"",senderVoen:item.sender_voen||"",senderName:item.sender_name||"",senderDocNo:item.sender_doc_no||"",senderDocDate:item.sender_doc_date||"",documentType:item.document_type||"",receiveMethod:item.receive_method||"",summary:item.summary||"",pages:item.pages||"",copies:item.copies||"",note:item.note||"",relatedDepartments:JSON.stringify(item.related_departments||[]),informedDepartments:JSON.stringify(item.informed_departments||[]),senderPhone:item.sender_phone||"",companyId:String(item.company_id)})};
  const saveEdit=async(item:IncomingDocument)=>{
    if(voenState.edit==="missing"){setError("Bu VÖEN müştəri siyahısında yoxdur — əvvəlcə müştəri kartını yaradın.");return}
    const related=incomingRelated(editForm,item.company_id);
    if(item.flow===2&&!related.length){setError("Aidiyyatı şöbəni (və ya şöbələri) seçin.");return}
    setBusy(true);setError("");
    try{
      const payload:Record<string,unknown>={...editForm,id:item.id,relatedDepartments:related,informedDepartments:parseList(editForm.informedDepartments)};
      delete payload.companyId;delete payload.senderPhone;
      // Documents registered before 2.59 may have no related departments; they are left as they are unless some are picked.
      if(!related.length&&item.flow!==2)delete payload.relatedDepartments;
      await send("PATCH",payload);setEditingId(null)
    }
    catch(e){setError(e instanceof Error?e.message:"Sənəd yenilənmədi.")}finally{setBusy(false)}
  };
  const remove=async(item:IncomingDocument)=>{if(!window.confirm(`"${item.incoming_no}" nömrəli daxil olan sənədi silmək istəyirsiniz?${item.assignments.length?" Başlanmamış tapşırıqlar da silinəcək.":""} Serverdəki papkada olan fayl silinmir.`))return;setError("");try{await send("DELETE",undefined,`?id=${item.id}`)}catch(e){setError(e instanceof Error?e.message:"Sənəd silinmədi.")}};
  const review=async(item:IncomingDocument)=>{
    const note=window.prompt(`Sənəd №${item.incoming_no} ilə tanış oldunuz. Tapşırıq vermədən bağlanır.\n\nQeyd (istəyə bağlı):`,"");
    if(note===null)return;
    setBusy(true);setError("");setNotice("");
    try{await send("PATCH",{action:"review",id:item.id,note});setNotice(`Sənəd №${item.incoming_no}: rəhbər tanış oldu.`)}catch(e){setError(e instanceof Error?e.message:"Qeyd olunmadı.")}finally{setBusy(false)}
  };
  const startDirect=(item:IncomingDocument)=>{setEditingId(null);setActing({id:item.id,mode:"direct"});setDirectForm({departments:item.assignments.length?[...new Set(item.assignments.map(a=>a.department))]:[],employees:[],dueDate:item.due_date||"",resolution:item.resolution||""})};
  const startRequest=(item:IncomingDocument)=>{setEditingId(null);setActing({id:item.id,mode:"request"});setRequestForm({toDepartment:"",title:`Daxil olan sənəd №${item.incoming_no}: ${item.sender_name||""}`.slice(0,150),description:"",dueDate:""})};
  const saveDirect=async(item:IncomingDocument)=>{
    if((!directForm.departments.length&&!directForm.employees.length)||!directForm.dueDate){setError("Ən azı bir şöbə və ya işçi, həmçinin icra müddətini seçin.");return}
    setBusy(true);setError("");setNotice("");
    try{await send("PATCH",{action:"direct",id:item.id,...directForm});setActing(null);setNotice(`Sənəd №${item.incoming_no} üzrə tapşırıq verildi — seçilənlərin Tapşırıqlarına düşdü.`)}
    catch(e){setError(e instanceof Error?e.message:"Tapşırıq verilmədi.")}finally{setBusy(false)}
  };
  const saveRequest=async(item:IncomingDocument)=>{
    if(!requestForm.toDepartment||!requestForm.title.trim()){setError("Şöbəni və sorğunun mövzusunu yazın.");return}
    setBusy(true);setError("");setNotice("");
    try{await send("POST",{action:"request",id:item.id,...requestForm});setActing(null);setNotice(`“${requestForm.toDepartment}” şöbəsinə sorğu göndərildi — Tapşırıqlar → Sorğular bölməsində izləyə bilərsiniz.`)}
    catch(e){setError(e instanceof Error?e.message:"Sorğu göndərilmədi.")}finally{setBusy(false)}
  };
  const customerCard=(key:string,values:Record<string,string>,set:(next:Record<string,string>)=>void)=>voenState[key]==="missing"&&<div className="templateusepanel incomingcustomer">
    <b>VÖEN {values.senderVoen} müştəri siyahısında yoxdur — müştəri kartını yaradın</b>
    <div className="incomingcustomerfields">
      <label className="field">Statusu<select value={customerForm.entityType||""} onChange={e=>setCustomerForm({...customerForm,entityType:e.target.value})}>{CUSTOMER_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
      <Field label="Adı" value={customerForm.name||""} set={v=>setCustomerForm({...customerForm,name:v})}/>
      <Field label="Hüquqi ünvanı" value={customerForm.legalAddress||""} set={v=>setCustomerForm({...customerForm,legalAddress:v})}/>
      <Field label="Rəhbəri" value={customerForm.manager||""} set={v=>setCustomerForm({...customerForm,manager:v})}/>
      <label className="field" onBlur={()=>setCustomerForm(f=>({...f,phone:formatPhone(f.phone)}))}>Telefonu<Input type="tel" placeholder="+99450 123 45 67" value={customerForm.phone||""} onChange={e=>setCustomerForm({...customerForm,phone:e.target.value})}/></label>
    </div>
    <div className="inlineactions"><Button disabled={busy||!(customerForm.name||"").trim()||!(customerForm.phone||"").trim()} onClick={()=>void createCustomer(key,values,set)}>{busy?"Yaradılır...":"Müştəri siyahısına əlavə et"}</Button></div>
  </div>;
  // Versiya 2.77: a type whose template (Daxil olan sənəd) names its departments brings them; otherwise the registrar picks.
  const incomingTemplateDepts=(values:Record<string,string>,companyId:number)=>{const type=(values.documentType||"").trim().toLocaleLowerCase("az-AZ");const t=type?types.find(x=>x.company_id===companyId&&x.name.trim().toLocaleLowerCase("az-AZ")===type):undefined;return parseList(t?.departments||"[]")};
  const incomingRelated=(values:Record<string,string>,companyId:number)=>{const fixed=incomingTemplateDepts(values,companyId);return fixed.length?fixed:parseList(values.relatedDepartments)};
  const informedPicker=(values:Record<string,string>,set:(next:Record<string,string>)=>void,companyId:number)=>{
    const related=incomingRelated(values,companyId);
    const picked=parseList(values.informedDepartments).filter(d=>!related.includes(d));
    const list=firmDepartments(companyId).filter(d=>!related.includes(d.name));
    return <div className="field incomingdepartments"><span>Məlumatlandırılan şöbə(lər) <small>istəyə bağlı — sənədi yalnız şöbə rəhbəri görür</small></span><div>{!companyId?<small>Əvvəlcə firmanı seçin.</small>:list.length?list.map(d=><label key={d.name}><input type="checkbox" checked={picked.includes(d.name)} onChange={e=>set({...values,informedDepartments:JSON.stringify(e.target.checked?[...picked,d.name]:picked.filter(x=>x!==d.name))})}/><b>{d.name}</b></label>):<small>Başqa şöbə yoxdur.</small>}</div></div>;
  };
  const relatedPicker=(values:Record<string,string>,set:(next:Record<string,string>)=>void,companyId:number)=>{
    const fixed=incomingTemplateDepts(values,companyId);
    if(fixed.length)return <div className="field incomingdepartments incomingrelated"><span>Aidiyyatı şöbə(lər) <small>sənədin tipinə görə — şablondan</small></span><div>{fixed.map(d=><label key={d}><b>{d}</b></label>)}</div></div>;
    const chosen=parseList(values.relatedDepartments);
    const toggle=(name:string,on:boolean)=>set({...values,relatedDepartments:JSON.stringify(on?[...chosen,name]:chosen.filter(d=>d!==name))});
    const list=firmDepartments(companyId);
    return <div className="field incomingdepartments incomingrelated"><span>Aidiyyatı şöbə(lər) *</span><div>{!companyId?<small>Əvvəlcə firmanı seçin.</small>:list.length?list.map(d=><label key={d.name}><input type="checkbox" checked={chosen.includes(d.name)} onChange={e=>toggle(d.name,e.target.checked)}/><b>{d.name}</b></label>):<small>Firmanın strukturunda şöbə yoxdur (Firmalar → Struktur).</small>}</div></div>;
  };
  const formFields=(key:string,values:Record<string,string>,set:(next:Record<string,string>)=>void,isNew:boolean)=>{const chosen=isNew?companyOf(values):Number(values.companyId);const fromList=voenState[key]==="found"&&Boolean((values.senderVoen||"").trim());return <>
    {isNew&&(registerFirms.length>1&&!activeCompanyId
      ?<label className="field">Firma<select value={chosen||""} onChange={e=>set({...values,companyId:e.target.value,relatedDepartments:"[]"})}><option value="">Seçin</option>{registerFirms.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      :<label className="field">Firma<Input value={chosen?companyName(chosen):""} readOnly/></label>)}
    {!isNew&&<label className="field">Daxil olma No<Input value={values.incomingNo||""} readOnly={!isAdmin} title={isAdmin?undefined:"Nömrəni yalnız admin dəyişə bilər"} onChange={e=>set({...values,incomingNo:e.target.value})}/></label>}
    <Field label="Daxil olma tarixi" type="date" value={values.incomingDate||(isNew?todayInput():"")} set={v=>set({...values,incomingDate:v})}/>
    <label className="field">Göndərənin VÖEN-i<Input value={values.senderVoen||""} placeholder="Dövlət qurumu üçün boş qala bilər" onChange={e=>{set({...values,senderVoen:e.target.value});setVoenState(s=>({...s,[key]:""}))}} onBlur={()=>void lookupVoen(key,values,set)}/></label>
    <label className="field">Göndərən təşkilat<Input value={values.senderName||""} readOnly={fromList||voenState[key]==="missing"} placeholder={voenState[key]==="missing"?"Müştəri kartını yaradın":(values.senderVoen||"").trim()?"VÖEN yoxlanılır...":"VÖEN yoxdursa, adı yazın"} onChange={e=>set({...values,senderName:e.target.value})}/></label>
    {fromList&&<label className="field">Göndərənin telefonu<Input value={formatPhone(values.senderPhone)||""} readOnly placeholder="Müştəri kartında telefon yoxdur"/><small>Müştəri kartından</small></label>}
    <Field label="Sənədin nömrəsi (göndərənin)" value={values.senderDocNo||""} set={v=>set({...values,senderDocNo:v})}/>
    <Field label="Sənədin tarixi (göndərənin)" type="date" value={values.senderDocDate||""} set={v=>set({...values,senderDocDate:v})}/>
    <label className="field">Sənədin tipi<Input list={`incomingTypeOptions-${chosen}`} value={values.documentType||""} onChange={e=>set({...values,documentType:e.target.value})}/><datalist id={`incomingTypeOptions-${chosen}`}>{(allowedTypes(chosen)??[...new Set([...types.filter(t=>t.company_id===chosen).map(t=>t.name),...INCOMING_TYPES])]).map(t=><option key={t} value={t}/>)}</datalist>{(()=>{const t=types.find(x=>x.company_id===chosen&&x.name.trim().toLocaleLowerCase("az-AZ")===(values.documentType||"").trim().toLocaleLowerCase("az-AZ"));return (values.documentType||"").trim()?<small className="incomingtypehint">{t?.incoming_folder_path?`Skan “${t.incoming_name_pattern||DEFAULT_INCOMING_NAME}” adı ilə ${t.incoming_folder_path} papkasına yazılacaq`:t?"Şablonda daxil olan sənəd papkası yoxdur — skan sistemdə saxlanılacaq":"Bu tip üçün şablon yoxdur — skan sistemdə saxlanılacaq"}</small>:null})()}</label>
    <label className="field">Daxil olma yolu<select value={values.receiveMethod||""} onChange={e=>set({...values,receiveMethod:e.target.value})}><option value="">Seçin</option>{RECEIVE_METHODS.map(o=><option key={o} value={o}>{o}</option>)}</select></label>
    <Field label="Qısa məzmun" value={values.summary||""} set={v=>set({...values,summary:v})}/>
    <Field label="Vərəq sayı" value={values.pages||""} set={v=>set({...values,pages:v})}/>
    <label className="field">Nüsxə<select value={values.copies||""} onChange={e=>set({...values,copies:e.target.value})}><option value="">Seçin</option>{["1","2","3","4","5"].map(o=><option key={o} value={o}>{o}</option>)}</select></label>
    <Field label="Əlavə qeydlər" value={values.note||""} set={v=>set({...values,note:v})}/>
    {relatedPicker(values,set,chosen)}
    {informedPicker(values,set,chosen)}
    {customerCard(key,values,set)}
  </>};
  const directRow=(item:IncomingDocument)=>{
    const list=firmDepartments(item.company_id);
    const toggleDept=(name:string,on:boolean)=>setDirectForm(f=>({...f,departments:on?[...f.departments,name]:f.departments.filter(d=>d!==name)}));
    const toggleEmp=(id:number,on:boolean)=>setDirectForm(f=>({...f,employees:on?[...f.employees,id]:f.employees.filter(x=>x!==id)}));
    const people=[...new Map(list.flatMap(d=>d.members.map(m=>[m.id,{...m,department:d.name}] as const))).values()];
    return <div className="inlinetaskrow documentrow incomingassignrow">
      <div className="field incomingdepartments"><span>Şöbə(lər) — tapşırıq şöbə rəisinə gedir</span><div>{list.length?list.map(d=>{const noHead=!d.heads.length;return <label key={d.name} className={noHead?"disabled":""} title={noHead?"Şöbənin rəisi təyin edilməyib":undefined}><input type="checkbox" disabled={noHead} checked={directForm.departments.includes(d.name)} onChange={e=>toggleDept(d.name,e.target.checked)}/><b>{d.name}</b><small>{noHead?"rəisi yoxdur":d.heads.map(h=>h.name).join(", ")}</small>{item.related_departments.includes(d.name)&&<em className="incomingrelatedtag">aidiyyatı</em>}</label>}):<small>Firmanın strukturunda şöbə yoxdur.</small>}</div></div>
      <div className="field incomingdepartments incomingpeople"><span>və ya birbaşa işçi(lər)</span><div>{people.length?people.map(p=><label key={p.id}><input type="checkbox" checked={directForm.employees.includes(p.id)} onChange={e=>toggleEmp(p.id,e.target.checked)}/><b>{p.name}</b><small>{p.position_title} · {p.department}</small></label>):<small>Strukturda işçi yoxdur.</small>}</div></div>
      <Field label="İcra müddəti" type="date" value={directForm.dueDate} set={v=>setDirectForm({...directForm,dueDate:v})}/>
      <label className="field incomingresolution">Dərkənar (göstəriş)<Textarea value={directForm.resolution} onChange={e=>setDirectForm({...directForm,resolution:e.target.value})}/></label>
      <div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>setActing(null)}>Ləğv et</button><Button disabled={busy} onClick={()=>void saveDirect(item)}>{busy?"Göndərilir...":`Tapşırıq ver${directForm.departments.length+directForm.employees.length>1?` (${directForm.departments.length+directForm.employees.length})`:""}`}</Button></div>
    </div>;
  };
  const requestRow=(item:IncomingDocument)=><div className="inlinetaskrow documentrow incomingassignrow">
    <label className="field">Hansı şöbəyə<select value={requestForm.toDepartment} onChange={e=>setRequestForm({...requestForm,toDepartment:e.target.value})}><option value="">Seçin</option>{firmDepartments(item.company_id).map(d=><option key={d.name} value={d.name}>{d.name}</option>)}</select></label>
    <Field label="Mövzu" value={requestForm.title} set={v=>setRequestForm({...requestForm,title:v})}/>
    <Field label="Arzu olunan müddət" type="date" value={requestForm.dueDate} set={v=>setRequestForm({...requestForm,dueDate:v})}/>
    <label className="field incomingresolution">Nə lazımdır<Textarea value={requestForm.description} onChange={e=>setRequestForm({...requestForm,description:e.target.value})}/></label>
    <small className="hrhint">Sorğu sizin şöbənizin adından gedir, sənədə bağlanır; qarşı şöbə sənədin skanını sorğudan aça bilir.</small>
    <div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>setActing(null)}>Ləğv et</button><Button disabled={busy} onClick={()=>void saveRequest(item)}>{busy?"Göndərilir...":"Sorğunu göndər"}</Button></div>
  </div>;
  const fileCell=(item:IncomingDocument)=><div className="docstage">
    {item.file_name?<><a className="filelink" href={`/api/documents/incoming/file?id=${item.id}`} target="_blank" rel="noreferrer" title={item.file_path||"Sistemdə saxlanılıb"}>{item.file_name}<small>{formatFileSize(item.file_size||0)}</small></a>{item.file_path&&item.can.upload&&<span className="folderpath docfolder" title={item.file_path}>{item.file_path}</span>}{item.file_missing&&<span className="docmissing">Fayl papkada tapılmadı</span>}</>:<span className="nodocument">Yüklənməyib</span>}
    {item.can.upload&&<label className={`docuploadbtn${uploading?" disabled":""}`}>{uploading===item.id?"Yüklənir...":item.file_name?"Yenisini yüklə":"Skanı sistemə yüklə"}<input type="file" hidden disabled={uploading!==null} onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)void uploadScan(item,f)}}/></label>}
  </div>;
  const incomingColumns:Array<{key:string;label:string;width:number;search:(item:IncomingDocument)=>string;values?:(item:IncomingDocument)=>string[];render:(item:IncomingDocument)=>React.ReactNode}>=[
    {key:"incomingNo",label:"Daxil olma No",width:110,search:i=>i.incoming_no,render:i=><b>{i.incoming_no}</b>},
    {key:"company",label:"Firma",width:150,search:i=>i.company_name||"",render:i=><>{i.company_name||"—"}</>},
    {key:"incomingDate",label:"Daxil olma tarixi",width:110,search:i=>formatDateOnly(i.incoming_date),render:i=><>{formatDateOnly(i.incoming_date)}</>},
    {key:"sender",label:"Göndərən",width:180,search:i=>`${i.sender_name||""} ${i.sender_voen||""}`,render:i=><>{i.sender_name||"—"}{i.sender_voen&&<small className="requestsub">VÖEN: {i.sender_voen}</small>}{i.sender_phone&&<small className="requestsub">Tel: {formatPhone(i.sender_phone)}</small>}</>},
    {key:"senderDoc",label:"Sənədin № və tarixi",width:140,search:i=>`${i.sender_doc_no||""} ${formatDateOnly(i.sender_doc_date)}`,render:i=><>{i.sender_doc_no||"—"}{i.sender_doc_date&&<small className="requestsub">{formatDateOnly(i.sender_doc_date)}</small>}</>},
    {key:"documentType",label:"Sənədin tipi",width:130,search:i=>i.document_type||"",render:i=><>{i.document_type||"—"}</>},
    {key:"receiveMethod",label:"Daxil olma yolu",width:120,search:i=>i.receive_method||"",render:i=><>{i.receive_method||"—"}</>},
    {key:"summary",label:"Qısa məzmun",width:200,search:i=>i.summary||"",render:i=><>{i.summary||"—"}</>},
    {key:"related",label:"Aidiyyatı şöbələr",width:170,search:i=>i.related_departments.join(", "),values:i=>i.related_departments,render:i=>i.related_departments.length||(i.informed_departments||[]).length?<>{i.related_departments.map(d=><div key={d} className="incomingdept"><b>{d}</b></div>)}{(i.informed_departments||[]).map(d=><div key={"m-"+d} className="incomingdept">{d}<small className="requestsub">məlumat üçün</small></div>)}</>:<span className="nodocument">—</span>},
    {key:"status",label:"Status",width:140,search:i=>i.status,render:i=><><span className={`tablestatus ${incomingStatusTone(i.status)}`}>{i.status}</span>{i.status==="Rəhbər tanış olub"&&i.director_seen_by&&<small className="requestsub">{i.director_seen_by}</small>}{i.status==="Rəhbərdə"&&i.sent_to_director_by&&<small className="requestsub">Göndərən: {i.sent_to_director_by}</small>}</>},
    {key:"departments",label:"Tapşırıqlar",width:210,search:i=>i.assignments.map(a=>`${a.department} ${a.head_name||""}`).join(" "),render:i=>i.assignments.length?<>{i.assignments.map((a,n)=><div key={n} className="incomingdept"><b>{a.head_name||"—"}</b><small className="requestsub">{a.department}{a.task_status?` • ${a.task_status==="Təsdiqlənib"?"icra olundu":a.task_status}`:" • tapşırıq silinib"}</small></div>)}{i.due_date&&<small className="requestsub">Müddət: {formatDateOnly(i.due_date)}</small>}{i.status.startsWith("İcradadır")&&<LateDays due={i.due_date?`${i.due_date}T23:59:59`:null}/>}</>:<span className="nodocument">—</span>},
    {key:"requests",label:"Sorğular",width:180,search:i=>i.requests.map(r=>`${r.from_department||""} ${r.to_department} ${r.status}`).join(" "),render:i=>i.requests.length?<>{i.requests.map(r=><div key={r.id} className="incomingdept"><b>{r.from_department||"—"} → {r.to_department}</b><small className="requestsub">№{r.id} • {r.status}</small></div>)}</>:<span className="nodocument">—</span>},
    {key:"resolution",label:"Dərkənar",width:180,search:i=>i.resolution||"",render:i=>i.resolution||i.assigned_by_name?<>{i.resolution||"—"}{i.assigned_by_name&&<small className="requestsub">{i.assigned_by_name}</small>}</>:<span className="nodocument">—</span>},
    {key:"approval",label:"Təsdiq",width:170,search:i=>i.approval?.required?(i.approval.final?"Təsdiqləndi":i.approval.returned?"Geri qaytarılıb":i.approval.label):"Tələb olunmur",render:i=><ApprovalCell approval={i.approval}/>},
    {key:"file",label:"Sənədin skanı",width:200,search:i=>i.file_name||"Yüklənməyib",render:fileCell},
  ];
  const {order,widths,setWidth,moveColumn}=useTableColumns("incoming3",incomingColumns.map(c=>c.key));
  const resize=useEdgeResize(setWidth,60);
  const {dragProps}=useColumnDrag(moveColumn);
  const columnsByKey=Object.fromEntries(incomingColumns.map(c=>[c.key,c]));
  const defaultWidths=Object.fromEntries(incomingColumns.map(c=>[c.key,c.width]));
  const scopedItems=items.filter(item=>!activeCompanyId||item.company_id===activeCompanyId);
  const waitingDirector=scopedItems.filter(i=>waitsForDirector(i)&&directorOf.includes(i.company_id));
  const waitingApproval=scopedItems.filter(i=>approvalActionable(i.approval));
  const excel=useExcelFilters("incoming",incomingColumns,view==="director"?waitingDirector:view==="approve"?waitingApproval:scopedItems);
  const act=async(item:IncomingDocument,payload:Record<string,unknown>,message:string)=>{setBusy(true);setError("");setNotice("");try{await send("PATCH",{...payload,id:item.id});setNotice(`Sənəd №${item.incoming_no}: ${message}`)}catch(e){setError(e instanceof Error?e.message:"Təsdiq qeyd olunmadı.")}finally{setBusy(false)}};
  const colSpan=order.length+1;
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>Daxil olan sənədlər</h2><p>{canRegister?(activeCompanyId?`${companyName(activeCompanyId)} — daxil olan sənədlərin qeydiyyatı`:"Qeydiyyat: Ümumi şöbə · baxış və tapşırıq: rəhbər · icra: aidiyyatı şöbələr"):"Rəhbəri olduğunuz şöbələrə aid və sizə tapşırılan daxil olan sənədlər"}</p></div>{canRegister&&<Button onClick={()=>{setCreating(v=>!v);setVoenState(s=>({...s,new:""}));setForm({relatedDepartments:"[]"})}}><Plus/>Yeni sənəd</Button>}</div>
    {creating&&<div className="inlinetaskrow documentrow outgoingrow">{formFields("new",form,setForm,true)}<label className="field filefield">Sənədin skanı (istəyə bağlı — sonra cədvəldən də yükləmək olar)<Input type="file" onChange={e=>setNewFile(e.target.files?.[0]||null)}/>{newFile&&<small>{newFile.name} • {formatFileSize(newFile.size)}</small>}</label><div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>{setCreating(false);setForm({});setNewFile(null)}}>Ləğv et</button><Button disabled={busy} onClick={()=>void create()}>{busy?"Qeydə alınır...":"Qeydə al"}</Button></div></div>}
    {error&&<div className="errorbox">{error}</div>}
    {notice&&<div className="docnotice">{notice}</div>}
    <div className="fixedsubtabs"><button className={view==="all"?"on":""} onClick={()=>setView("all")}>Bütün sənədlər ({scopedItems.length})</button>{directorOf.length>0&&<button className={view==="director"?"on":""} onClick={()=>setView("director")}>Rəhbərin baxışında ({waitingDirector.length}){waitingDirector.length>0&&<em className="requestbadge">{waitingDirector.length}</em>}</button>}{(waitingApproval.length>0||view==="approve")&&<button className={view==="approve"?"on":""} onClick={()=>setView("approve")}>Təsdiqimi gözləyir ({waitingApproval.length}){waitingApproval.length>0&&<em className="requestbadge">{waitingApproval.length}</em>}</button>}</div>
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable documenttable compacttable"><ColGroup order={order} defaultWidths={defaultWidths} widths={widths} extraKeys={["actions"]}/><thead><tr>{order.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}>{excel.header(col)}</SortableTh>})}<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader/></th></tr></thead><tbody>{excel.rows.map(item=>editingId===item.id?<tr key={item.id}><td colSpan={colSpan}><div className="inlinetaskrow documentrow outgoingrow documenteditrow">{formFields("edit",editForm,setEditForm,false)}<div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>setEditingId(null)}>Ləğv et</button><Button disabled={busy} onClick={()=>void saveEdit(item)}>{busy?"Yadda saxlanılır...":"Yadda saxla"}</Button></div></div></td></tr>:<Fragment key={item.id}><tr className={waitsForDirector(item)&&directorOf.includes(item.company_id)?"incomingwaiting":undefined}>
      {order.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      <td data-label="Əməliyyat"><div className="tableactions">
        <ApprovalButtons approval={item.approval} busy={busy} onAct={(payload,message)=>void act(item,payload,message)}/>
        {item.can.direct&&<button className="evaluatebtn" onClick={()=>startDirect(item)}>{item.assignments.length?"Tapşırıqları dəyiş":"Tapşırıq ver"}</button>}
        {item.can.review&&<button className="editcompanybtn" disabled={busy} onClick={()=>void review(item)}>Tanış oldum</button>}
        {item.can.request&&<button className="editcompanybtn" onClick={()=>startRequest(item)}>Sorğu yarat</button>}
        {item.can.edit&&<button className="editcompanybtn" onClick={()=>startEdit(item)}>Redaktə et</button>}
        {item.can.remove&&<button className="deletetaskbtn" onClick={()=>void remove(item)}>Sil</button>}
      </div></td>
    </tr>{acting?.id===item.id&&<tr><td colSpan={colSpan}>{acting.mode==="direct"?directRow(item):requestRow(item)}</td></tr>}</Fragment>)}</tbody></table>{!excel.rows.length&&<Empty text={view==="approve"?"Təsdiqinizi gözləyən sənəd yoxdur.":view==="director"?"Rəhbərin baxışını gözləyən sənəd yoxdur.":scopedItems.length?"Axtarışa uyğun sənəd tapılmadı.":canRegister?"Hələ daxil olan sənəd qeydə alınmayıb.":"Şöbənizə aid daxil olan sənəd yoxdur."}/>}</div>}
  </section>;
}
function todayInput(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Baku"}).format(new Date())}
const requestStatusTone=(s:string)=>s==="Bağlandı"?"done":s==="Qiymətləndirmə gözləyir"?"awaiting":s==="İmtina edildi"?"late":s==="Cavablandı"?"review":s==="İcra olunur"||s==="Qəbul edildi"?"inprogress":"";
const requestDue=(i:WorkRequest)=>i.agreed_due_at||i.desired_due_at;
const requestColumns:Array<{key:string;label:string;width:number;search:(item:WorkRequest)=>string;sort?:(item:WorkRequest)=>string|number|null;render:(item:WorkRequest)=>React.ReactNode}>=[
  {key:"id",label:"№",width:60,search:i=>String(i.id),sort:i=>i.id,render:i=><>{i.actionable?<b className="requestdot" title="Sizdən əməliyyat gözlənilir"/>:null}{i.id}</>},
  {key:"title",label:"Mövzu",width:240,search:i=>`${i.title} ${i.origin_work_title||""} ${i.origin_incoming_no||""}`,render:i=><><b>{i.title}</b>{i.origin_work_title&&<small className="requestorigin">Şəxsi işlərim: {i.origin_work_title}</small>}{i.incoming_id&&i.origin_incoming_no&&<a className="requestorigin" href={`/api/documents/incoming/file?id=${i.incoming_id}`} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}>Daxil olan sənəd №{i.origin_incoming_no}</a>}</>},
  {key:"from",label:"Kimdən",width:190,search:i=>`${i.from_name||""} ${i.from_department||""}`,render:i=><>{i.from_name||"—"}{i.from_department&&<small className="requestsub">{i.from_department}</small>}</>},
  {key:"to",label:"Kimə",width:190,search:i=>`${i.to_department} ${i.assignee_name||""}`,render:i=><>{i.to_department}{i.assignee_name&&<small className="requestsub">İcraçı: {i.assignee_name}</small>}</>},
  {key:"company",label:"Firma",width:150,search:i=>i.company_name,render:i=>i.company_name},
  {key:"due",label:"Tarix",width:120,search:i=>formatDateOnly(requestDue(i)),sort:i=>requestDue(i),render:i=><>{formatDateOnly(requestDue(i))}{!["Bağlandı","İmtina edildi","Cavablandı","Qiymətləndirmə gözləyir"].includes(i.status)&&<LateDays due={requestDue(i)?`${requestDue(i)}T23:59:59`:null}/>}</>},
  {key:"status",label:"Status",width:150,search:i=>i.status,render:i=><span className={`tablestatus ${requestStatusTone(i.status)}`}>{i.status}</span>},
  {key:"score",label:"Qiymət",width:110,search:i=>i.task_evaluation?`${i.task_evaluation}/10`:i.status==="Qiymətləndirmə gözləyir"?"Gözləyir":"—",sort:i=>i.task_evaluation??null,render:i=>i.task_evaluation?<RatingCell evaluation={i.task_evaluation} note={i.task_evaluation_note} compact twoRows/>:i.status==="Qiymətləndirmə gözləyir"?<span className="tablestatus awaiting">Gözləyir</span>:<span className="nodocument">—</span>},
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
  const [requestFiles,setRequestFiles]=useState<File[]>([]);
  const [busy,setBusy]=useState(false);
  const [openId,setOpenId]=useState<number|null>(null);
  const [events,setEvents]=useState<WorkHistoryEvent[]|null>(null);
  const [act,setAct]=useState<Record<string,string>>({});
  const [actError,setActError]=useState("");
  const apply=(body:RequestsData)=>{setData({canAdd:body.canAdd!==false,items:body.items||[],departments:body.departments||{},members:body.members||{},myDepartments:body.myDepartments||{}});onActionable((body.items||[]).filter(i=>i.actionable).length)};
  const load=async()=>{setLoading(true);setError("");try{const response=await fetch("/api/requests");const body=await response.json();if(!response.ok)throw new Error(body.error);apply(body)}catch(e){setError(e instanceof Error?e.message:"Sorğular yüklənmədi.")}finally{setLoading(false)}};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void load()},[]);
  const scoped=data.items.filter(i=>isAdmin||!activeCompanyId||i.company_id===activeCompanyId);
  const counts={incoming:scoped.filter(i=>i.box==="incoming").length,outgoing:scoped.filter(i=>i.box==="outgoing").length,oversight:scoped.filter(i=>i.box==="oversight").length};
  const pending={incoming:scoped.filter(i=>i.box==="incoming"&&i.actionable).length,outgoing:scoped.filter(i=>i.box==="outgoing"&&i.actionable).length};
  const excel=useExcelFilters("requests",requestColumns,scoped.filter(i=>i.box===box));
  const filtered=excel.rows;
  // The firma column matters in an all-firma view: the admin's, or an employee's "Bütün firmalar" (Versiya 2.88).
  const shownOrder=order.filter(k=>columnsByKey[k]&&(isAdmin||!activeCompanyId||k!=="company")&&(k!=="score"||box==="incoming"));
  // With "Bütün firmalar" a new request's firm must be picked; nothing is taken on its own.
  const formCompanyId=Number(form.companyId||activeCompanyId||(isAdmin||companies.length===1?companies[0]?.id:0)||0);
  const myDepartment=data.myDepartments[String(formCompanyId)]||null;
  const departmentOptions=(data.departments[String(formCompanyId)]||[]).filter(d=>d!==myDepartment);
  const create=async()=>{
    if(!formCompanyId||!form.toDepartment||!(form.title||"").trim())return;
    setBusy(true);setError("");
    try{
      // Versiya 2.104: up to 10 files go with the request (and on to its task when accepted).
      const files=await uploadFiles(requestFiles);
      const response=await fetch("/api/requests",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({companyId:formCompanyId,toDepartment:form.toDepartment,title:form.title,description:form.description,desiredDueAt:form.desiredDueAt,files})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      apply(body);setForm({});setRequestFiles([]);setCreating(false);setBox("outgoing");
    }catch(e){setError(e instanceof Error?e.message:"Sorğu göndərilmədi.")}
    finally{setBusy(false)}
  };
  const current=data.items.find(i=>i.id===openId)||null;
  const openDetail=async(item:WorkRequest)=>{setOpenId(item.id);setEvents(null);setActError("");setAct({assigneeId:item.assignee_employee_id?String(item.assignee_employee_id):"",agreedDueAt:requestDue(item)||"",score:"10"});try{const response=await fetch(`/api/requests?events=${item.id}`);const body=await response.json();setEvents(response.ok?body.events||[]:[])}catch{setEvents([])}};
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
  const textModes:Record<string,{label:string;button:string;required:boolean}>={reject:{label:"İmtinanın səbəbi",button:"İmtina et",required:true},answer:{label:"Cavab (istəyə bağlı)",button:"Cavablandı",required:false},reopen:{label:"Nə çatışmır?",button:"Yenidən aç",required:true},close:{label:"Qeyd (istəyə bağlı)",button:"Təsdiqlə",required:false}};
  return <section className="panel pagepanel directorypanel">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">ŞÖBƏLƏRARASI</span><h2>Sorğular</h2><p>Başqa şöbəyə iş tələbi və ya məlumat sorğusu göndərin</p></div>{data.canAdd!==false&&<Button onClick={()=>setCreating(v=>!v)}><Plus/>Yeni sorğu</Button>}</div>
    {creating&&<div className="inlinetaskrow requestrow">
      {(isAdmin||companies.length>1)&&<label className="field">Firma<select value={String(formCompanyId||"")} onChange={e=>setForm({...form,companyId:e.target.value,toDepartment:""})}>{!formCompanyId&&<option value="">Seçin</option>}{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      <label className="field">Hansı şöbəyə<select value={form.toDepartment||""} onChange={e=>setForm({...form,toDepartment:e.target.value})}><option value="">Şöbə seçin</option>{departmentOptions.map(d=><option key={d} value={d}>{d}</option>)}</select></label>
      <Field label="Mövzu" value={form.title||""} set={v=>setForm({...form,title:v})}/>
      <label className="field">İstədiyiniz tarix (istəyə bağlı)<Input type="date" value={form.desiredDueAt||""} onChange={e=>setForm({...form,desiredDueAt:e.target.value})}/></label>
      <label className="field requestdesc">Təsvir<Textarea value={form.description||""} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <FilePicker label="Fayllar (istəyə bağlı)" files={requestFiles} onChange={setRequestFiles}/>
      {!loading&&!departmentOptions.length&&<small className="requestsub">Bu firmanın strukturunda şöbə tapılmadı — admin əvvəlcə firmanın strukturunu doldurmalıdır.</small>}
      <div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>{setCreating(false);setForm({});setRequestFiles([])}}>Ləğv et</button><Button disabled={busy||!form.toDepartment||!(form.title||"").trim()} onClick={()=>void create()}>{busy?"Göndərilir...":"Göndər"}</Button></div>
    </div>}
    {error&&<div className="errorbox">{error}</div>}
    <div className="fixedsubtabs"><button className={box==="incoming"?"on":""} onClick={()=>setBox("incoming")}>Gələnlər ({counts.incoming}){pending.incoming>0&&<em className="requestbadge">{pending.incoming}</em>}</button><button className={box==="outgoing"?"on":""} onClick={()=>setBox("outgoing")}>Göndərdiklərim ({counts.outgoing}){pending.outgoing>0&&<em className="requestbadge">{pending.outgoing}</em>}</button>{counts.oversight>0&&<button className={box==="oversight"?"on":""} onClick={()=>setBox("oversight")}>Şöbəmin sorğuları ({counts.oversight})</button>}</div>
    {loading?<div className="loading">Yüklənir...</div>:<div className="tasktablewrap"><table className="tasktable requesttable"><ColGroup order={shownOrder} defaultWidths={defaultWidths} widths={widths} extraKeys={["actions"]}/><thead><tr>{shownOrder.map(key=>{const col=columnsByKey[key];return <SortableTh key={key} resize={resize(key)} drag={dragProps(key)}>{excel.header(col)}</SortableTh>})}<th {...resize("actions")} className={`opencolumn${resize("actions").className?` ${resize("actions").className}`:""}`}><ActionsHeader/></th></tr></thead><tbody>{filtered.map(item=><tr key={item.id} className={item.actionable?"requestpending":undefined}>
      {shownOrder.map(key=>{const col=columnsByKey[key];return <td key={key} data-label={col.label}>{col.render(item)}</td>})}
      <td data-label="Əməliyyat"><button type="button" className="openbtn" onClick={()=>void openDetail(item)}>Aç</button></td>
    </tr>)}</tbody></table>{!filtered.length&&<Empty text={box==="incoming"?"Gələn sorğu yoxdur.":box==="outgoing"?"Hələ sorğu göndərməmisiniz.":"Şöbənizin sorğusu yoxdur."}/>}</div>}
    <Dialog open={Boolean(current)} onOpenChange={v=>{if(!v)setOpenId(null)}}><DialogContent className="businessdialog" resizable>{current&&<FormShell title={current.title} desc={`Sorğu №${current.id} • ${current.company_name}`} formClass="taskdetailform">
      <div className="taskdetailleft requestside">
        <div className="field"><span>Status</span><strong className={`detailstatus ${requestStatusTone(current.status)}`}>{current.status}</strong></div>
        {(current.can.accept||current.can.reassign)&&<div className="requestblock"><label className="field">{current.can.accept?"İcraçı":"İcraçını dəyiş"}<select value={act.assigneeId||""} onChange={e=>setAct({...act,assigneeId:e.target.value})}><option value="">Əməkdaş seçin</option>{members.map(m=><option key={m.id} value={m.id}>{m.name} — {m.position_title}</option>)}</select></label>
          {current.can.accept&&<label className="field">Razılaşdırılmış tarix<Input type="date" value={act.agreedDueAt||""} onChange={e=>setAct({...act,agreedDueAt:e.target.value})}/></label>}
          {!members.length&&<small className="requestsub">Bu şöbədə vəzifəyə təyin olunmuş əməkdaş yoxdur.</small>}
          <small className="requestsub">{current.can.accept?"İcraçıya iş “Tapşırıqlarım” bölməsində tapşırıq kimi düşəcək.":current.task_id?"Köhnə icraçının tapşırığı götürüləcək, yeni icraçıya yeni tapşırıq düşəcək.":""}</small>
          <Button disabled={busy||!act.assigneeId||(current.can.accept&&!act.agreedDueAt)||(!current.can.accept&&act.assigneeId===String(current.assignee_employee_id))} onClick={()=>void run(current.can.accept?"accept":"reassign",{assigneeId:Number(act.assigneeId),agreedDueAt:act.agreedDueAt})}>{current.can.accept?"Qəbul et":"İcraçını dəyiş"}</Button></div>}
        <div className="requestbuttons">
          {current.can.start&&<Button disabled={busy} onClick={()=>void run("start")}>İcraya al</Button>}
          {current.can.answer&&<Button disabled={busy} onClick={()=>setAct({...act,mode:"answer",text:""})}>Cavablandır</Button>}
          {current.can.close&&<Button disabled={busy} onClick={()=>setAct({...act,mode:"close",text:""})}>Cavabı təsdiqlə ✓</Button>}
          {current.can.reopen&&<button className="inlinecancel" disabled={busy} onClick={()=>setAct({...act,mode:"reopen",text:""})}>Cavab qane etmir</button>}
          {current.can.reject&&<button className="inlinecancel" disabled={busy} onClick={()=>setAct({...act,mode:"reject",text:""})}>İmtina et</button>}
          {current.can.remove&&<button className="deletetaskbtn" disabled={busy} onClick={()=>void remove(current)}>Sil</button>}
        </div>
        {current.can.evaluate&&<div className="requestblock"><b className="requestblocktitle">İcraçının işini qiymətləndirin</b><small className="requestsub">Sorğunu göndərən cavabı təsdiqləyib. {current.assignee_name} üçün bal verin — sorğu bundan sonra bağlanacaq.</small><label className="field">Qiymət (1–10)<select value={act.score||"10"} onChange={e=>setAct({...act,score:e.target.value})}>{[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n} bal</option>)}</select></label><label className="field">Rəy (istəyə bağlı)<Textarea value={act.evalNote||""} onChange={e=>setAct({...act,evalNote:e.target.value})}/></label><Button disabled={busy} onClick={()=>void run("evaluate",{score:Number(act.score||10),text:act.evalNote})}>Qiymətləndir</Button></div>}
        {textMode&&textModes[textMode]&&<div className="requestblock"><label className="field">{textModes[textMode].label}<Textarea value={act.text||""} onChange={e=>setAct({...act,text:e.target.value})}/></label><div className="inlineactions"><button className="inlinecancel" disabled={busy} onClick={()=>setAct({...act,mode:"",text:""})}>Ləğv et</button><Button disabled={busy||(textModes[textMode].required&&!(act.text||"").trim())} onClick={()=>void run(textMode,{text:act.text})}>{textModes[textMode].button}</Button></div></div>}
        {current.can.comment&&!textMode&&<div className="requestblock"><label className="field">Şərh yaz<Textarea value={act.text||""} onChange={e=>setAct({...act,text:e.target.value})}/></label><Button disabled={busy||!(act.text||"").trim()} onClick={()=>void run("comment",{text:act.text})}>Göndər</Button></div>}
        {actError&&<div className="errorbox">{actError}</div>}
      </div>
      <div className="taskdetailright"><div className="taskdetailinfo">
        <p><b>Kimdən</b><span>{current.from_name||"—"}{current.from_department?` — ${current.from_department}`:""}</span></p>
        <p><b>Kimə</b><span>{current.to_department}{current.assignee_name?` — icraçı: ${current.assignee_name}`:""}</span></p>
        {current.description&&<p><b>Təsvir</b><span className="requesttext">{current.description}</span></p>}
        <p><b>İstənilən tarix</b><span>{formatDateOnly(current.desired_due_at)}{current.agreed_due_at&&current.agreed_due_at!==current.desired_due_at?` → razılaşdırılmış: ${formatDateOnly(current.agreed_due_at)}`:""}</span></p>
        {current.attachment_key&&<p><b>Əlavə olunan fayllar</b><span><FileLinks files={rowFiles(current.files,current.attachment_key,current.attachment_name,current.attachment_size)}/></span></p>}
        {current.task_id&&<p><b>İcraçının tapşırığı</b><span>{current.assignee_name} — {current.task_status||"—"}</span></p>}
        {current.task_evaluation?<p><b>Qiymət</b><span><RatingCell evaluation={current.task_evaluation} note={current.task_evaluation_note}/></span></p>:null}
        {current.submission_attachment_key&&<p><b>Cavab faylları</b><span><FileLinks files={rowFiles(current.submission_files,current.submission_attachment_key,current.submission_attachment_name,current.submission_attachment_size)}/></span></p>}
        {current.reject_reason&&<p><b>İmtinanın səbəbi</b><span className="requesttext">{current.reject_reason}</span></p>}
        <p><b>Göndərilib</b><span>{formatDate(current.created_at)}</span></p>
      </div>
      <WorkHistory events={events} title="Sorğunun tarixçəsi"/></div>
    </FormShell>}</DialogContent></Dialog>
  </section>;
}
// "Giriş icazələri": which menu sections an employee sees and, in the sections with rights (Versiya 2.62: Baxış, Əlavə et,
// Dəyişiklik et, Sil), what they may do there. Format: lib/permission-model.ts. Locked items cannot be closed; the admin always
// may do everything.
// Versiya 2.100: the user's firms are listed one under another and every section is given per firm (no "Ümumi" part), so in a
// firm one may, say, open only Kadrlar. In Çıxan / Daxil olan sənədlər the work in a firm can be narrowed to some document types
// (the firm's templates). A firm newly added to the user starts fully closed.
type SectionNode={key:string;label:string;locked?:boolean};
type SectionGroup={key:string;label:string;children:SectionNode[]};
const FIRM_TREE:SectionGroup[]=[
  {key:"tasks",label:"Tapşırıqlar",children:[{key:"tasks.manager",label:"Verilən tapşırıqlar",locked:true},{key:"tasks.requests",label:"Sorğular"},{key:"tasks.mine",label:"Şəxsi işlərim"},{key:"tasks.fixed",label:"Sabit işlər"}]},
  {key:"documents",label:"Sənədlər",children:[{key:"documents.incoming",label:"Daxil olan sənədlər"},{key:"documents.outgoing",label:"Çıxan sənədlər"},{key:"dashboard.customers",label:"Müştərilər"}]},
  {key:"hr",label:"Kadrlar",children:[{key:"hr.personnel",label:"Personallar (şəxsi məlumatlar, maaş)"},{key:"hr.orders",label:"Əmrlər (məzuniyyət, işdən çıxma, digər)"},{key:"hr.violations",label:"Nöqsanlar"}]},
  {key:"chat",label:"Çat",children:[]},
];
const parseHiddenSections=(raw:string|null|undefined):string[]=>parseStoredPermissions(raw||"[]");
const isLeveled=(key:string)=>(LEVELED_SECTIONS as readonly string[]).includes(key);
// The client's view of what a user may do — the same rule the server uses (any firm gives a section).
const deniedOf=(e:Employee)=>deniedWithFirms(parseHiddenSections(e.hidden_sections),parseCompanyPermissions(e.company_permissions||"{}"),(e.company_ids||"").split(",").filter(Boolean).map(Number));
const fullActions=(section:string):SectionAction[]=>isLeveled(section)?[...ACTIONS]:["view"];
const ALL_FIRM_RIGHTS=():Partial<Record<FirmSection,FirmSectionRights>>=>Object.fromEntries(FIRM_SECTIONS.map(s=>[s,{actions:fullActions(s)}]));
function PermissionTree({onChange,firms,onFirmsChange,companies,employee,assignments,copyFrom}:{hidden:string[];onChange:(next:string[])=>void;firms:CompanyPermissions;onFirmsChange:(next:CompanyPermissions)=>void;companies:Company[];employee:Employee|null;assignments:WorkAssignment[];copyFrom:Employee[]}){
  // Firms and groups start closed so the list stays short; a closed one still shows how many of its items are open.
  const [openGroups,setOpenGroups]=useState<Set<string>>(new Set());
  const toggleGroup=(key:string)=>setOpenGroups(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next});
  // The firms' document types to pick from: the Çıxan / Daxil olan sənəd templates (Sənədlər → Şablonlar).
  const [templates,setTemplates]=useState<DocumentTemplate[]>([]);
  useEffect(()=>{void fetch("/api/documents").then(r=>r.ok?r.json():{items:[]}).then(body=>setTemplates(body.items||[])).catch(()=>{})},[]);
  const rightsOf=(companyId:number,section:string)=>firmSectionRights(firms,companyId,section as FirmSection);
  const setFirmEntry=(companyId:number,section:string,entry:FirmSectionRights|null)=>{
    const firm={...(firms[String(companyId)]||{})};
    if(entry&&entry.actions.length)firm[section as FirmSection]=entry;else delete firm[section as FirmSection];
    onFirmsChange({...firms,[String(companyId)]:firm});
  };
  // One right: any of Əlavə et / Dəyişiklik et / Sil turns Baxış on; taking Baxış away takes all of them.
  const setFirmAction=(companyId:number,section:string,action:SectionAction,on:boolean)=>{
    const current=firms[String(companyId)]?.[section as FirmSection];
    let actions=new Set<SectionAction>(current?.actions||[]);
    if(on){actions.add(action);actions.add("view")}
    else if(action==="view")actions=new Set();
    else actions.delete(action);
    setFirmEntry(companyId,section,{...(current?.types?{types:current.types}:{}),actions:ACTIONS.filter(a=>actions.has(a))});
  };
  // A section (or a whole group, or the whole firm) opens or closes with all of its rights.
  const setFirmAll=(companyId:number,sections:string[],on:boolean)=>{
    const firm={...(firms[String(companyId)]||{})};
    for(const section of sections){const key=section as FirmSection;if(on)firm[key]={...(firm[key]?.types?{types:firm[key]!.types}:{}),actions:fullActions(section)};else delete firm[key]}
    onFirmsChange({...firms,[String(companyId)]:firm});
  };
  const setFirmTypes=(companyId:number,section:string,types:number[]|null)=>{
    const current=firms[String(companyId)]?.[section as FirmSection];
    if(!current)return;
    setFirmEntry(companyId,section,types?{actions:current.actions,types}:{actions:current.actions});
  };
  // Versiya 2.101: "Başqa firmadan köçür..." — this user's rights in another of their firms, copied into this firm (types do not carry over).
  const copyFromFirm=(sourceId:number,targetId:number)=>{
    const source=firms[String(sourceId)]||{};
    onFirmsChange({...firms,[String(targetId)]:Object.fromEntries(Object.entries(source).map(([s,e])=>[s,{actions:[...(e as FirmSectionRights).actions]}]))});
  };
  const copyFirmToAll=(companyId:number)=>{
    const source=firms[String(companyId)]||{};
    // Document types are templates of one firm, so a narrowed list cannot be carried over: the other firms get every type.
    const plain=Object.fromEntries(Object.entries(source).map(([s,e])=>[s,{actions:[...(e as FirmSectionRights).actions]}]));
    onFirmsChange(Object.fromEntries(companies.map(c=>[String(c.id),c.id===companyId?source:structuredClone(plain)])));
  };
  const firmTemplates=(companyId:number,section:string)=>templates.filter(t=>Number(t.company_id)===companyId&&templateGroupOf(t)===(section==="documents.incoming"?"incoming":"outgoing"));
  const openAll=()=>{onChange([]);onFirmsChange(Object.fromEntries(companies.map(c=>[String(c.id),ALL_FIRM_RIGHTS()])))};
  const copyEmployee=(source:Employee)=>{
    onChange(parseHiddenSections(source.hidden_sections));
    const theirs=parseCompanyPermissions(source.company_permissions||"{}");
    onFirmsChange(Object.fromEntries(companies.filter(c=>theirs[String(c.id)]).map(c=>[String(c.id),theirs[String(c.id)]])));
  };
  const fullFirm=(companyId:number)=>FIRM_SECTIONS.every(s=>fullActions(s).every(a=>rightsOf(companyId,s)[a])&&!rightsOf(companyId,s).types);
  const firmOpenCount=(companyId:number)=>FIRM_SECTIONS.filter(s=>rightsOf(companyId,s).view).length;
  const own=employee?assignments.filter(a=>a.employee_id===employee.id):[];
  const warnings:string[]=[];
  for(const c of companies){
    const fixed=own.filter(a=>a.company_id===c.id).length;
    if(fixed&&!rightsOf(c.id,"tasks.fixed").view)warnings.push(`${c.name}: bu işçiyə ${fixed} sabit iş təyin olunub — “Sabit işlər” bağlı olsa, onları icra edildi kimi işarələyə bilməyəcək.`);
    for(const s of TYPED_SECTIONS){const r=rightsOf(c.id,s);if(r.view&&r.types&&!r.types.length)warnings.push(`${c.name}: “${s==="documents.incoming"?"Daxil olan":"Çıxan"} sənədlər”də “Seçilmiş növlər” seçilib, amma heç bir növ işarələnməyib — bu firmada həmin sənədlər görünməyəcək.`)}
  }
  if(employee?.is_department_head){
    const noRequests=companies.filter(c=>!rightsOf(c.id,"tasks.requests").edit).map(c=>c.name);
    if(noRequests.length)warnings.push(`Bu işçi şöbə rəisidir — ${noRequests.join(", ")} firmasında “Sorğular”da “Dəyişiklik et” bağlı olsa, şöbəsinə gələn sorğuları qəbul edib cavablandıra bilməyəcək.`);
  }
  // "Sənəd növləri" under Çıxan / Daxil olan sənədlər of a firm.
  const typePicker=(companyId:number,section:string)=>{
    if(!(TYPED_SECTIONS as readonly string[]).includes(section))return null;
    const r=rightsOf(companyId,section);
    if(!r.view)return null;
    const list=firmTemplates(companyId,section);
    const chosen=new Set(r.types||[]);
    return <div className="permissiontypes">
      <span>Sənəd növləri:</span>
      <label><input type="radio" checked={!r.types} onChange={()=>setFirmTypes(companyId,section,null)}/>Bütün növlər</label>
      <label><input type="radio" checked={Boolean(r.types)} onChange={()=>setFirmTypes(companyId,section,r.types||[])}/>Seçilmiş növlər</label>
      {r.types&&<div className="permissiontypelist">{list.length?list.map(t=><label key={t.id}><input type="checkbox" checked={chosen.has(t.id)} onChange={e=>setFirmTypes(companyId,section,e.target.checked?[...chosen,t.id]:[...chosen].filter(id=>id!==t.id))}/>{t.name}</label>):<small>Bu firmanın “{section==="documents.incoming"?"Daxil olan":"Çıxan"} sənəd” şablonu yoxdur (Sənədlər → Şablonlar).</small>}</div>}
      {r.types&&<small className="permissiontypenote">Yalnız seçilmiş növlərin sənədlərini görür və qeydə alır; dəyişiklik və silmə yalnız özünün qeydə aldığı sənədlərdə.</small>}
    </div>;
  };
  // One group of a firm (a box with a header checkbox, a count and its rows).
  const renderGroup=(companyId:number,group:SectionGroup)=>{
    const r=(key:string)=>rightsOf(companyId,key);
    const allOf=(key:string)=>fullActions(key).every(a=>r(key)[a]);
    const toggleable=group.children.length?group.children.filter(c=>!c.locked).map(c=>c.key):[group.key];
    const visibleCount=toggleable.filter(key=>r(key).view).length;
    const hasLocked=group.children.some(c=>c.locked);
    const allVisible=visibleCount===toggleable.length;
    const total=group.children.length||1;
    const shown=group.children.length?group.children.filter(c=>c.locked||r(c.key).view).length:visibleCount;
    const groupKey=`${companyId}:${group.key}`;
    const expanded=openGroups.has(groupKey);
    return <div key={group.key} className={`permissiongroup${expanded?" open":""}`}>
      <div className="permissionrow">
        <input type="checkbox" aria-label={`${group.label}: hamısı`} checked={allVisible||hasLocked&&visibleCount>0} ref={el=>{if(el)el.indeterminate=visibleCount>0&&!allVisible}} onChange={()=>setFirmAll(companyId,toggleable,!allVisible)}/>
        {group.children.length>0?<button type="button" className="permissiontoggle" aria-expanded={expanded} onClick={()=>toggleGroup(groupKey)}><ChevronDown/><span>{group.label}</span></button>:<span className="permissiontoggle plain"><span>{group.label}</span></span>}
        <small className={shown===total?"permissioncount all":shown===0?"permissioncount none":"permissioncount"}>{shown===total?"hamısı açıq":shown===0?"bağlı":`${shown}/${total} açıq`}</small>
      </div>
      {expanded&&group.children.length>0&&<div className="permissionchildren">{group.children.map(child=>!child.locked&&isLeveled(child.key)?<div key={child.key} className="permissionleveled">
        <label><input type="checkbox" checked={allOf(child.key)} ref={el=>{if(el)el.indeterminate=r(child.key).view&&!allOf(child.key)}} onChange={()=>setFirmAll(companyId,[child.key],!allOf(child.key))}/><span>{child.label}</span></label>
        <div className="permissionactions">{ACTIONS.map(a=><label key={a}><input type="checkbox" checked={r(child.key)[a]} onChange={e=>setFirmAction(companyId,child.key,a,e.target.checked)}/>{ACTION_LABELS[a]}</label>)}</div>
        {typePicker(companyId,child.key)}
      </div>:<label key={child.key} className={child.locked?"locked":undefined}><input type="checkbox" checked={child.locked||r(child.key).view} disabled={child.locked} onChange={e=>setFirmAll(companyId,[child.key],e.target.checked)}/><span>{child.label}</span>{child.locked&&<small>🔒 həmişə açıq</small>}</label>)}</div>}
    </div>;
  };
  return <div className="permissiontree">
    <div className="permissionhead"><b>Giriş icazələri</b><span><select value="" onChange={e=>{const source=copyFrom.find(x=>String(x.id)===e.target.value);if(source)copyEmployee(source)}}><option value="">Başqa işçidən köçür...</option>{copyFrom.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select><button type="button" disabled={!companies.length||companies.every(c=>fullFirm(c.id))} onClick={openAll}>Hamısını aç</button></span></div>
    <small className="permissionnote">İcazələr hər firma üçün ayrıca verilir: firmanın adına basın və həmin firmada lazım olan bölmələri açın — məsələn, yalnız Kadrlar. Bəzi bölmələrdə ayrıca hüquqlar var: Baxış, Əlavə et, Dəyişiklik et, Sil. İstifadəçiyə yeni firma əlavə edəndə o firmada hər şey bağlı olur. Müştərilər və Çat firmaya bağlı deyil — ən azı bir firmada açıq olanda görünür. 🔒 olan bəndlər həmişə açıqdır.</small>
    {!companies.length&&<small className="permissionnote">İcazə vermək üçün əvvəlcə yuxarıda istifadəçinin firmalarını seçin.</small>}
    <div className="permissiongroups">{companies.map(c=>{
      const expanded=openGroups.has(String(c.id));
      const count=firmOpenCount(c.id);
      const full=fullFirm(c.id);
      return <div key={c.id} className={`permissiongroup permissionfirm${expanded?" open":""}`}>
        <div className="permissionrow">
          <input type="checkbox" aria-label={`${c.name}: hamısı`} checked={full} ref={el=>{if(el)el.indeterminate=count>0&&!full}} onChange={()=>setFirmAll(c.id,[...FIRM_SECTIONS],!full)}/>
          <button type="button" className="permissiontoggle" aria-expanded={expanded} onClick={()=>toggleGroup(String(c.id))}><ChevronDown/><span>{c.name}</span></button>
          <small className={count===FIRM_SECTIONS.length?"permissioncount all":count===0?"permissioncount none":"permissioncount"}>{count===0?"bağlı":`${count}/${FIRM_SECTIONS.length} açıq`}</small>
        </div>
        {expanded&&<div className="permissionfirmbody">
          <div className="permissiongroups">{FIRM_TREE.map(group=>renderGroup(c.id,group))}</div>
          {companies.length>1&&<div className="permissionfirmcopy"><select value="" onChange={e=>{const source=companies.find(x=>String(x.id)===e.target.value);if(source&&window.confirm(`“${source.name}” firmasındakı icazələr “${c.name}” firmasına köçürülsün? “${c.name}” firmasındakı indiki icazələr əvəz olunacaq, seçilmiş sənəd növləri “Bütün növlər” olacaq.`))copyFromFirm(source.id,c.id)}}><option value="">Başqa firmadan köçür...</option>{companies.filter(x=>x.id!==c.id).map(x=><option key={x.id} value={x.id}>{x.name} ({firmOpenCount(x.id)}/{FIRM_SECTIONS.length} açıq)</option>)}</select><button type="button" className="permissioncopyfirm" onClick={()=>{if(window.confirm(`“${c.name}” firmasının icazələri istifadəçinin bütün firmalarına köçürülsün? Digər firmalarda seçilmiş sənəd növləri “Bütün növlər” olacaq.`))copyFirmToAll(c.id)}}>Bu firmanın icazələrini bütün firmalara köçür</button></div>}
        </div>}
      </div>;
    })}</div>
    {warnings.map(w=><div key={w} className="permissionwarning">⚠ {w}</div>)}
  </div>;
}
function PlaceholderPage({title,text}:{title:string;text:string}){
  return <section className="panel pagepanel directorypanel"><div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>{title}</h2><p>Bu bölmə hazırlanma mərhələsindədir</p></div></div><Empty text={text}/></section>;
}
function WorkList({employeeView,team=false,tab,frequency,items,assignments,completions,employees,companies,form,setForm,onAdd,onDue,onAssign,onCatalogAssign,onComplete,onUncomplete,isAdmin=false,fixedStart=DEFAULT_FIXED_START,onFixedStart,onEditWork,onDeleteWork,onCatalogUnassign}:{team?:boolean;onCatalogUnassign?:(workDefinitionId:number,companyId:number,employeeId:number)=>void;onEditWork?:(item:WorkItem,title:string,description:string)=>void;onDeleteWork?:(item:WorkItem)=>void;onUncomplete:(assignmentId:number,periodKey:string)=>void;isAdmin?:boolean;fixedStart?:string;onFixedStart?:(value:string)=>void;employeeView:boolean;tab:"catalog"|"assignments";frequency:FixedFrequency;items:WorkItem[];assignments:WorkAssignment[];completions:WorkCompletion[];employees:Employee[];companies:Company[];form:Record<string,string>;setForm:React.Dispatch<React.SetStateAction<Record<string,string>>>;onAdd:()=>void;onDue:(item:WorkItem,dueDay:number,dueMonth?:number)=>void;onAssign:()=>void;onCatalogAssign:(workDefinitionId:number,companyId:number,employeeId:number)=>void;onComplete:(assignmentId:number,periodKey:string)=>void}){const [creating,setCreating]=useState(false);const [catalogCompanyFilter,setCatalogCompanyFilter]=useState("all");const [catalogEmployeeFilter,setCatalogEmployeeFilter]=useState("all");
  const today=bakuToday();
  // Versiya 2.90: the admin edits a work's name and description in its row.
  const [editingWork,setEditingWork]=useState<{id:number;title:string;description:string}|null>(null);
  const [year,setYear]=useState(today.year);
  const [month,setMonth]=useState(today.month);
  // One company filter for both admin tables: it narrows the company columns as well as the rows.
  const shownCompanies=catalogCompanyFilter==="all"?companies:companies.filter(c=>String(c.id)===catalogCompanyFilter);const assignmentView=employeeView||tab==="assignments";const [catalogWidths,setCatalogWidth]=useSimpleColumnWidths("workcatalog4");const resizeCatalog=useEdgeResize(setCatalogWidth,40);const [periodWidths,setPeriodWidth]=useSimpleColumnWidths("workperiods2");const resizePeriod=useEdgeResize(setPeriodWidth,40);
  // The header and every row are separate grids. Each gets the same explicit min-width (sum of the column widths) instead of the
  // CSS max-content one — max-content counts a long description as one unwrapped line, which widened that row alone and pushed its
  // cells out from under their headers. Only "description" is flexible, so it soaks up spare width identically in every row.
  const colTemplate=(cols:[string,number][],widths:Record<string,number>)=>{const px=cols.map(([key,def])=>widths[key]||def);return {gridTemplateColumns:cols.map(([key],i)=>key==="description"?`minmax(${px[i]}px,1fr)`:`${px[i]}px`).join(" "),minWidth:px.reduce((sum,w)=>sum+w,0)}};
  const catalogColumns=colTemplate([["no",56],["title",260],["description",320],["due",frequency==="weekly"?150:isLongPeriod(frequency)?180:110],...shownCompanies.map(c=>[`c${c.id}`,120] as [string,number]),...(onEditWork?[["actions",170] as [string,number]]:[])],catalogWidths);const selectedCompanies=new Set((form.assignCompanyIds||"").split(",").filter(Boolean).map(Number));const toggleAssignCompany=(id:number,checked:boolean)=>{const next=new Set(selectedCompanies);checked?next.add(id):next.delete(id);setForm({...form,assignCompanyIds:[...next].join(",")})};const filteredCatalogItems=items.filter(item=>(catalogCompanyFilter==="all"&&catalogEmployeeFilter==="all")||assignments.some(a=>a.work_definition_id===item.id&&(catalogCompanyFilter==="all"||String(a.company_id)===catalogCompanyFilter)&&(catalogEmployeeFilter==="all"||String(a.employee_id)===catalogEmployeeFilter)));
  const catalogAllowedEmployees=(companyId:number)=>employees.filter(employee=>(employee.company_ids||"").split(",").filter(Boolean).map(Number).includes(companyId));
  // Versiya 2.94: a quarterly work has a fixed deadline (the 20th of the next quarter's first month) — shown, not picked.
  const dueEditor=(item:WorkItem)=>hasFixedDue(item.frequency)?<span className="matrixuser" title="Rüblük işin son tarixi dəyişmir">{dueLabel(item)}</span>:<label className="catalogdue">{isLongPeriod(item.frequency)&&<select aria-label={`${item.title}: son tarixin ayı`} title="Dövr bitəndən sonra neçənci ay" value={dueMonth(item)} onChange={e=>onDue(item,dueDay(item),Number(e.target.value))}>{MONTH_ORDINALS.map((o,i)=><option key={o} value={i+1}>{o} ay</option>)}</select>}<select aria-label={`${item.title}: son tarix`} value={dueDay(item)} onChange={e=>onDue(item,Number(e.target.value))}>{item.frequency==="weekly"?WEEKDAY_NAMES.map((name,i)=><option key={name} value={i+1}>{name}</option>):Array.from({length:31},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label>;
  // Versiya 2.90: Excel-like filters on both tables, as in the other tables of the program.
  const dueTitle=frequency==="monthly"?"Son tarix (növbəti ay)":frequency==="weekly"?"Son tarix (növbəti həftə)":"Son tarix (dövrdən sonra)";
  const assigneeOf=(item:WorkItem,companyId:number)=>assignments.find(a=>a.work_definition_id===item.id&&a.company_id===companyId)?.employee_name||"";
  const catalogExcelColumns:ExcelColumn<WorkItem>[]=[{key:"title",label:"İşlərin siyahısı",search:i=>i.title},{key:"description",label:"İşin açıqlaması",search:i=>i.description||""},{key:"due",label:dueTitle,search:i=>dueLabel(i),sort:i=>dueDay(i)},...shownCompanies.map(c=>({key:`c${c.id}`,label:c.name,search:(i:WorkItem)=>assigneeOf(i,c.id)}))];
  const catalogCol=Object.fromEntries(catalogExcelColumns.map(c=>[c.key,c]));
  const catalogExcel=useExcelFilters(`workcatalog-${frequency}`,catalogExcelColumns,filteredCatalogItems.filter(item=>item.frequency===frequency));
  const catalogGroup=(freq:string)=>{
    const list=catalogExcel.rows.filter(item=>item.frequency===freq);
    const head=<div className="workmatrixhead" style={catalogColumns}><span {...resizeCatalog("no")}>№</span><span {...resizeCatalog("title")}>{catalogExcel.header(catalogCol.title)}</span><span {...resizeCatalog("description")}>{catalogExcel.header(catalogCol.description)}</span><span {...resizeCatalog("due")}>{catalogExcel.header(catalogCol.due)}</span>{shownCompanies.map(c=><span key={c.id} {...resizeCatalog(`c${c.id}`)}>{catalogExcel.header(catalogCol[`c${c.id}`])}</span>)}{onEditWork&&<span {...resizeCatalog("actions")}>Əməliyyat</span>}</div>;
    if(!list.length)return <div className="workmatrix">{head}<Empty text="Seçimə uyğun sabit iş tapılmadı."/></div>;
    return <div className="workmatrix">{head}{list.map((item,index)=>{const editing=editingWork?.id===item.id;const assigned=assignments.some(a=>a.work_definition_id===item.id);return <article key={item.id} style={catalogColumns}><b className="rownumber">{index+1}</b>{editing?<label className="catalogedit"><Input aria-label="İşin adı" value={editingWork.title} autoFocus onChange={e=>setEditingWork({...editingWork,title:e.target.value})}/></label>:<h3>{item.title}</h3>}{editing?<label className="catalogedit"><Input aria-label="İşin açıqlaması" value={editingWork.description} onChange={e=>setEditingWork({...editingWork,description:e.target.value})}/></label>:<p className="workdescription">{item.description||"—"}</p>}{dueEditor(item)}{shownCompanies.map(c=>{const assigned=assignments.find(a=>a.work_definition_id===item.id&&a.company_id===c.id);const allowedEmployees=catalogAllowedEmployees(c.id);return <label className={assigned?"catalogassignee assignedname":"catalogassignee"} key={c.id}><select aria-label={`${c.name} üçün istifadəçi`} style={assigned?{...personColor(assigned.employee_id),boxShadow:`inset 0 0 0 2px ${personColor(assigned.employee_id).borderColor}`}:undefined} value={assigned?.employee_id||""} onChange={e=>{if(e.target.value)onCatalogAssign(item.id,c.id,Number(e.target.value));else if(assigned&&onCatalogUnassign&&confirm(`“${item.title}” — ${c.name}: iş ${assigned.employee_name} adlı işçidən götürülsün? Onun bu firma üzrə icra qeydləri də silinəcək.`))onCatalogUnassign(item.id,c.id,assigned.employee_id)}}><option value="">Seçin</option>{allowedEmployees.map(employee=><option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>})}{onEditWork&&<div className="catalogactions">{editing?<><button className="inlinecancel" onClick={()=>setEditingWork(null)}>Ləğv et</button><Button disabled={!editingWork.title.trim()} onClick={()=>{onEditWork(item,editingWork.title.trim(),editingWork.description.trim());setEditingWork(null)}}>Yadda saxla</Button></>:<><button className="editcompanybtn" onClick={()=>setEditingWork({id:item.id,title:item.title,description:item.description||""})}>Redaktə et</button>{onDeleteWork&&<button className="deletetaskbtn" disabled={assigned} title={assigned?"Əvvəlcə işi işçilərdən götürün":"Sabit işi sil"} onClick={()=>onDeleteWork(item)}>Sil</button>}</>}</div>}</article>})}</div>;
  };
  // Year table: one row per assignment (work + company + person), one column per month — or, for weekly works, per week of the chosen month.
  const rows=assignments.filter(a=>a.frequency===frequency&&(catalogCompanyFilter==="all"||String(a.company_id)===catalogCompanyFilter)).sort((a,b)=>a.title.localeCompare(b.title,"az")||a.company_name.localeCompare(b.company_name,"az")||a.employee_name.localeCompare(b.employee_name,"az"));
  const showCompany=employeeView?new Set(rows.map(r=>r.company_id)).size>1:catalogCompanyFilter==="all";
  // Columns: weeks of the chosen month, months / quarters / halves of the chosen year, or (yearly) one column per year.
  const periods=frequency==="yearly"?Array.from({length:today.year+2-Math.min(2026,today.year)},(_,i)=>Math.min(2026,today.year)+i).map(y=>({key:`yearly:${y}`,label:String(y),col:`y${y}`})):periodsOf(frequency,year,month).map((period,i)=>({...period,col:frequency==="monthly"?`m${i}`:frequency==="weekly"?`w${i}`:`${frequency[0]}${i}`}));
  const periodColumns=colTemplate([["no",48],["title",240],["description",260],...(showCompany?[["company",150] as [string,number]]:[]),...(employeeView&&!team?[]:[["user",150] as [string,number]]),["due",frequency==="weekly"?130:isLongPeriod(frequency)?130:90],...periods.map(p=>[p.col,frequency==="monthly"?70:frequency==="weekly"?104:frequency==="halfyearly"?140:110] as [string,number])],periodWidths);
  const periodExcelColumns:ExcelColumn<WorkAssignment>[]=[{key:"title",label:"İşlərin siyahısı",search:a=>a.title},{key:"description",label:"İşin açıqlaması",search:a=>a.description||""},{key:"company",label:"Firma",search:a=>a.company_name},{key:"user",label:"İstifadəçi",search:a=>a.employee_name},{key:"due",label:dueTitle,search:a=>dueLabel(a),sort:a=>dueDay(a)}];
  const periodCol=Object.fromEntries(periodExcelColumns.map(c=>[c.key,c]));
  const periodExcel=useExcelFilters(`workperiods-${frequency}`,periodExcelColumns,rows);
  const completedAt=new Map(completions.map(c=>[`${c.work_assignment_id}|${c.period_key}`,c.completed_at]));
  const years=Array.from({length:today.year+2-Math.min(2026,today.year)},(_,i)=>Math.min(2026,today.year)+i);
  const periodCell=(a:WorkAssignment,p:{key:string;label:string})=>{
    const done=completedAt.get(`${a.id}|${p.key}`);
    // Versiya 2.89: periods before the counting start or before the work was assigned are "skipped" (Hesablanmır).
    const state=periodState(a,p.key,done,Date.now(),{start:fixedStart,assignedAt:a.created_at});
    const span=periodWindow(a,p.key);
    const open=state==="active"||state==="overdue";
    // A mark is taken back by the person until the deadline, afterwards only by the admin (the server checks it too).
    const undo=!team&&Boolean(done&&span&&(isAdmin||Date.now()<span.due));
    const hint=state==="skipped"?`${p.label} — hesablanmır (hesablama başlanğıcından və ya işin təyinindən əvvəldir)`:span?`${p.label} — açılır: ${formatBakuDate(span.start)}, son tarix: ${formatBakuDate(span.due-1)}${done?`, icra: ${formatDate(done)}${undo?" — geri götürmək üçün basın":""}`:""}`:p.label;
    return <button type="button" key={p.key} title={hint} aria-label={hint} disabled={team||(!open&&!undo)} className={`periodcell ${state}${undo?" undoable":""}`} onClick={()=>{if(!span)return;if(undo){if(confirm(`"${a.title}" — ${p.label}: icra qeydi geri götürülsün?`))onUncomplete(a.id,p.key)}else if(confirm(`"${a.title}" — ${p.label}: icra edildi kimi işarələnsin?`))onComplete(a.id,p.key)}}>{!done&&state==="overdue"?<><b>Gecikib</b><small>{overdueDays(a,p.key)} gün</small></>:null}</button>;
  };
  const periodGroup=()=>rows.length?<><div className="workmatrix periodmatrix"><div className="workmatrixhead" style={periodColumns}><span {...resizePeriod("no")}>№</span><span {...resizePeriod("title")}>{periodExcel.header(periodCol.title)}</span><span {...resizePeriod("description")}>{periodExcel.header(periodCol.description)}</span>{showCompany&&<span {...resizePeriod("company")}>{periodExcel.header(periodCol.company)}</span>}{(!employeeView||team)&&<span {...resizePeriod("user")}>{periodExcel.header(periodCol.user)}</span>}<span {...resizePeriod("due")}>{periodExcel.header(periodCol.due)}</span>{periods.map(p=><span key={p.key} {...resizePeriod(p.col)}>{p.label}</span>)}</div>{periodExcel.rows.map((a,index)=><article key={a.id} style={periodColumns}><b className="rownumber">{index+1}</b><h3 title={a.title}>{a.title}</h3><p className="workdescription" title={a.description||""}>{a.description||"—"}</p>{showCompany&&<span className="matrixuser" title={a.company_name}>{a.company_name}</span>}{(!employeeView||team)&&<span className="matrixuser" title={a.employee_name}><i className="personchip" style={personColor(a.employee_id)}>{a.employee_name}</i></span>}<span className="matrixuser">{dueLabel(a)}</span>{periods.map(p=>periodCell(a,p))}</article>)}</div><div className="periodlegend"><span><i className="periodcell active"/>Açıqdır — icra etmək vaxtıdır</span><span><i className="periodcell done"/>Vaxtında icra edilib</span><span><i className="periodcell late-done"/>Gecikməklə icra edilib</span><span><i className="periodcell overdue"/>Gecikib</span><span><i className="periodcell future"/>Hələ açılmayıb</span><span><i className="periodcell skipped"/>Hesablanmır</span></div></>:<Empty text={team?"Tabeliyinizdəki əməkdaşlara bu növdə sabit iş təyin edilməyib.":employeeView?"Sizə hələ sabit iş təyin edilməyib.":"Hələ personala sabit iş təyin edilməyib."}/>;
  const frequencyEyebrow=`${FREQUENCY_TITLES[frequency].toLocaleUpperCase("az")} SABİT İŞLƏR`;
  return <section className={`panel pagepanel recurringpage ${frequency}`}><div className="pageactions recurringhead"><div><span className="sectioneyebrow">{frequencyEyebrow}</span><h2>{team?"Əməkdaşlarımın sabit işləri":employeeView?"Mənim sabit işlərim":assignmentView?"Personal sabit işlər":"Sabit işlərin siyahısı"}</h2><p>{team?"Tabeliyinizdəki əməkdaşların sabit işləri — yalnız baxış":employeeView?"Sizə sabit olaraq həvalə edilmiş işlər və firmalar":assignmentView?"Sabit işlərin personal və firmalar üzrə bölgüsü":"Sabit işlərin ümumi siyahısı"}</p></div>{!employeeView&&assignmentView&&<Button onClick={()=>setCreating(v=>!v)}><Plus/>Sabit iş yarat</Button>}</div>{!assignmentView?<><div className="catalogfilters"><label><span>Firma</span><select value={catalogCompanyFilter} onChange={e=>setCatalogCompanyFilter(e.target.value)}><option value="all">Bütün firmalar</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label><span>İstifadəçi</span><select value={catalogEmployeeFilter} onChange={e=>setCatalogEmployeeFilter(e.target.value)}><option value="all">Bütün istifadəçilər</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div><div className="workadd catalogadd"><Input placeholder="Yeni sabit işin adını yazın" value={form.workTitle||""} onChange={e=>setForm({...form,workTitle:e.target.value})}/><Input placeholder="İşin açıqlamasını yazın" value={form.workDescription||""} onChange={e=>setForm({...form,workDescription:e.target.value})}/><Button disabled={!form.workTitle?.trim()} onClick={onAdd}><Plus/>Siyahıya əlavə et</Button></div>{isAdmin&&onFixedStart&&<FixedStartField value={fixedStart} onSave={onFixedStart}/>}{filteredCatalogItems.length?catalogGroup(frequency):<Empty text={items.length?"Seçilmiş filtrlərə uyğun sabit iş tapılmadı.":"Sabit işlərin siyahısı hələ boşdur."}/>}</>:<><div className="periodfilters">{!employeeView&&<label><span>Firma</span><select value={catalogCompanyFilter} onChange={e=>setCatalogCompanyFilter(e.target.value)}><option value="all">Bütün firmalar</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}{frequency!=="yearly"&&<label><span>İl</span><select value={year} onChange={e=>setYear(Number(e.target.value))}>{years.map(y=><option key={y} value={y}>{y}</option>)}</select></label>}{frequency==="weekly"&&<label><span>Ay</span><select value={month} onChange={e=>setMonth(Number(e.target.value))}>{MONTH_NAMES.map((name,i)=><option key={name} value={i}>{name}</option>)}</select></label>}</div>{creating&&<div className="fixedtaskcreate"><div className="fixedtaskfields"><label>Sabit iş<select value={form.assignWorkId||""} onChange={e=>setForm({...form,assignWorkId:e.target.value})}><option value="">Sabit işi seçin</option>{items.filter(i=>i.frequency===frequency).map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></label><label>İstifadəçi<select value={form.assignEmployeeId||""} onChange={e=>setForm({...form,assignEmployeeId:e.target.value})}><option value="">İstifadəçini seçin</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div><div className="fixedcompanies"><b>Firmaları seçin</b><div>{companies.map(c=><label key={c.id}><input type="checkbox" checked={selectedCompanies.has(c.id)} onChange={e=>toggleAssignCompany(c.id,e.target.checked)}/><span>✓</span>{c.name}</label>)}</div></div><div className="fixedtaskactions"><button onClick={()=>setCreating(false)}>Ləğv et</button><Button disabled={!form.assignWorkId||!form.assignEmployeeId||!selectedCompanies.size} onClick={()=>{onAssign();setCreating(false)}}>Sabit işi yarat</Button></div></div>}{periodGroup()}</>}</section>}
// Versiya 2.92: each person keeps one colour wherever fixed works show who has them (by their id, so it never changes).
// Twelve soft colours, none of them red, so a person never looks like "Gecikib"; with more people the colours repeat.
const PERSON_COLORS=[["#dbeafe","#3b82f6","#1e3a8a"],["#dcfce7","#22c55e","#14532d"],["#ffedd5","#f97316","#7c2d12"],["#ede9fe","#8b5cf6","#4c1d95"],["#fce7f3","#ec4899","#831843"],["#ccfbf1","#14b8a6","#134e4a"],["#fef9c3","#eab308","#713f12"],["#e0e7ff","#6366f1","#312e81"],["#cffafe","#06b6d4","#164e63"],["#f5f5f4","#78716c","#292524"],["#ecfccb","#84cc16","#365314"],["#fae8ff","#d946ef","#701a75"]] as const;
const personColor=(id:number)=>{const [bg,border,text]=PERSON_COLORS[Math.abs(Math.trunc(id))%PERSON_COLORS.length];return {background:bg,borderColor:border,color:text}};
// Versiya 2.89: the admin's "Hesablama başlanğıcı" — fixed works count from this day; earlier periods show as "Hesablanmır".
function FixedStartField({value,onSave}:{value:string;onSave:(value:string)=>void}){
  const [draft,setDraft]=useState(value);
  return <div className="fixedstart"><label><span>Hesablama başlanğıcı</span><Input type="date" value={draft} onChange={e=>setDraft(e.target.value)}/></label><Button disabled={!draft||draft===value} onClick={()=>{if(confirm(`Sabit işlər ${formatDateOnly(draft)} tarixindən hesablansın? Ondan əvvəlki dövrlər "Hesablanmır" görünəcək.`))onSave(draft)}}>Yadda saxla</Button><small>Bu tarixdən əvvəlki aylar və həftələr gecikmə sayılmır.</small></div>;
}
// An evaluation is dated by when the task was approved; older approved tasks have no completed_at, so they fall back to created_at.
const evaluatedAt=(t:Task)=>new Date(t.completed_at||t.created_at);
const averageScore=(list:Task[])=>list.length?list.reduce((s,t)=>s+(t.evaluation||0),0)/list.length:null;
const FEW_EVALUATIONS=3;
const EVAL_ROWS_SHOWN=8;
type EvalSortKey="name"|"score"|"trend"|"given"|"late";
function ScoreSparkline({points}:{points:(number|null)[]}){
  const w=84,h=26,step=w/(points.length-1);
  const y=(v:number)=>h-2-(v-1)/9*(h-4);
  const known=points.map((v,i)=>v===null?null:{x:i*step,y:y(v)}).filter((p):p is {x:number;y:number}=>p!==null);
  return <svg className="evalspark" viewBox={`-3 -3 ${w+6} ${h+6}`} aria-hidden="true"><polyline points={known.map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"/>{known.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={i===known.length-1?2.6:1.8} fill="currentColor"/>)}</svg>;
}
// Same bands as scoreTier: 8–10 good, 5–7 middling, 1–4 poor.
const SCORE_GROUPS:{tier:string;label:string;range:string;color:string}[]=[{tier:"",label:"Yaxşı",range:"8–10",color:"#22c55e"},{tier:"mid",label:"Orta",range:"5–7",color:"#f59e0b"},{tier:"low",label:"Pis",range:"1–4",color:"#ef4444"}];
function ScoreGroupsPie({rated}:{rated:Task[]}){
  const [hover,setHover]=useState<string|null>(null);
  const total=rated.length;
  const groups=SCORE_GROUPS.map(g=>({...g,count:rated.filter(t=>scoreTier(t.evaluation||0)===g.tier).length}));
  const pct=(n:number)=>total?Math.round(n/total*100):0;
  const slices=groups.filter(g=>g.count>0).reduce<{g:typeof groups[number];from:number;to:number}[]>((acc,g)=>{const from=acc.length?acc[acc.length-1].to:0;acc.push({g,from,to:from+g.count/total});return acc},[]);
  // Fractions of a turn to an SVG arc; angles start at 12 o'clock and run clockwise.
  const point=(f:number)=>`${21+20*Math.sin(f*2*Math.PI)},${21-20*Math.cos(f*2*Math.PI)}`;
  return <div className="evalhist evalpie"><small>Keyfiyyət payı{total>0&&<b> · {pct(groups[0].count)}% yaxşı</b>}</small>
    {total?<div className="evalpiebody"><svg viewBox="0 0 42 42" role="img" aria-label="Balların Yaxşı, Orta və Pis qruplar üzrə payı">
      {slices.map(({g,from,to})=>{const props={className:`evalslice${hover&&hover!==g.label?" dim":""}`,fill:g.color,stroke:"#fff",strokeWidth:0.6,onMouseEnter:()=>setHover(g.label),onMouseLeave:()=>setHover(null)};const title=<title>{`${g.label} (${g.range}): ${g.count} iş, ${pct(g.count)}%`}</title>;
        return slices.length===1?<circle key={g.label} {...props} cx="21" cy="21" r="20">{title}</circle>:<path key={g.label} {...props} d={`M21,21 L${point(from)} A20,20 0 ${to-from>0.5?1:0} 1 ${point(to)} Z`}>{title}</path>})}
    </svg><div className="evalpielegend">{groups.map(g=><span key={g.label} className={hover===g.label?"on":""} onMouseEnter={()=>setHover(g.label)} onMouseLeave={()=>setHover(null)}><i style={{background:g.color}}/>{g.label} <small>{g.range}</small><b>{g.count}</b><em>{pct(g.count)}%</em></span>)}</div></div>:<p className="evalpieempty">Bu dövrdə qiymət yoxdur</p>}
  </div>;
}
function EvaluationSection({employees,tasks}:{employees:Employee[];tasks:Task[]}){
  const [period,setPeriod]=useState<ViolationPeriod>("3m");
  const [now]=useState(()=>new Date());
  const range=violationPeriodRange(period,now);
  const allRated=tasks.filter(t=>t.evaluation);
  const inPeriod=(t:Task)=>!range||evaluatedAt(t)>=range.start;
  const rated=allRated.filter(inPeriod);
  const teamAvg=averageScore(rated);
  const prevAvg=range?averageScore(allRated.filter(t=>{const at=evaluatedAt(t);return at>=range.prevStart&&at<range.prevEnd})):null;
  const delta=teamAvg!==null&&prevAvg!==null?Math.round((teamAvg-prevAvg)*10)/10:null;
  const histogram=Array.from({length:10},(_,i)=>({score:i+1,count:rated.filter(t=>t.evaluation===i+1).length}));
  const histMax=Math.max(...histogram.map(x=>x.count),1);
  const monthStarts=Array.from({length:7},(_,i)=>new Date(now.getFullYear(),now.getMonth()-5+i,1));
  const [sort,setSort]=useState<{key:EvalSortKey;desc:boolean}>({key:"score",desc:true});
  const [expanded,setExpanded]=useState(false);
  const nowMs=now.getTime();
  const rows=employees.map(e=>{
    const own=tasks.filter(t=>t.employee_id===e.id);
    const ownRated=own.filter(t=>t.evaluation);
    const periodRated=ownRated.filter(inPeriod);
    const monthly=monthStarts.slice(0,6).map((start,i)=>averageScore(ownRated.filter(t=>{const at=evaluatedAt(t);return at>=start&&at<monthStarts[i+1]})));
    const known=monthly.filter((v):v is number=>v!==null);
    // Rated, in progress, new and the rest never overlap, so they stack into one bar of all given tasks; late overlaps them and gets its own column.
    const inProgress=own.filter(t=>t.status==="İcradadır"&&!t.evaluation).length;
    const pending=own.filter(t=>t.status==="Yeni"&&!t.evaluation).length;
    return {e,own,given:own.length,ratedAll:ownRated.length,periodRated:periodRated.length,inProgress,pending,other:own.length-ownRated.length-inProgress-pending,
      late:own.filter(t=>t.status!=="Təsdiqlənib"&&t.status!=="Geri qaytarılıb"&&new Date(t.due_at).getTime()<nowMs).length,
      avg:averageScore(periodRated),monthly,trend:known.length>=2?Math.round((known[known.length-1]-known[known.length-2])*10)/10:null};
  }).filter(r=>r.avg!==null);
  type EvalRow=typeof rows[number];
  const sortValue=(r:EvalRow):number|string|null=>sort.key==="name"?r.e.name:sort.key==="score"?r.avg:sort.key==="trend"?r.trend:sort.key==="given"?r.given:r.late;
  const sorted=[...rows].sort((a,b)=>{
    const x=sortValue(a),y=sortValue(b);
    if(x===null||y===null)return x===y?0:x===null?1:-1;// rows without a value stay at the bottom either way
    const diff=typeof x==="string"&&typeof y==="string"?x.localeCompare(y,"az"):(x as number)-(y as number);
    return (sort.desc?-diff:diff)||(b.avg||0)-(a.avg||0)||b.periodRated-a.periodRated;
  });
  const shown=expanded?sorted:sorted.slice(0,EVAL_ROWS_SHOWN);
  const givenMax=Math.max(...rows.map(r=>r.given),1);
  const sortHeader=(key:EvalSortKey,label:string,className="")=><button type="button" className={`${className}${sort.key===key?" on":""}`} onClick={()=>setSort(s=>s.key===key?{key,desc:!s.desc}:{key,desc:key!=="name"})}>{label}{sort.key===key?(sort.desc?" ↓":" ↑"):""}</button>;
  return <section className="panel evalpanel"><div className="head"><div><h3>Qiymətləndirmə</h3><p>Təsdiqlənmiş işlər üzrə nəticələr</p></div><div className="hrperiods evalperiods">{VIOLATION_PERIODS.map(([key,label])=><button key={key} className={period===key?"on":""} onClick={()=>setPeriod(key)}>{label}</button>)}</div></div>
    {!allRated.length?<Empty text="Hələ qiymətləndirilmiş iş yoxdur."/>:<>
      <div className="evaloverview">
        <div className="evalsummary"><small>Komanda üzrə orta bal</small><div><b className={teamAvg!==null?`scoretext ${scoreTier(teamAvg)}`:""}>{teamAvg!==null?teamAvg.toFixed(1):"—"}</b><span>/10</span></div>
          <p>{rated.length} qiymətləndirilmiş iş</p>
          {range&&<p className="evaldelta">{delta===null?<small>Əvvəlki dövrdə qiymət yoxdur</small>:<><em className={delta>0?"up":delta<0?"down":""}>{delta>0?`+${delta.toFixed(1)} ↑`:delta<0?`−${(-delta).toFixed(1)} ↓`:"dəyişməyib"}</em> <small>{range.prevLabel}</small></>}</p>}
        </div>
        <div className="evalhist"><small>Balların paylanması</small><div className="evalhistbars">{histogram.map(x=><div key={x.score} title={`${x.score} bal: ${x.count} iş`}><small>{x.count||""}</small><span className={scoreTier(x.score)} style={{height:`${x.count?Math.max(x.count/histMax*100,6):0}%`}}/><i>{x.score}</i></div>)}</div></div>
        <ScoreGroupsPie rated={rated}/>
      </div>
      {rows.length?<div className="evaltable">
        <div className="evalthead">{sortHeader("score","#","evalrank")}{sortHeader("name","İşçi")}{sortHeader("score","Bal")}{sortHeader("trend","Son 6 ay","evalhidesm")}{sortHeader("given","Tapşırıqlar")}{sortHeader("late","Gecikən","evalright")}</div>
        {shown.map((r,i)=>{
          const avgNum=r.avg||0;
          const pct=(n:number)=>`${n/givenMax*100}%`;
          const breakdown=`Verilmiş: ${r.given}\nQiymətləndirilmiş: ${r.ratedAll} (seçilmiş dövrdə ${r.periodRated})\nİcrada: ${r.inProgress}\nQalan: ${r.pending}${r.other?`\nDigər (təqdim edilib, yoxlamada və s.): ${r.other}`:""}\nGecikən: ${r.late}`;
          return <div className="evalrow" key={r.e.id}>
            <span className="evalrank">{i+1}</span>
            <span className="evalname" title={r.e.name}>{r.e.name}</span>
            <span className="evalscore"><strong className={`scorepill ${scoreTier(avgNum)}`}>{avgNum.toFixed(1)}</strong>{r.periodRated<FEW_EVALUATIONS&&<b className="evalfew" title={`Seçilmiş dövrdə ${FEW_EVALUATIONS}-dən az qiymətləndirilmiş iş (${r.periodRated}) — orta bal hələ etibarlı deyil`}>⚠</b>}</span>
            <span className="evaltrend evalhidesm" title={`Son 6 ay üzrə aylıq orta bal: ${r.monthly.map((v,m)=>`${SHORT_MONTHS[monthStarts[m].getMonth()]} ${v===null?"—":v.toFixed(1)}`).join(", ")}`}>{r.monthly.some(v=>v!==null)&&<ScoreSparkline points={r.monthly}/>}{r.trend!==null&&<em className={r.trend>0?"up":r.trend<0?"down":""}>{r.trend>0?`↑${r.trend.toFixed(1)}`:r.trend<0?`↓${(-r.trend).toFixed(1)}`:"→0.0"}</em>}</span>
            <span className="evalbar" title={breakdown}><span className="evalbartrack"><span className="rated" style={{width:pct(r.ratedAll)}}/><span className="progress" style={{width:pct(r.inProgress)}}/><span className="pending" style={{width:pct(r.pending)}}/><span className="other" style={{width:pct(r.other)}}/></span><small>{r.ratedAll}/{r.given}</small></span>
            <span className={`evallate${r.late?" warn":""}`}>{r.late}</span>
          </div>;
        })}
        <div className="evalfoot"><span className="evallegend"><i className="rated"/>Qiymətləndirilmiş<i className="progress"/>İcrada<i className="pending"/>Qalan<i className="other"/>Digər</span>{sorted.length>EVAL_ROWS_SHOWN&&<button type="button" onClick={()=>setExpanded(v=>!v)}>{expanded?"Daha az göstər":`Hamısını göstər (${sorted.length-EVAL_ROWS_SHOWN} işçi daha)`}</button>}</div>
      </div>:<Empty text="Bu dövrdə qiymətləndirilmiş iş yoxdur."/>}
    </>}
  </section>;
}
function ChecklistFileButton({busy,onPick}:{busy:boolean;onPick:(files:File[])=>void}){
  const input=useRef<HTMLInputElement>(null);
  return <span className="checklistattach"><button type="button" className="checklistattachbtn" title={`Fayl əlavə et — bir neçə fayl seçmək olar (ən çox ${MAX_FILES}, hər biri 25 MB-a qədər)`} disabled={busy} onClick={()=>input.current?.click()}><Paperclip/>{busy?"Yüklənir...":"Fayl"}</button><input ref={input} type="file" multiple hidden onChange={e=>{const files=[...(e.target.files||[])];e.target.value="";if(files.length)onPick(files)}}/></span>;
}
function historyTone(action:string){
  const a=action.toLocaleLowerCase("az-AZ");
  if(a.includes("silindi")||a.includes("imtina")||a.includes("qəbul edilmədi")||a.includes("ləğv")||a.includes("geri qaytarıldı")||a.includes("götürüldü"))return "bad";
  if(a.includes("tamamlandı")||a.includes("təsdiqləndi")||a.includes("bağlandı")||a.includes("cavablandı"))return "good";
  if(a.includes("işçi")||a.includes("qeydi"))return "share";
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
// Versiya 2.83: a template's folder is not typed — the admin picks a folder that exists on the server.
function FolderField({label,value,set,canPick}:{label:string;value:string;set:(v:string)=>void;canPick:boolean}){
  const [open,setOpen]=useState(false);
  return <div className="field folderfield">{label}<div className="folderfieldrow"><Input value={value} readOnly title={value} placeholder={canPick?"Papka seçilməyib":"Yalnız öz serverdə işləyəndə"}/>{canPick&&<Button type="button" variant="outline" onClick={()=>setOpen(true)}>Papka seç</Button>}{value&&<button type="button" className="folderclear" title="Papkanı götür" aria-label="Papkanı götür" onClick={()=>set("")}><X/></button>}</div>{open&&<FolderPicker start={value} onClose={()=>setOpen(false)} onPick={picked=>{set(picked);setOpen(false)}}/>}</div>;
}
function FolderPicker({start,onClose,onPick}:{start:string;onClose:()=>void;onPick:(path:string)=>void}){
  const [view,setView]=useState<{path:string;parent:string|null;dirs:string[]}|null>(null);
  const [typed,setTyped]=useState(start);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const go=async(dir:string)=>{
    setLoading(true);setError("");
    try{
      const response=await fetch(`/api/documents?folders=${encodeURIComponent(dir)}`);
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Papka açılmadı.");
      setView(body);setTyped(body.path);return true;
    }catch(e){setError(e instanceof Error?e.message:"Papka açılmadı.");return false}
    finally{setLoading(false)}
  };
  // Opens at the folder already chosen; if it is gone, at the server's drives.
  useEffect(()=>{void (async()=>{if(!start||!(await go(start)))await go("")})()},[]);// eslint-disable-line react-hooks/exhaustive-deps
  const child=(name:string)=>!view?.path?name:/[\\/]$/.test(view.path)?view.path+name:`${view.path}${view.path.includes("\\")?"\\":"/"}${name}`;
  return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="businessdialog folderpicker">
    <DialogHeader><DialogTitle>Papka seç</DialogTitle><DialogDescription>Serverdəki papkalar: açmaq üçün papkanın adına basın, lazım olan papkada “Bu papkanı seç” basın.</DialogDescription></DialogHeader>
    <div className="folderpickerpath"><Input value={typed} placeholder="Disk seçin və ya yolu yazın (məs. \\server\paylaşım)" onChange={e=>setTyped(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void go(typed)}}/><Button type="button" variant="outline" disabled={loading} onClick={()=>void go(typed)}>Aç</Button></div>
    <div className="folderpickernav"><button type="button" disabled={loading||!view?.path} onClick={()=>void go("")}>Disklər</button><button type="button" disabled={loading||!view?.path} onClick={()=>void go(view?.parent||"")}>⬆ Yuxarı</button></div>
    {error&&<div className="errorbox">{error}</div>}
    <div className="folderpickerlist">{loading?<span className="nodocument">Açılır...</span>:view&&(view.dirs.length?view.dirs.map(d=><button type="button" key={d} onClick={()=>void go(child(d))}>📁 {d}</button>):<span className="nodocument">{view.path?"Bu papkanın içində başqa papka yoxdur.":"Disk tapılmadı."}</span>)}</div>
    <div className="folderpickerfoot"><small>{view?.path?<>Seçiləcək: <b>{view.path}</b></>:"Əvvəlcə diski açın."}</small><div className="inlineactions"><button type="button" className="inlinecancel" onClick={onClose}>Ləğv et</button><Button type="button" disabled={loading||!view?.path} onClick={()=>view?.path&&onPick(view.path)}>Bu papkanı seç</Button></div></div>
  </DialogContent></Dialog>;
}
function DateTimeField({label,value,set}:{label:string;value:string;set:(v:string)=>void}){
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  const preview=match?`${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}`:"";
  return <label className="field">{label}<div className="datewrap"><Input type="datetime-local" value={value} onChange={e=>set(e.target.value)}/><span className="dateoverlay">{preview||"gg.aa.iiii --:--"}</span></div></label>;
}
function TextField({label,value,set}:{label:string;value:string;set:(v:string)=>void}){return <label className="field">{label}<Textarea value={value} onChange={e=>set(e.target.value)}/></label>}
function SelectCompany({companies,value,set}:{companies:Company[];value:string;set:(v:string)=>void}){return <label className="field">Firma<select value={value} onChange={e=>set(e.target.value)}><option value="">Firma seçin</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
function Empty({text}:{text:string}){return <div className="empty"><ClipboardList/><p>{text}</p></div>}
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
// A step's request to another department (İşlərim → Şöbəyə sorğu). "Qiymətləndirmə gözləyir" already reaches the step as "Bağlandı".
type StepRequestOptions={departments:string[];workTitle:string;workDueAt:string|null;hasCompany:boolean;onSend:(item:ChecklistLikeItem,input:StepRequestInput)=>Promise<boolean>;onAct:(item:ChecklistLikeItem,action:"close"|"reopen"|"withdraw",text?:string)=>Promise<boolean>};
const STEP_REQUEST_CLOSED=["Bağlandı","İmtina edildi"];
const stepRequestTone=(status:string|null|undefined)=>status==="Cavablandı"?"answered":status==="Bağlandı"?"closed":status==="İmtina edildi"?"rejected":status==="Yeni"?"new":"progress";
function ChecklistSection({heading="Mənim iş axınım",onReview,employeeView,checklist,loading,title,setTitle,busy,error,onAdd,onToggle,onRemove,canDelegate=false,delegateEmployees=[],onDelegate,onAttach,onDetach,attachBusyId=null,locked=false,stepsActionable=true,request}:{onReview?:(item:ChecklistLikeItem,approve:boolean,score:number,note:string)=>Promise<boolean>;employeeView:boolean;checklist:ChecklistLikeItem[];loading:boolean;title:string;setTitle:(v:string)=>void;busy:boolean;error:string;onAdd:()=>void;onToggle:(item:ChecklistLikeItem)=>void;onRemove:(item:ChecklistLikeItem)=>void;canDelegate?:boolean;delegateEmployees?:DelegateCandidate[];onDelegate?:(item:ChecklistLikeItem,employeeId:string,comment:string)=>void;onAttach?:(item:ChecklistLikeItem,files:File[])=>void;onDetach?:(item:ChecklistLikeItem,file:FileRef)=>void;attachBusyId?:number|null;locked?:boolean;stepsActionable?:boolean;request?:StepRequestOptions;heading?:string}){
  const [choice,setChoice]=useState<Record<number,string>>({});
  const [pending,setPending]=useState<{itemId:number;employeeId:string}|null>(null);
  const [comment,setComment]=useState("");
  // "Şöbəyə sorğu": the inline form for sending a step to another department, and the "answer is not enough" note.
  const [requestFor,setRequestFor]=useState<number|null>(null);
  const [requestForm,setRequestForm]=useState<StepRequestInput>({department:"",title:"",description:"",dueDate:"",files:[]});
  const [requestBusy,setRequestBusy]=useState(false);
  const [reopenFor,setReopenFor]=useState<number|null>(null);
  const [reopenText,setReopenText]=useState("");
  // Versiya 2.82: whoever handed a step on approves (with a score) or sends back the submitted task here.
  const [review,setReview]=useState<Record<number,{score:string;note:string}>>({});
  const [reviewBusy,setReviewBusy]=useState(false);
  const reviewOf=(id:number)=>review[id]||{score:"10",note:""};
  const sendReview=async(item:ChecklistLikeItem,approve:boolean)=>{if(!onReview)return;const r=reviewOf(item.id);setReviewBusy(true);const ok=await onReview(item,approve,Number(r.score),r.note.trim());setReviewBusy(false);if(ok)setReview(v=>{const next={...v};delete next[item.id];return next})};
  const workDueDate=request?.workDueAt?new Date(request.workDueAt).toLocaleDateString("sv-SE",{timeZone:"Asia/Baku"}):"";
  const openRequestForm=(item:ChecklistLikeItem)=>{setPending(null);setReopenFor(null);setRequestFor(item.id);setRequestForm({department:request?.departments.length===1?request.departments[0]:"",title:`${request?.workTitle||""} — ${item.title}`,description:"",dueDate:workDueDate,files:[]})};
  const sendRequest=async(item:ChecklistLikeItem)=>{if(!request)return;setRequestBusy(true);const ok=await request.onSend(item,requestForm);setRequestBusy(false);if(ok)setRequestFor(null)};
  const act=async(item:ChecklistLikeItem,action:"close"|"reopen"|"withdraw",text?:string)=>{if(!request)return;setRequestBusy(true);const ok=await request.onAct(item,action,text);setRequestBusy(false);if(ok&&action==="reopen"){setReopenFor(null);setReopenText("")}};
  const done=checklist.filter(i=>Boolean(i.done)).length;
  const pct=checklist.length?Math.round((done/checklist.length)*100):0;
  return <div className="checklistsection"><div className="checklisthead"><b>{heading}</b>{checklist.length>0&&<small>{done}/{checklist.length} tamamlandı <em>({pct}%)</em></small>}</div>
    {!stepsActionable&&employeeView&&checklist.length>0&&<small className="completehint">İşi icraya alın ki, addımları ✓ edə və ya işçiyə həvalə edə biləsiniz.</small>}
    {request&&employeeView&&!request.hasCompany&&checklist.length>0&&<small className="completehint">Addımı başqa şöbəyə sorğu kimi göndərmək üçün işin firmasını seçin (Redaktə et).</small>}
    {loading?<small>Yüklənir...</small>:<>
      {checklist.length?<ul className="checklist">{checklist.map(item=>{
        const requestOpen=Boolean(item.request_id)&&!STEP_REQUEST_CLOSED.includes(item.request_status||"");
        const canSendRequest=Boolean(request&&employeeView&&request.departments.length)&&!item.delegated_task_id&&!requestOpen&&!item.done;
        return <li key={item.id} className={item.done?"done":""}>
        <label title={requestOpen?"Cavabı qəbul edəndə ✓ avtomatik qoyulacaq":undefined}><input type="checkbox" checked={Boolean(item.done)} disabled={!employeeView||Boolean(item.delegated_task_id)||requestOpen||!stepsActionable} onChange={()=>onToggle(item)}/><span>{item.title}</span></label>
        <div className="checklistitemactions">
          {(()=>{const files=rowFiles(item.files,item.attachment_key,item.attachment_name,item.attachment_size);const editable=employeeView&&!item.delegated_task_id;return <>{files.map(f=><span key={f.key} className="checklistfile"><a className="checklistfilelink" href={fileHref(f)} title={f.name}><Paperclip/>{f.name}</a>{editable&&onDetach&&<button type="button" className="checklistremove" title="Faylı sil" onClick={()=>onDetach(item,f)}>✕</button>}</span>)}{editable&&onAttach&&files.length<MAX_FILES&&<ChecklistFileButton busy={attachBusyId===item.id} onPick={picked=>onAttach(item,picked)}/>}</>})()}
          {item.delegated_task_id?<><small className="delegatedtag">Həvalə edilib: {item.delegated_employee_name||"—"} — {item.delegated_task_status||"Yeni"}</small>{rowFiles(item.delegated_submission_files,item.delegated_submission_attachment_key,item.delegated_submission_attachment_name).map(f=><span key={f.key} className="checklistfile"><a className="checklistfilelink" href={fileHref(f)} title={f.name}><Paperclip/>{f.name}</a></span>)}</>:<>
          {canDelegate&&!requestOpen&&<span className="checklistdelegate"><select disabled={locked||!stepsActionable} value={choice[item.id]||""} onChange={e=>setChoice({...choice,[item.id]:e.target.value})}><option value="">{delegateEmployees.length?"İşçi seçin":"Tabe işçi yoxdur"}</option>{delegateEmployees.map(emp=><option key={emp.id} value={emp.id}>{emp.name}{emp.position_title?` — ${emp.position_title}`:""}</option>)}</select><button type="button" className="delegatebtn" disabled={locked||!stepsActionable||!choice[item.id]} onClick={()=>{setPending({itemId:item.id,employeeId:choice[item.id]});setComment("")}}>Ver</button></span>}
          {canSendRequest&&<button type="button" className="delegatebtn requestbtn" disabled={locked||!stepsActionable||requestFor===item.id} title="Bu addımı başqa şöbəyə sorğu kimi göndər" onClick={()=>openRequestForm(item)}>Şöbəyə sorğu</button>}
          {employeeView&&!requestOpen&&<button type="button" className="checklistremove" onClick={()=>onRemove(item)}>✕</button>}
          </>}
        </div>
        {item.delegated_task_id&&item.delegated_task_status==="Təqdim edilib"&&employeeView&&onReview&&<div className="steprequest stepreview">
          <div className="steprequesthead"><b>{item.delegated_employee_name||"İşçi"} işi təqdim edib — təsdiqinizi gözləyir</b></div>
          <div className="steprequestactions"><select value={reviewOf(item.id).score} onChange={e=>setReview(v=>({...v,[item.id]:{...reviewOf(item.id),score:e.target.value}}))}>{[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n} bal</option>)}</select><Input value={reviewOf(item.id).note} placeholder="Rəy (geri qaytaranda səbəb məcburidir)" onChange={e=>setReview(v=>({...v,[item.id]:{...reviewOf(item.id),note:e.target.value}}))}/><button type="button" className="inlinecancel" disabled={reviewBusy||!reviewOf(item.id).note.trim()} onClick={()=>void sendReview(item,false)}>Geri qaytar</button><Button type="button" disabled={reviewBusy} onClick={()=>void sendReview(item,true)}>Təsdiqlə</Button></div>
        </div>}
        {item.request_id&&<div className={`steprequest${requestOpen?"":item.request_status==="İmtina edildi"?" rejected":" closed"}`}>
          <div className="steprequesthead"><b>Sorğu → {item.request_department}</b><span className={`steprequeststatus ${stepRequestTone(item.request_status)}`}>{item.request_status}</span>{item.request_assignee_name&&<small>İcraçı: {item.request_assignee_name}</small>}{(item.request_agreed_due_at||item.request_due_at)&&<small>Müddət: {formatDateOnly(item.request_agreed_due_at||item.request_due_at||null)}</small>}</div>
          {item.request_status==="İmtina edildi"&&<small className="steprequestnote">Səbəb: {item.request_reject_reason||"—"}. Addımı başqa şöbəyə və ya yenidən göndərə, ya da işçiyə verə bilərsiniz.</small>}
          {item.request_answer&&<p className="steprequestanswer"><b>Cavab:</b> {item.request_answer}</p>}
          {rowFiles(item.request_answer_files,item.request_answer_key,item.request_answer_name).map(f=><span key={f.key} className="checklistfile"><a className="checklistfilelink" href={fileHref(f)} title={f.name}><Paperclip/>{f.name}</a></span>)}
          {item.request_status==="Cavablandı"&&employeeView&&request&&<small className="steprequestnote">Cavabı yoxlayın: kifayətdirsə qəbul edin — addıma ✓ avtomatik qoyulacaq.</small>}
          {employeeView&&request&&<div className="steprequestactions">
            {item.request_status==="Yeni"&&<button type="button" className="inlinecancel" disabled={requestBusy} onClick={()=>void act(item,"withdraw")}>Sorğunu geri çağır</button>}
            {item.request_status==="Cavablandı"&&<><button type="button" className="inlinecancel" disabled={requestBusy} onClick={()=>{setRequestFor(null);setReopenFor(item.id);setReopenText("")}}>Cavab kifayət deyil</button><Button type="button" disabled={requestBusy} onClick={()=>void act(item,"close")}>Cavabı qəbul et</Button></>}
          </div>}
          {reopenFor===item.id&&<div className="checklistcomment"><b>Nə çatışmır?</b><Textarea autoFocus placeholder="Qarşı şöbəyə nəyin çatışmadığını yazın — sorğu yenidən icraya qayıdacaq." value={reopenText} onChange={e=>setReopenText(e.target.value)}/><div className="checklistcommentactions"><button type="button" className="inlinecancel" onClick={()=>setReopenFor(null)}>Ləğv et</button><Button type="button" disabled={requestBusy||!reopenText.trim()} onClick={()=>void act(item,"reopen",reopenText)}>Yenidən göndər</Button></div></div>}
        </div>}
        {requestFor===item.id&&request&&<div className="checklistcomment steprequestform"><b>Şöbəyə sorğu — “{item.title}”</b>
          <label>Şöbə<select value={requestForm.department} onChange={e=>setRequestForm({...requestForm,department:e.target.value})}><option value="">Şöbəni seçin</option>{request.departments.map(d=><option key={d} value={d}>{d}</option>)}</select></label>
          <label>Mövzu<Input value={requestForm.title} onChange={e=>setRequestForm({...requestForm,title:e.target.value})}/></label>
          <label>İstənilən müddət<Input type="date" value={requestForm.dueDate} onChange={e=>setRequestForm({...requestForm,dueDate:e.target.value})}/></label>
          {workDueDate&&requestForm.dueDate>workDueDate&&<small className="steprequestwarn">⚠ Bu tarix işin son tarixindən ({formatDateOnly(workDueDate)}) gecdir — cavab gec gələrsə, iş gecikə bilər.</small>}
          <label>İzah<Textarea placeholder="Nə lazımdır, hansı formada və nə üçün (istəyə bağlı)" value={requestForm.description} onChange={e=>setRequestForm({...requestForm,description:e.target.value})}/></label>
          <FilePicker label="Fayllar (istəyə bağlı)" files={requestForm.files} onChange={files=>setRequestForm({...requestForm,files})}/>{!requestForm.files.length&&item.attachment_key&&<small>Fayl seçilməsə, addımın faylları ({rowFiles(item.files,item.attachment_key,item.attachment_name).map(f=>f.name).join(", ")}) sorğuya əlavə olunacaq.</small>}
          <div className="checklistcommentactions"><button type="button" className="inlinecancel" disabled={requestBusy} onClick={()=>setRequestFor(null)}>Ləğv et</button><Button type="button" disabled={requestBusy||!requestForm.department||!requestForm.title.trim()} onClick={()=>void sendRequest(item)}>{requestBusy?"Göndərilir...":"Sorğunu göndər"}</Button></div>
        </div>}
        {pending?.itemId===item.id&&<div className="checklistcomment"><b>Şərh — {delegateEmployees.find(emp=>String(emp.id)===pending.employeeId)?.name||"işçi"} üçün əlavə məlumat</b><Textarea autoFocus placeholder="İşçiyə çatdırmaq istədiyiniz əlavə məlumatı yazın (istəyə bağlı). Bu mətn tapşırığın açıqlaması olacaq." value={comment} onChange={e=>setComment(e.target.value)}/><div className="checklistcommentactions"><button type="button" className="inlinecancel" onClick={()=>setPending(null)}>Ləğv et</button><small className="delegatefilenote">{item.attachment_key?<>İşçiyə yalnız bu addımın faylları göndəriləcək: <b>{rowFiles(item.files,item.attachment_key,item.attachment_name).map(f=>f.name).join(", ")}</b></>:"Bu addımda fayl yoxdur — işçiyə fayl getməyəcək."}</small><Button type="button" onClick={()=>{onDelegate?.(item,pending.employeeId,comment);setChoice({...choice,[item.id]:""});setPending(null);setComment("")}}>Tapşırıq kimi göndər</Button></div></div>}
      </li>})}</ul>:<small className="checklistempty">{employeeView?"Bu tapşırığı icra etmək üçün öz addımlarınızı əlavə edin.":"Personal hələ iş axını yaratmayıb."}</small>}
      {employeeView&&<div className="checklistadd"><Input disabled={locked} placeholder={locked?"Bu mərhələdə yeni addım əlavə etmək olmaz":"Yeni addım yazın"} value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();onAdd()}}}/><Button type="button" disabled={locked||busy||!title.trim()} onClick={onAdd}><Plus/>Əlavə et</Button></div>}
      {error&&<div className="errorbox">{error}</div>}
    </>}
  </div>;
}
function initials(name:string){return name.split(" ").slice(0,2).map(x=>x[0]).join("").toUpperCase()}
function avatarNode(avatarKey:string|null|undefined,name:string){return avatarKey?<img src={`/api/file?key=${encodeURIComponent(avatarKey)}`} alt={name}/>:initials(name)}
function formatDate(value:string){const d=new Date(value);const pad=(n:number)=>String(n).padStart(2,"0");return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`}
function toDateTimeLocal(value:string){const d=new Date(value);const pad=(n:number)=>String(n).padStart(2,"0");return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
// Versiya 2.82: the giver approves (score) or sends back the task of a handed-on step; the page lists refresh quietly.
async function reviewHandedOnTask(item:ChecklistLikeItem,approve:boolean,score:number,note:string){
  if(!approve&&!note)throw new Error("Geri qaytarmanın səbəbini yazın.");
  const response=await fetch("/api/data",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"task",id:item.delegated_task_id,status:approve?"Təsdiqlənib":"Geri qaytarılıb",evaluation:score,evaluationNote:note})});
  const body=await response.json();
  if(!response.ok)throw new Error(body.error||"Tapşırıq yenilənmədi.");
  window.dispatchEvent(new Event("app:data-changed"));
}
function formatFileSize(size:number){return size<1024*1024?`${Math.max(1,Math.round(size/1024))} KB`:`${(size/1024/1024).toFixed(1)} MB`}
function formatDateOnly(value:string|null){if(!value)return "—";const m=value.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}.${m[2]}.${m[1]}`:value}
function properCase(value:string){return value.toLocaleLowerCase("az-AZ").replace(/(^|[^\p{L}])(\p{L})/gu,(_,sep,ch)=>sep+ch.toLocaleUpperCase("az-AZ"))}
function awaitingEvaluation(t:Task){return t.status==="Təqdim edilib"&&t.request_status==="Qiymətləndirmə gözləyir"}
function statusClass(t:Task){if(awaitingEvaluation(t))return "awaiting";if(t.status!=="Təsdiqlənib"&&t.status!=="Geri qaytarılıb"&&new Date(t.due_at)<new Date())return "late";if(t.status==="Təsdiqlənib")return "done";if(t.status==="Geri qaytarılıb")return "returned";if(t.status==="Təqdim edilib")return "review";return "progress"}
function displayStatus(t:Task){return t.request_id&&t.status==="Təsdiqlənib"?"Bağlandı":awaitingEvaluation(t)?"Qiymətləndirmə gözləyir":statusClass(t)==="late"?"Gecikib":t.status}
// Overdue never locks a task or work — it only shows "Gecikib" with how many days past the deadline it is.
// Who works on a personal work: the owner (steps kept, not handed over) first, then everyone steps were handed to, then the departments asked.
function workExecutors(w:PersonalWork){
  const list:{key:string;name:string;label:string;own:boolean;dept?:boolean;total:number;done:number}[]=[];
  if(w.own&&w.own.total>0)list.push({key:"own",name:w.owner_name,label:w.owner_name,own:true,total:w.own.total,done:w.own.done});
  for(const s of w.shared||[])list.push({key:`e${s.employee_id}`,name:s.name,label:s.name,own:false,total:s.total,done:s.done});
  // Departments steps were sent to as requests (Şöbəyə sorğu): a step counts as done once its answer is accepted.
  for(const d of w.departments||[])list.push({key:`d${d.department}`,name:d.department,label:d.department,own:false,dept:true,total:d.total,done:d.done});
  return list;
}
function lateDayCount(due:string|null){if(!due)return 0;const diff=Date.now()-new Date(due).getTime();return diff>0?Math.ceil(diff/86400000):0}
function workLate(w:{status:string;due_at:string|null}){return w.status!=="Tamamlanıb"&&lateDayCount(w.due_at)>0}
function LateDays({due}:{due:string|null}){const days=lateDayCount(due);return days?<small className="latedays">{days} gün gecikib</small>:null}
