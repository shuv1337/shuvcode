import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    const stop = async () => {
      console.log("stopping server...")
      await server.stop()
      process.exit(0)
    }

    process.on("SIGTERM", stop)
    process.on("SIGINT", stop)

    await new Promise(() => {})
  },
})
