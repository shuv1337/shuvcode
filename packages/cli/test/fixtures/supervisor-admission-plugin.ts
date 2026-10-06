import { Plugin } from "@opencode/plugin"
import path from "node:path"

// Runs inside the real native server, before Session.prompt commits the inbox item.
export default Plugin.define({
  id: "supervisor-admission-barrier",
  async setup(context) {
    const gate = path.resolve(context.location.directory, "../..", "admission-gate")
    await context.session.hook("prompt", async (event) => {
      if (!event.prompt.text.includes("Supervisor task: admission-fixture")) return
      await Bun.write(
        path.join(gate, "entered.json"),
        JSON.stringify({
          sessionID: event.sessionID,
          messageID: event.messageID,
        }),
      )
      while (!(await Bun.file(path.join(gate, "release")).exists())) await Bun.sleep(25)
      await Bun.write(path.join(gate, "released"), event.messageID)
    })
  },
})
