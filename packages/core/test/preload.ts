import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { cleanProcessEnv } from "./fixture/clean-env"

// Shared by core, server, cli and tui. Run before application imports capture
// roots: a fresh database imports legacy credentials from the data directory.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "shuvcode-test-"))
const env = cleanProcessEnv()
for (const name of Object.keys(process.env)) {
  if (!(name in env)) delete process.env[name]
}
process.env.HOME = home
process.env.USERPROFILE = home
// Bun caches the startup HOME for os.homedir(); changing process.env alone
// still lets ~/ config expansion and SDK credential discovery reach the real home.
os.homedir = () => home
process.env.XDG_DATA_HOME = path.join(home, ".local", "share")
process.env.XDG_CONFIG_HOME = path.join(home, ".config")
process.env.XDG_STATE_HOME = path.join(home, ".local", "state")
process.env.XDG_CACHE_HOME = path.join(home, ".cache")
process.env.OPENCODE_TEST_HOME = home
process.env.OPENCODE_CONFIG_DIR = path.join(home, ".config", "shuvcode")
process.env.OPENCODE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"

const temporary = path.join(home, "tmp")
fs.mkdirSync(temporary)
process.env.TMPDIR = temporary
process.env.TMP = temporary
process.env.TEMP = temporary
