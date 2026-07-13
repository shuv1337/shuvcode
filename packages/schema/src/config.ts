export * as Config from "./config.js"

import { ephemeral, inventory } from "./event.js"

const Updated = ephemeral({
  type: "config.updated",
  schema: {},
})

export const Event = { Updated, Definitions: inventory(Updated) }
