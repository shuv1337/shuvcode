/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { builtins } from "../../src/plugin/builtins"
import plugin, { SidebarSubagents } from "../../src/feature-plugins/sidebar/subagents"

const color = RGBA.fromInts(200, 200, 200)

function child(input: {
  id: string
  parentID: string
  agent?: string
  title?: string
  created?: number
  outcome?: "succeeded" | "failed" | "interrupted"
}) {
  return {
    id: input.id,
    parentID: input.parentID,
    agent: input.agent,
    title: input.title,
    outcome: input.outcome,
    time: { created: input.created ?? 0 },
  }
}

function context(input?: {
  sessions?: ReturnType<typeof child>[]
  status?: Record<string, "idle" | "running">
  collapsed?: boolean
  navigate?: (route: unknown) => void
}) {
  const collapsed = { root: input?.collapsed === true }
  return {
    theme: {
      text: {
        base: color,
        muted: color,
        feedback: {
          info: { base: color },
          error: { base: color },
          warning: { base: color },
        },
      },
    },
    storage: {
      store: () => [collapsed, (mutation: (draft: { root: boolean }) => void) => mutation(collapsed)] as const,
    },
    ui: {
      router: {
        navigate: input?.navigate ?? (() => undefined),
      },
    },
    data: {
      session: {
        list: () => input?.sessions ?? [],
        status: (id: string) => input?.status?.[id] ?? "idle",
      },
    },
  } as unknown as Context
}

test("ships as the sidebar subagents builtin", () => {
  expect(plugin.id).toBe("opencode.sidebar.subagents")
  expect(builtins).toContain(plugin)
})

test("sidebar omits subagents when the session has no children", async () => {
  const app = await testRender(
    () => (
      <SidebarSubagents
        context={context({ sessions: [child({ id: "other", parentID: "elsewhere", title: "Other" })] })}
        sessionID="session"
      />
    ),
    { width: 42, height: 8 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Subagents")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar groups direct children by agent and hides nested descendants", async () => {
  const app = await testRender(
    () => (
      <SidebarSubagents
        context={context({
          sessions: [
            child({ id: "general-1", parentID: "session", agent: "general", title: "Diagnose auth", created: 1 }),
            child({
              id: "nested",
              parentID: "general-1",
              agent: "explore",
              title: "Should not list",
              created: 2,
            }),
            child({ id: "explore-1", parentID: "session", agent: "explore", title: "Map routes", created: 3 }),
            child({
              id: "general-2",
              parentID: "session",
              agent: "general",
              title: "@general subagent Search files",
              created: 4,
            }),
          ],
          status: { "general-1": "running" },
        })}
        sessionID="session"
      />
    ),
    { width: 42, height: 12 },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Subagents")
    expect(frame).toContain("General")
    expect(frame).toContain("Explore")
    expect(frame).toContain("Diagnose auth")
    expect(frame).toContain("Map routes")
    expect(frame).toContain("Search files")
    expect(frame).not.toContain("Should not list")
    expect(frame).toContain("●")
    expect(frame).toContain("✓")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar lists a child's own descendants when that session is current", async () => {
  const app = await testRender(
    () => (
      <SidebarSubagents
        context={context({
          sessions: [
            child({ id: "general-1", parentID: "session", agent: "general", title: "Diagnose auth" }),
            child({ id: "nested", parentID: "general-1", agent: "explore", title: "Map routes" }),
          ],
        })}
        sessionID="general-1"
      />
    ),
    { width: 42, height: 8 },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Subagents")
    expect(frame).toContain("Explore")
    expect(frame).toContain("Map routes")
    expect(frame).not.toContain("Diagnose auth")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar collapsed summary shows running and finished counts", async () => {
  const app = await testRender(
    () => (
      <SidebarSubagents
        context={context({
          collapsed: true,
          sessions: [
            child({ id: "a", parentID: "session", agent: "general", title: "One" }),
            child({ id: "b", parentID: "session", agent: "explore", title: "Two" }),
          ],
          status: { a: "running" },
        })}
        sessionID="session"
      />
    ),
    { width: 42, height: 4 },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Subagents")
    expect(frame).toContain("(1 running, 1 done)")
    expect(frame).not.toContain("One")
    expect(frame).not.toContain("Two")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar click navigates to the child session", async () => {
  const navigated: unknown[] = []
  const app = await testRender(
    () => (
      <SidebarSubagents
        context={context({
          sessions: [child({ id: "child-1", parentID: "session", agent: "general", title: "Diagnose auth" })],
          navigate: (route) => navigated.push(route),
        })}
        sessionID="session"
      />
    ),
    { width: 42, height: 8 },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    const row = frame.split("\n").findIndex((line) => line.includes("Diagnose auth"))
    expect(row).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(8, row)
    expect(navigated).toEqual([{ type: "session", sessionID: "child-1" }])
  } finally {
    app.renderer.destroy()
  }
})
