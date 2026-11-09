// Set roots before application imports capture them, including direct `bun test` runs.
// A fresh database imports legacy credentials from the data directory.
const path = require("node:path")
const home = require("node:fs").mkdtempSync(path.join(require("node:os").tmpdir(), "shuvcode-test-"))
process.env.XDG_DATA_HOME = path.join(home, ".local", "share")
process.env.XDG_CONFIG_HOME = path.join(home, ".config")
process.env.XDG_STATE_HOME = path.join(home, ".local", "state")
process.env.XDG_CACHE_HOME = path.join(home, ".cache")
process.env.OPENCODE_TEST_HOME = home
process.env.OPENCODE_CONFIG_DIR = path.join(home, ".config", "shuvcode")
delete process.env.OPENCODE_CONFIG
delete process.env.OPENCODE_CONFIG_CONTENT

process.env.OPENCODE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"
