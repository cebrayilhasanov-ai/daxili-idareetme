import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  position: text("position").notNull().default("Personal"),
  email: text("email"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  voen: text("voen"),
  manager: text("manager"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const recurringTasks = sqliteTable("recurring_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  title: text("title").notNull(),
  description: text("description"),
  dueDay: integer("due_day").notNull().default(25),
  frequency: text("frequency").notNull().default("monthly"),
  weekday: integer("weekday"),
  dueTime: text("due_time").notNull().default("14:00"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const workCatalog = sqliteTable("work_catalog", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  frequency: text("frequency").notNull().default("monthly"),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  createdAt: text("created_at").notNull(),
});

export const workCatalogCompanies = sqliteTable("work_catalog_companies", {
  workItemId: integer("work_item_id").notNull().references(() => workCatalog.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.workItemId, table.companyId] })]);

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  companyId: integer("company_id").references(() => companies.id),
  recurringTaskId: integer("recurring_task_id").references(() => recurringTasks.id),
  periodKey: text("period_key"),
  title: text("title").notNull(),
  description: text("description"),
  dueAt: text("due_at").notNull(),
  status: text("status").notNull().default("Yeni"),
  evaluation: integer("evaluation"),
  evaluationNote: text("evaluation_note"),
  employeeStatusChanged: integer("employee_status_changed", { mode: "boolean" }).notNull().default(false),
  attachmentKey: text("attachment_key"),
  attachmentName: text("attachment_name"),
  attachmentSize: integer("attachment_size"),
  attachmentType: text("attachment_type"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("tasks_recurring_period_unique").on(table.recurringTaskId, table.periodKey),
]);

export const taskChecklistItems = sqliteTable("task_checklist_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const personalWorks = sqliteTable("personal_works", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  companyId: integer("company_id").references(() => companies.id),
  dueAt: text("due_at"),
  status: text("status").notNull().default("Yeni"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
  attachmentKey: text("attachment_key"),
  attachmentName: text("attachment_name"),
  attachmentSize: integer("attachment_size"),
  attachmentType: text("attachment_type"),
});

export const personalWorkChecklistItems = sqliteTable("personal_work_checklist_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personalWorkId: integer("personal_work_id").notNull().references(() => personalWorks.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const chatThreads = sqliteTable("chat_threads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  name: text("name"),
  directKey: text("direct_key"),
  createdBy: integer("created_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("chat_threads_direct_key_unique").on(table.directKey)]);

export const chatMembers = sqliteTable("chat_members", {
  threadId: integer("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(),
  lastReadMessageId: integer("last_read_message_id").notNull().default(0),
  joinedAt: text("joined_at").notNull(),
}, (table) => [primaryKey({ columns: [table.threadId, table.userId] })]);

export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  threadId: integer("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  senderUserId: integer("sender_user_id").notNull(),
  body: text("body"),
  attachmentKey: text("attachment_key"),
  attachmentName: text("attachment_name"),
  attachmentSize: integer("attachment_size"),
  attachmentType: text("attachment_type"),
  createdAt: text("created_at").notNull(),
});

export const workDefinitions = sqliteTable("work_definitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  frequency: text("frequency").notNull().default("monthly"),
  createdAt: text("created_at").notNull(),
});

export const workAssignments = sqliteTable("work_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workDefinitionId: integer("work_definition_id").notNull().references(() => workDefinitions.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  companyId: integer("company_id").notNull().references(() => companies.id),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("work_assignments_unique").on(table.workDefinitionId, table.employeeId, table.companyId)]);

export const workDefinitionCompanies = sqliteTable("work_definition_companies", {
  workDefinitionId: integer("work_definition_id").notNull().references(() => workDefinitions.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.workDefinitionId, table.companyId] })]);

export const workAssignmentCompletions = sqliteTable("work_assignment_completions", {
  workAssignmentId: integer("work_assignment_id").notNull().references(() => workAssignments.id, { onDelete: "cascade" }),
  periodKey: text("period_key").notNull(),
  completedAt: text("completed_at").notNull(),
}, (table) => [primaryKey({ columns: [table.workAssignmentId, table.periodKey] })]);
