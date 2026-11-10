import fs from "fs/promises"
import path from "path"
import { nodeBinDirectory, prependNodeBin } from "./node-bin"
import { tmpdir } from "../test/fixture/tmpdir"
import { cleanProcessEnv } from "../test/fixture/clean-env"

// Resolve node before the child env below replaces HOME and XDG_STATE_HOME.
const nodeBin = await nodeBinDirectory(process.env)

await using directory = await tmpdir("oc-")
const home = directory.path
const temporary = path.join(home, "tmp")
await fs.mkdir(temporary)

const environment = prependNodeBin(
  {
    ...cleanProcessEnv(),
    HOME: home,
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    OPENCODE_CONFIG_DIR: path.join(home, ".config", "shuvcode"),
    OPENCODE_CONFIG: undefined,
    OPENCODE_CONFIG_CONTENT: undefined,
    TMPDIR: temporary,
    ...(process.platform === "win32" ? { USERPROFILE: home, TMP: temporary, TEMP: temporary } : {}),
  },
  nodeBin,
)

const child = Bun.spawn({
  // The 30s default timeout matches cli and tui; npm.test's Git package installs ran past Bun's 5s default on Windows.
  cmd: [process.execPath, "test", "--only-failures", "--timeout=30000", ...process.argv.slice(2)],
  env: environment,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
const interrupt = () => child.kill("SIGINT")
const terminate = () => child.kill("SIGTERM")
process.once("SIGINT", interrupt)
process.once("SIGTERM", terminate)
const result = await child.exited
process.off("SIGINT", interrupt)
process.off("SIGTERM", terminate)

process.exitCode = result
