import { expect, test } from "bun:test"
import path from "node:path"
import { buildCommand, input } from "../src/program-resume"

const token = "dummy-token-replace-me"
const cwd = path.resolve("launch")
const ambient = { token, cwd, isTTY: true, bin: "shuvcode", env: {} }

test("builds an allowlisted command from the package name, mode, and confirmed session", () => {
  expect(buildCommand({ bin: "shuvcode" })).toEqual(["shuvcode"])
  expect(buildCommand({ bin: "shuvcode", standalone: true, auto: true }, "ses_test")).toEqual([
    "shuvcode",
    "--standalone",
    "--auto",
    "--session",
    "ses_test",
  ])
  expect(buildCommand({ bin: "shuvcode-node", server: "https://example.test:4096/" }, "ses_test")).toEqual([
    "shuvcode-node",
    "--server",
    "https://example.test:4096",
    "--session",
    "ses_test",
  ])
  const flags = { prompt: "private text", continue: true, model: "one/two", auto: true }
  const resume = input(flags, ambient)
  expect(resume?.cwd).toBe(cwd)
  expect(resume?.useNativeSession).toBe(true)
  expect(resume?.command("ses_test")).toEqual(["shuvcode", "--auto", "--session", "ses_test"])
  expect(input(flags, { ...ambient, write: () => {} })?.useNativeSession).toBe(false)
})

test.each([
  "https://user@example.test",
  "https://:password@example.test",
  "https://user:password@example.test",
  "https://example.test/?token=secret",
  "https://example.test/#secret",
  "file:///tmp/server",
  "not a URL",
  "",
])("does not report a command for unsafe explicit server %j", (server) => {
  expect(buildCommand({ bin: "shuvcode", server }, "ses_test")).toEqual([])
})

test.each([
  undefined,
  "",
  "a".repeat(21),
  "a".repeat(65),
  ...[" ", "\t", "\n", "\u001b", "\u009b", "\u00a0", ".", "+", "=", "é"].map((char) => token + char),
])("does not enable reporting for invalid token %j", (token) => {
  expect(input({}, { ...ambient, token })).toBeUndefined()
})

test.each([22, 64])("enables reporting for a %p-character URL-safe token", (length) => {
  expect(input({}, { ...ambient, token: "A1_-".padEnd(length, "a") })).toBeDefined()
})

test("does not enable source builds or non-TTY output", () => {
  expect(input({}, { ...ambient, isTTY: false })).toBeUndefined()
  expect(input({}, { ...ambient, isTTY: undefined })).toBeUndefined()
  expect(input({}, { ...ambient, bin: undefined })).toBeUndefined()
})

test.each(["OPENCODE_DRIVE", "OPENCODE_STORY", "OPENCODE_ROUTE"])(
  "does not enable reporting when %s is set",
  (name) => {
    expect(input({}, { ...ambient, env: { [name]: "1" } })).toBeUndefined()
    expect(input({}, { ...ambient, env: { [name]: "" } })).toBeUndefined()
  },
)

test("strips the token before child processes and omits it from forwarded session env", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
        import "./src/program-resume"
        import { Env } from "./src/env"
        import { spawnSync } from "node:child_process"
        const local = Object.hasOwn(process.env, "OSC7577_TOKEN")
        const child = spawnSync(process.execPath, ["-p", 'Object.hasOwn(process.env, "OSC7577_TOKEN")'], { encoding: "utf8" })
        if (child.status !== 0) throw new Error(child.stderr)
        process.env.OSC7577_TOKEN = "reintroduced-token"
        console.log(JSON.stringify({ local, child: child.stdout.trim(), forwarded: Object.hasOwn(Env.session(), "OSC7577_TOKEN") }))
      `,
    ],
    {
      cwd: path.join(import.meta.dir, ".."),
      env: { ...process.env, OSC7577_TOKEN: token },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const output = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(output[1]).toBe("")
  expect(output[2]).toBe(0)
  expect(JSON.parse(output[0])).toEqual({ local: false, child: "false", forwarded: false })
})

test("production code avoids Bun.spawn's startup environment snapshot", async () => {
  // Bun 1.4.4 inherits the original token by default even after deletion from process.env.
  // Colocated tests aren't part of the CLI runtime and may use Bun.spawn.
  const root = path.resolve(import.meta.dir, "../..")
  const source = new Bun.Glob("{*,plugins/*}/src/**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}")
  const member = /\bBun\s*(?:\.\s*spawn(?:Sync)?\b|\[\s*["']spawn(?:Sync)?["']\s*\])/
  const binding = /\{[^{}]*\bspawn(?:Sync)?\b[^{}]*\}\s*(?:=\s*Bun\b|from\s*["']bun["'])/
  const calls: string[] = []
  for await (const file of source.scan({ cwd: root })) {
    if (/\.(?:test|spec|fixture)\.[^.]+$/.test(file)) continue
    // Only colocated tests import this Electron launcher, which also supplies an explicit env.
    if (file.replaceAll("\\", "/") === "gui-plugins/src/browser/electron-run.ts") continue
    const text = await Bun.file(path.join(root, file)).text()
    if (member.test(text) || binding.test(text)) calls.push(file)
  }
  expect(calls).toEqual([])
})
