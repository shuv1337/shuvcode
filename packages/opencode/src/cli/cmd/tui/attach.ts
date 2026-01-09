import { cmd } from "../cmd"
import { tui } from "./app"

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running opencode server",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "http://localhost:4096",
        demandOption: true,
      })
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      }),
  handler: async (args) => {
    if (args.dir) process.chdir(args.dir)
    // Always pass client's cwd so attached sessions operate in the client's directory
    // This ensures file autocomplete, theme discovery, and exports use the correct directory
    const directory = process.cwd()
    await tui({
      url: args.url,
      args: { sessionID: args.session },
      directory,
    })
  },
})
