/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { createStore, produce } from "solid-js/store"
import { SidebarContext } from "../../src/feature-plugins/sidebar/context"

function context(options?: { cost?: number; tokens?: number; limit?: number; collapsed?: boolean }) {
  const color = RGBA.fromInts(200, 200, 200)
  const [collapsed, setCollapsed] = createStore({ root: options?.collapsed === true })
  return {
    theme: { text: { base: color, muted: color } },
    storage: {
      store: () =>
        [
          collapsed,
          (mutation: (draft: { root: boolean }) => void) => {
            setCollapsed(produce(mutation))
            return Promise.resolve()
          },
        ] as const,
    },
    data: {
      session: {
        get: () => ({ location: { directory: "/workspace" } }),
        cost: () => options?.cost ?? 0,
        message: {
          list: () =>
            options?.tokens
              ? [
                  {
                    id: "message",
                    type: "assistant",
                    model: { providerID: "provider", id: "model" },
                    tokens: {
                      input: options.tokens,
                      output: 0,
                      reasoning: 0,
                      cache: { read: 0, write: 0 },
                    },
                  },
                ]
              : [],
        },
      },
      location: {
        model: {
          list: () =>
            options?.limit
              ? [{ providerID: "provider", id: "model", limit: { context: options.limit } }]
              : [],
        },
      },
    },
  } as unknown as Context
}

test("sidebar omits context before usage is available", async () => {
  const app = await testRender(() => <SidebarContext context={context()} sessionID="session" />, {
    width: 42,
    height: 8,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Context")
    expect(app.captureCharFrame()).not.toContain("Not measured")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar shows available context usage", async () => {
  const app = await testRender(() => <SidebarContext context={context({ tokens: 1234 })} sessionID="session" />, {
    width: 42,
    height: 8,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Context")
    expect(app.captureCharFrame()).toContain("1,234 tokens")
  } finally {
    app.renderer.destroy()
  }
})

test("collapsed context shows a compact token count and percent", async () => {
  const app = await testRender(
    () => (
      <SidebarContext
        context={context({ tokens: 308_000, limit: 500_000, collapsed: true, cost: 19.35 })}
        sessionID="session"
      />
    ),
    { width: 42, height: 8 },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Context")
    expect(frame).toContain("308k 62%")
    expect(frame).not.toContain("tokens")
    expect(frame).not.toContain("spent")
  } finally {
    app.renderer.destroy()
  }
})

test("clicking the context header collapses the detail", async () => {
  const app = await testRender(
    () => (
      <SidebarContext context={context({ tokens: 308_000, limit: 500_000, cost: 19.35 })} sessionID="session" />
    ),
    { width: 42, height: 8 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("308,000 tokens")
    const row = app.captureCharFrame().split("\n").findIndex((line) => line.includes("Context"))
    expect(row).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(2, row)
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("308k 62%")
    expect(frame).not.toContain("tokens")
    expect(frame).not.toContain("spent")
  } finally {
    app.renderer.destroy()
  }
})
