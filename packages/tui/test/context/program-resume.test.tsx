import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { SessionInfo } from "@opencode/client"
import { resolve } from "node:path"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { ProgramResume, createProgramResumeReporter, programResumeReport } from "../../src/context/program-resume"
import { RouteProvider, useRoute } from "../../src/context/route"
import { readResume, token } from "../fixture/program-resume"
import { createApi, createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const cwd = resolve("launch")
const input = { pid: 74877, time: 1795543200, token }

// Byte-for-byte vectors from the OSC 7577 v0.5 Program Resume Protocol examples.
test("encodes all four protocol vectors", () => {
  expect(
    programResumeReport({
      ...input,
      command: { argv: ["nvim", "-S", "/home/user/.local/state/nvim/sessions/8f2c1d.vim"] },
    }),
  ).toBe(
    "\x1b]7577;pid=74877:time=1795543200:argv=bnZpbQ==,LVM=,L2hvbWUvdXNlci8ubG9jYWwvc3RhdGUvbnZpbS9zZXNzaW9ucy84ZjJjMWQudmlt:mac=9dbb99bfb856749a87563839d7ce9062818d78cf25909db93f309e0cd3b1909b\x1b\\",
  )
  expect(programResumeReport(input)).toBe(
    "\x1b]7577;pid=74877:time=1795543200:clear=1:mac=c30603369f98fef581a4098be889175b0c74f0641e49f8b25f4326cb38f97c93\x1b\\",
  )
  expect(programResumeReport({ ...input, command: { argv: ["lazygit"], cwd: "/home/user/src/project" } })).toBe(
    "\x1b]7577;pid=74877:time=1795543200:argv=bGF6eWdpdA==:cwd=L2hvbWUvdXNlci9zcmMvcHJvamVjdA==:mac=35cb909805c380336efd3689a125acc774a9dec8422a1d21492ebec06ca758e1\x1b\\",
  )
  expect(
    programResumeReport({ token, pid: 90412, time: input.time, command: { argv: ["resume-wrap", "ssh", "devbox"] } }),
  ).toBe(
    "\x1b]7577;pid=90412:time=1795543200:argv=cmVzdW1lLXdyYXA=,c3No,ZGV2Ym94:mac=e76149d0ba54a83570ffab0583867dacdfa23928ba9d18604f0badea88b62b65\x1b\\",
  )
})

test("round-trips an absolute executable and literal UTF-8 arguments", () => {
  const argv = [resolve("Shuv Code"), "日本語 🚀", `'double " and single'`, "$(reboot)", "a; b", "`id`", ""]
  const result = readResume(programResumeReport({ ...input, command: { argv, cwd } }))
  expect(result.argv).toEqual(argv)
  expect(result.cwd).toBe(cwd)
})

test.each(["\x00", "\n", "\r", "\x1b", "\x7f", "\u0085", "\u009b", "\ud800", "\udc00"])(
  "clears when argv or cwd contains invalid text (%j)",
  (text) => {
    const clear = programResumeReport(input)
    expect(programResumeReport({ ...input, command: { argv: [`shuvcode${text}`] } })).toBe(clear)
    expect(programResumeReport({ ...input, command: { argv: ["shuvcode", text] } })).toBe(clear)
    expect(programResumeReport({ ...input, command: { argv: ["shuvcode"], cwd: cwd + text } })).toBe(clear)
  },
)

test.each(
  [[], [""], ["."], [".."], ["./run.sh"], ["bin/shuvcode"], ["bin\\shuvcode"], ["-x"]].map((argv) => [argv] as const),
)("clears when the executable is missing or relative (%j)", (argv) => {
  expect(programResumeReport({ ...input, command: { argv } })).toBe(programResumeReport(input))
})

test.each(["", "project"])("clears when cwd is not absolute (%j)", (cwd) => {
  expect(programResumeReport({ ...input, command: { argv: ["shuvcode"], cwd } })).toBe(programResumeReport(input))
})

test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  "does not emit with invalid pid or time (%p)",
  (id) => {
    expect(programResumeReport({ ...input, pid: id })).toBe("")
    expect(programResumeReport({ ...input, time: id })).toBe("")
  },
)

test("accepts 64 arguments and clears on 65", () => {
  const argv = ["shuvcode", ...Array<string>(63).fill("x")]
  expect(readResume(programResumeReport({ ...input, command: { argv } })).argv).toEqual(argv)
  expect(programResumeReport({ ...input, command: { argv: [...argv, "x"] } })).toBe(programResumeReport(input))
})

test("accepts a 2048-byte report and clears on 2049, counting the full framing", () => {
  const argv = ["shuvcode", "x".repeat(1443), "", ""]
  expect(Buffer.byteLength(programResumeReport({ ...input, command: { argv } }))).toBe(2048)
  // An empty argument adds exactly one comma.
  expect(programResumeReport({ ...input, command: { argv: [...argv, ""] } })).toBe(programResumeReport(input))
})

test("a disabled reporter does not read the clock or write", () => {
  const reporter = createProgramResumeReporter(undefined, {
    now: () => {
      throw new Error("Disabled reporting accessed the clock")
    },
  })
  reporter.report("ses_ignored")
  reporter.reemit()
  reporter.clear()
})

test("deduplicates commands, resends on demand, clamps backward time, and clears once", () => {
  let now = 5_500
  const writes: string[] = []
  const reporter = createProgramResumeReporter(
    {
      token,
      cwd,
      command: (id) => (id ? ["shuvcode", "--session", id] : ["shuvcode"]),
      write: (seq) => {
        writes.push(seq)
      },
    },
    { pid: 42, now: () => now },
  )
  reporter.reemit()
  reporter.report("ses_first")
  reporter.report("ses_first")
  now = 9_000
  reporter.reemit()
  now = 8_000
  reporter.report("ses_first", { force: true })
  reporter.report("ses_second")
  reporter.clear()
  reporter.clear()
  reporter.reemit()
  reporter.report()
  expect(writes.map(readResume)).toEqual([
    { pid: 42, time: 5, argv: ["shuvcode", "--session", "ses_first"], cwd, clear: false },
    { pid: 42, time: 9, argv: ["shuvcode", "--session", "ses_first"], cwd, clear: false },
    { pid: 42, time: 9, argv: ["shuvcode", "--session", "ses_first"], cwd, clear: false },
    { pid: 42, time: 9, argv: ["shuvcode", "--session", "ses_second"], cwd, clear: false },
    { pid: 42, time: 9, argv: undefined, cwd: undefined, clear: true },
  ])
})

test("deduplicates unreportable commands and can recover after a write error", () => {
  const writes: string[] = []
  const reporter = createProgramResumeReporter({
    token,
    cwd,
    command: (id) => ["shuvcode", id ?? ""],
    write: (seq) => {
      writes.push(seq)
      if (writes.length === 1) throw new Error("write failed")
    },
  })
  reporter.report("first")
  reporter.report("\x00")
  reporter.report("\n")
  reporter.reemit()
  reporter.report("second")
  expect(writes.map((seq) => readResume(seq).argv)).toEqual([["shuvcode", "first"], undefined, ["shuvcode", "second"]])
})

test("retries rejected reports without caching them, including the newest session on resume", () => {
  const writes: string[] = []
  let accepting = false
  let attempts = 0
  const reporter = createProgramResumeReporter({
    token,
    cwd,
    command: (id) => (id ? ["shuvcode", "--session", id] : ["shuvcode"]),
    write: (seq) => {
      attempts++
      if (!accepting) return false
      writes.push(seq)
      return true
    },
  })
  reporter.report()
  accepting = true
  reporter.report()
  reporter.report()
  accepting = false
  reporter.report("ses_latest")
  accepting = true
  reporter.reemit()
  expect(attempts).toBe(4)
  expect(writes.map((seq) => readResume(seq).argv)).toEqual([["shuvcode"], ["shuvcode", "--session", "ses_latest"]])
})

test("native live writes never fall back to stdout and the final clear uses the post-close writer", () => {
  const live: string[] = []
  const direct: string[] = []
  const reporter = createProgramResumeReporter({
    token,
    cwd,
    command: () => ["shuvcode"],
    write: (seq) => {
      direct.push(seq)
    },
    useNativeSession: true,
  })
  reporter.report()
  const detach = reporter.attachLiveWrite((seq) => {
    live.push(seq)
    return true
  })
  reporter.reemit()
  detach()
  reporter.reemit()
  expect(direct).toEqual([])
  reporter.clear()
  expect(live.map((seq) => readResume(seq).argv)).toEqual([["shuvcode"]])
  expect(direct.map((seq) => readResume(seq).clear)).toEqual([true])
})

test.each(["home", "plugin"] as const)(
  "reports confirmed routes from initial %s without changing launch cwd",
  async (start) => {
    const writes: string[] = []
    const reporter = createProgramResumeReporter({
      token,
      cwd,
      command: (id) => (id ? ["shuvcode", "--session", id] : ["shuvcode"]),
      write: (seq) => {
        writes.push(seq)
      },
    })
    const session = {
      id: "ses_first",
      title: "First",
      projectID: "proj_test",
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
    } satisfies SessionInfo
    const second = { ...session, id: "ses_second", location: { directory: `${directory}/elsewhere` } }
    const response = Promise.withResolvers<Response>()
    const events = createEventStream()
    const calls = createFetch((url, request) => {
      if (url.pathname === "/api/session" && request.method === "POST") return response.promise
      return undefined
    }, events)
    const pluginRoute = { type: "plugin", id: "fixture", name: "test" } as const
    const context = Promise.withResolvers<{ route: ReturnType<typeof useRoute>; data: ReturnType<typeof useData> }>()
    function Probe() {
      context.resolve({ route: useRoute(), data: useData() })
      return <ProgramResume reporter={reporter} />
    }
    const setup = await testRender(
      () => (
        <TestTuiContexts>
          <ClientProvider api={createApi(calls.fetch)}>
            <ConfigProvider config={createTuiResolvedConfig()}>
              <RouteProvider initialRoute={start === "home" ? { type: "home" } : pluginRoute}>
                <DataProvider directory={directory}>
                  <Probe />
                </DataProvider>
              </RouteProvider>
            </ConfigProvider>
          </ClientProvider>
        </TestTuiContexts>
      ),
      { width: 80, height: 24 },
    )
    try {
      const view = await context.promise
      expect(writes).toHaveLength(1)
      view.data.session.remember({ ...session, id: "dummy" })
      view.route.navigate({ type: "session", sessionID: "dummy" })
      view.route.navigate({ type: "session", sessionID: session.id })
      expect(writes).toHaveLength(1)
      view.data.session.remember(session)
      expect(writes).toHaveLength(2)
      view.route.navigate(pluginRoute)
      expect(writes).toHaveLength(2)
      view.route.navigate({ type: "session", sessionID: second.id })
      const creating = view.data.session.create({ id: second.id, location: second.location })
      expect(writes).toHaveLength(2)
      response.resolve(json({ data: second }))
      await creating.request
      expect(writes).toHaveLength(3)
      view.route.navigate({ type: "home" })
      expect(writes.map(readResume).map((report) => [report.argv, report.cwd])).toEqual([
        [["shuvcode"], cwd],
        [["shuvcode", "--session", session.id], cwd],
        [["shuvcode", "--session", second.id], cwd],
        [["shuvcode"], cwd],
      ])
    } finally {
      response.resolve(json({ data: second }))
      setup.renderer.destroy()
      await setup.renderer.closed
    }
    expect(writes).toHaveLength(4)
  },
)
