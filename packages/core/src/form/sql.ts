import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Form } from "@opencode-ai/schema/form"
import { Timestamps } from "../database/schema.sql.js"

// No session foreign key: MCP elicitation still uses the temporary "global" owner.
export const FormRequestTable = sqliteTable(
  "form_request",
  {
    id: text().$type<Form.ID>().primaryKey(),
    session_id: text().notNull(),
    directory: text().notNull(),
    workspace_id: text(),
    owner_generation: text().notNull(),
    request: text({ mode: "json" }).$type<Form.Info>().notNull(),
    status: text().$type<Form.State["status"]>().notNull(),
    state: text({ mode: "json" }).$type<Form.State>().notNull(),
    response_id: text(),
    ...Timestamps,
  },
  (table) => [index("form_request_retention_idx").on(table.status, table.time_updated)],
)
