import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Permission } from "@opencode-ai/schema/permission"
import type { Project } from "@opencode-ai/schema/project"
import type { Workspace } from "@opencode-ai/schema/workspace"
import { Timestamps } from "../database/schema.sql.js"
import { ProjectTable } from "../project/sql.js"
import type { PermissionSaved } from "./saved.js"

export const PermissionTable = sqliteTable(
  "permission",
  {
    id: text().$type<PermissionSaved.ID>().primaryKey(),
    project_id: text()
      .$type<Project.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    action: text().notNull(),
    resource: text().notNull(),
    ...Timestamps,
  },
  (table) => [uniqueIndex("permission_project_action_resource_idx").on(table.project_id, table.action, table.resource)],
)

export const PermissionRequestTable = sqliteTable(
  "permission_request",
  {
    id: text().$type<Permission.ID>().primaryKey(),
    directory: text().notNull(),
    workspace_id: text().$type<Workspace.ID>(),
    generation: text().notNull(),
    request: text({ mode: "json" }).$type<Permission.Request>().notNull(),
    agent: text().$type<Agent.ID>(),
    status: text().$type<Permission.State["status"]>().notNull(),
    state: text({ mode: "json" }).$type<Permission.State>().notNull(),
    response_id: text(),
    ...Timestamps,
  },
  (table) => [
    index("permission_request_location_idx").on(table.directory, table.workspace_id),
    index("permission_request_retention_idx").on(table.status, table.time_updated),
  ],
)
