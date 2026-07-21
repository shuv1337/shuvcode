import type { Database } from "@opencode-ai/core/database/database"
import type { ModelsDev } from "@opencode-ai/core/models-dev"

export interface ServerOptions {
  readonly hostname?: string
  readonly port?: number
  readonly password?: string
  readonly database?: Database.Options
  readonly models?: ModelsDev.Options
}
