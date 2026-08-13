import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  piLevel: text("pi_level", { enum: ["lead_pi", "co_pi", "sub_pi"] }).notNull(),
  department: text("department").notNull().default("超声科"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("organizations_name_unique").on(table.name)]);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["platform_admin", "organization_admin", "quality_reviewer", "uploader"] }).notNull(),
  organizationId: text("organization_id").references(() => organizations.id),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("users_email_unique").on(table.email), index("users_org_idx").on(table.organizationId)]);

export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  createdBy: text("created_by").references(() => users.id),
  age: integer("age").notNull(),
  diagnosis: text("diagnosis").notNull(),
  examDate: text("exam_date").notNull(),
  menopauseStatus: text("menopause_status").notNull(),
  lesionSide: text("lesion_side").notNull(),
  firstOnset: integer("first_onset", { mode: "boolean" }).notNull(),
  ca125: integer("ca125").notNull(),
  pathology: text("pathology").notNull(),
  completeness: integer("completeness").notNull().default(0),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("cases_org_idx").on(table.organizationId), index("cases_status_idx").on(table.status)]);

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  uploadedBy: text("uploaded_by").references(() => users.id),
  category: text("category").notNull(),
  objectKey: text("object_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  reviewStatus: text("review_status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("uploads_case_idx").on(table.caseId), index("uploads_org_idx").on(table.organizationId), uniqueIndex("uploads_object_key_unique").on(table.objectKey)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").references(() => users.id),
  organizationId: text("organization_id").references(() => organizations.id),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("audit_org_idx").on(table.organizationId), index("audit_target_idx").on(table.targetType, table.targetId)]);

export const sharedCaseState = sqliteTable("shared_case_state", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull(),
});
