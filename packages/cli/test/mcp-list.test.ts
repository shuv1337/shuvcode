import { expect, test } from "bun:test"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { OpenCode, type PluginInfo } from "@opencode/client"
import { waitForMcp } from "../src/services/mcp-startup"
import { OPENCODE_VERSION } from "../src/version"
import { it } from "../../core/test/lib/effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { isolatedEnv } from "./fixture/environment"

const active: PluginInfo = {
  id: "opencode.config.mcp",
  source: { type: "builtin" },
  features: { server: true },
  state: { status: "active" },
}

it.effect("waits for the config MCP plugin, not just any loaded plugin", () =>
  Effect.gen(function* () {
    let reads = 0
    const client = OpenCode.make({
      baseUrl: "http://fixture",
      fetch: Object.assign(
        async (request: RequestInfo | URL) => {
          if (new URL(new Request(request).url).pathname === "/api/config") return Response.json([])
          reads++
          return Response.json({
            location: { directory: "/fixture" },
            data: reads === 1 ? [{ ...active, id: "opencode.config.agent" }] : [active],
          })
        },
        { preconnect: fetch.preconnect },
      ),
    })
    const fiber = yield* waitForMcp(client, "/fixture").pipe(Effect.forkChild({ startImmediately: true }))
    yield* TestClock.adjust("25 millis")
    yield* Fiber.join(fiber)
    expect(reads).toBe(2)
  }),
)

it.effect("a startup timeout cannot be mistaken for no configured servers", () =>
  Effect.gen(function* () {
    const client = OpenCode.make({
      baseUrl: "http://fixture",
      fetch: Object.assign(
        async (request: RequestInfo | URL) =>
          Response.json(
            new URL(new Request(request).url).pathname === "/api/config"
              ? []
              : { location: { directory: "/fixture" }, data: [] },
          ),
        { preconnect: fetch.preconnect },
      ),
    })
    const fiber = yield* waitForMcp(client, "/fixture").pipe(
      Effect.result,
      Effect.forkChild({ startImmediately: true }),
    )
    yield* TestClock.adjust("6 seconds")
    const result = yield* Fiber.join(fiber)
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(String(result.failure)).toContain("still loading")
  }),
)

test.each([{ args: ["models"] }, { args: ["debug", "config"] }, { args: ["run", "--format", "json", "hello"] }])(
  "%j reports configuration diagnostics on stderr without executing with defaults",
  async (input) => {
    await using root = await tmpdir()
    const requests: string[] = []
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        const route = new URL(request.url).pathname
        requests.push(route)
        if (route === "/api/info")
          return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: root.path } })
        if (route === "/api/config")
          return Response.json([
            {
              type: "document",
              info: {},
              experimental: {
                diagnostics: [
                  {
                    source: "/config/opencode.jsonc",
                    path: "$.snapshots",
                    line: 2,
                    column: 16,
                    message: "Skipped invalid setting: Expected boolean",
                  },
                ],
              },
            },
          ])
        return new Response(null, { status: 500 })
      },
    })
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        path.join(import.meta.dir, "../src/index.ts"),
        ...input.args,
        "--server",
        server.url.toString(),
      ],
      {
        cwd: root.path,
        env: isolatedEnv(root.path),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(stderr).toContain("/config/opencode.jsonc:2:16")
    expect(stderr).toContain("Expected boolean")
    expect(code).toBe(1)
    expect(requests).toEqual(["/api/info", "/api/config"])
    if (input.args[0] === "run") expect(JSON.parse(stdout).type).toBe("error")
    if (input.args[0] === "debug") expect(JSON.parse(stdout)[0].experimental.diagnostics).toHaveLength(1)
  },
)

test.each([
  [
    "configured",
    JSON.stringify({ mcp: { servers: { fixture: { type: "local", command: ["not-executed"], disabled: true } } } }),
  ],
  ["empty", "{}"],
  ["malformed", '{\n  "mcp": {\n}'],
  ["schema", '{\n  "snapshots": "private-secret"\n}'],
] as const)("mcp list reports %s config on a cold standalone server", async (kind, content) => {
  await using root = await tmpdir()
  const file = path.join(root.path, "config", "opencode.json")
  await Bun.write(file, content)
  const child = Bun.spawn(
    [process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), "mcp", "list", "--standalone"],
    {
      cwd: root.path,
      env: isolatedEnv(root.path),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (kind === "configured" || kind === "empty") {
    expect({ stderr, code }).toEqual({ stderr: "", code: 0 })
    expect(stdout).toContain(kind === "configured" ? "fixture" : "No MCP servers configured")
    if (kind === "configured") expect(stdout).toContain("disabled")
    return
  }
  expect(stderr).toContain(file)
  expect(stderr).toContain(kind === "malformed" ? "CloseBraceExpected" : "Expected boolean")
  expect(stderr).not.toContain("private-secret")
  expect(code).toBe(1)
  expect(stdout).not.toContain("No MCP servers configured")
})
