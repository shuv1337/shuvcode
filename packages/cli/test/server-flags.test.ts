import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { cleanProcessEnv } from "./fixture/clean-env"
import { ServiceConfig } from "../src/services/service-config"
import { OPENCODE_VERSION } from "../src/version"

const unsupported = [
  ["service", "stop"],
  ["service", "restart"],
  ["service", "start"],
  ["service", "set", "disabled", "false"],
  ["service", "set", "password", "changed"],
  ["service", "set", "port", "12345"],
  ["service", "set", "env", "TEST_FLAG", "changed"],
  ["service", "unset", "disabled"],
  ["service", "unset", "password"],
  ["service", "unset", "port"],
  ["service", "unset", "env", "TEST_FLAG"],
  ["service", "get", "password"],
  ["service", "status"],
  ["pair"],
  ["acp"],
  ["serve", "--port", "0"],
]

describe("global server flags", () => {
  test("documents the client-command support boundary", async () => {
    const root = await fs.mkdtemp(path.join(import.meta.dir, ".server-flags-"))
    try {
      for (const args of [["--help"], ["plugin", "list", "--help"], ["service", "stop", "--help"], ["acp", "--help"]]) {
        const result = await cli(root, args)
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain("GLOBAL FLAGS")
        expect(result.stdout).toContain("Run client commands with a private server")
        expect(result.stdout).toContain("Connect client commands to a server URL")
        expect(result.stdout).toContain(
          "unsupported by service, pair, acp, serve, mcp add, and plugin add/update/remove",
        )
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  test.each(unsupported.map((args) => ({ args })))(
    "rejects connection flags without local effects: $args",
    async ({ args }) => {
      const root = await fs.mkdtemp(path.join(import.meta.dir, ".server-flags-"))
      const owner = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
        stdout: "ignore",
        stderr: "ignore",
      })
      const requests: string[] = []
      using local = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          requests.push(new URL(request.url).pathname)
          return Response.json({ version: OPENCODE_VERSION, pid: owner.pid, urls: [] })
        },
      })
      const config = path.join(root, "config", ServiceConfig.filename())
      const registration = path.join(root, "state", "shuvcode", ServiceConfig.filename())
      const settings = JSON.stringify({
        disabled: false,
        password: "fixture",
        port: local.port,
        env: { TEST_FLAG: "original" },
      })
      const registered = JSON.stringify({
        id: "fixture",
        version: OPENCODE_VERSION,
        url: local.url.toString(),
        pid: owner.pid,
      })
      try {
        await fs.mkdir(path.dirname(config), { recursive: true })
        await fs.mkdir(path.dirname(registration), { recursive: true })
        await Bun.write(config, settings)
        await Bun.write(registration, registered)
        for (const flags of [["--server", local.url.toString()], ["--standalone"], ["--no-standalone"]]) {
          for (const placement of placements(args, flags)) {
            const result = await cli(root, placement)
            expect(result.exitCode).not.toBe(0)
            expect(result.stderr).toContain("does not support --server or --standalone")
            expect(result.stderr).not.toContain("Unrecognized flag")
            expect(await Bun.file(config).text()).toBe(settings)
            expect(await Bun.file(registration).text()).toBe(registered)
            expect(requests).toEqual([])
            expect(owner.exitCode).toBe(null)
          }
        }
      } finally {
        owner.kill("SIGKILL")
        await owner.exited
        await fs.rm(root, { recursive: true, force: true })
      }
    },
    45_000,
  )

  test.each(
    [
      ["mcp", "add", "fixture", "--url", "http://127.0.0.1:1/mcp"],
      ["mcp", "add", "fixture", "--url", "http://127.0.0.1:1/mcp", "--global"],
      ["plugin", "add", "fixture-plugin"],
      ["plugin", "update", "fixture-plugin"],
      ["plugin", "remove", "fixture-plugin"],
    ].map((args) => ({ args })),
  )(
    "rejects connection flags before config writes: $args",
    async ({ args }) => {
      const root = await fs.mkdtemp(path.join(import.meta.dir, ".server-flags-"))
      const original = JSON.stringify({ plugin: ["fixture-plugin"], plugins: ["fixture-plugin"] })
      const files = [path.join(root, "opencode.json"), path.join(root, "config", "opencode.json")]
      try {
        await fs.mkdir(path.join(root, "config"), { recursive: true })
        await Promise.all(files.map((file) => Bun.write(file, original)))
        for (const flags of [["--server", "http://127.0.0.1:1"], ["--standalone"]]) {
          for (const placement of placements(args, flags)) {
            const result = await cli(root, placement)
            expect(result.exitCode).not.toBe(0)
            expect(result.stderr).toContain(`${args[0]} ${args[1]} does not support --server or --standalone`)
            for (const file of files) expect(await Bun.file(file).text()).toBe(original)
          }
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
    45_000,
  )

  test("supported clients still reject mutually exclusive flags across placements", async () => {
    const root = await fs.mkdtemp(path.join(import.meta.dir, ".server-flags-"))
    try {
      for (const args of placements(["plugin", "list"], ["--standalone", "--server", "http://127.0.0.1:1"])) {
        const result = await cli(root, args)
        expect(result.stderr).toContain("--server and --standalone cannot be combined")
        expect(result.stderr).not.toContain("Unrecognized flag")
        expect(result.exitCode).not.toBe(0)
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  test("plugin list uses the requested endpoint across placements", async () => {
    const root = await fs.mkdtemp(path.join(import.meta.dir, ".server-flags-"))
    const requests: string[] = []
    using remote = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url).pathname)
        if (new URL(request.url).pathname === "/api/info")
          return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [] })
        return Response.json({ data: [], context: {} })
      },
    })
    try {
      for (const args of placements(["plugin", "list"], ["--server", remote.url.toString()])) {
        const result = await cli(root, args)
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain("No plugins found")
      }
      expect(requests).toEqual(Array.from({ length: 3 }, () => ["/api/info", "/api/plugin"]).flat())
      expect(await Bun.file(path.join(root, "state", "shuvcode", ServiceConfig.filename())).exists()).toBe(false)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  test("standalone uses a private endpoint across placements instead of a registered service", async () => {
    const root = await fs.mkdtemp(path.join(import.meta.dir, ".server-flags-"))
    const requests: string[] = []
    using local = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url).pathname)
        return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [] })
      },
    })
    const registration = path.join(root, "state", "shuvcode", ServiceConfig.filename())
    const registered = JSON.stringify({
      id: "local",
      version: OPENCODE_VERSION,
      url: local.url.toString(),
      pid: process.pid,
    })
    try {
      await fs.mkdir(path.dirname(registration), { recursive: true })
      await Bun.write(registration, registered)
      for (const args of placements(["api", "GET", "/api/info"], ["--standalone"])) {
        const result = await cli(root, args)
        expect(result.exitCode).toBe(0)
        const info = JSON.parse(result.stdout)
        expect(info.version).toBe(OPENCODE_VERSION)
        expect(info.pid).toBeGreaterThan(0)
        expect(info.pid).not.toBe(process.pid)
        expect(await Bun.file(registration).text()).toBe(registered)
      }
      for (const args of placements(["plugin", "list"], ["--standalone"])) {
        const result = await cli(root, args)
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain("No plugins found")
        expect(await Bun.file(registration).text()).toBe(registered)
      }
      expect(requests).toEqual([])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 45_000)
})

function placements(args: string[], flags: string[]) {
  return [
    [...flags, ...args],
    [args[0]!, ...flags, ...args.slice(1)],
    [...args, ...flags],
  ]
}

async function cli(root: string, args: string[]) {
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: root,
    env: {
      ...cleanProcessEnv(),
      HOME: root,
      OPENCODE_TEST_HOME: root,
      OPENCODE_CONFIG_DIR: path.join(root, "config"),
      OPENCODE_CONFIG_CONTENT: "{}",
      OPENCODE_DISABLE_PROJECT_CONFIG: "true",
      OPENCODE_DISABLE_MODELS_FETCH: "true",
      OPENCODE_DISABLE_FILEWATCHER: "true",
      OPENCODE_DISABLE_FFF: "true",
      OPENCODE_DB: path.join(root, "opencode.db"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_STATE_HOME: path.join(root, "state"),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, exitCode }
  } finally {
    clearTimeout(timeout)
    child.kill("SIGKILL")
    await child.exited
  }
}
