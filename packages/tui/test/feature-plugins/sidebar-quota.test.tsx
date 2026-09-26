/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import os from "os"
import path from "path"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import type { QuotaRpc } from "@shuvcode/quota-plugin/rpc"
import { createStorage } from "../../src/context/storage"
import { SidebarQuota } from "../../src/feature-plugins/sidebar/quota"

const color = RGBA.fromInts(200, 200, 200)

const provider: QuotaRpc.Provider = {
  id: "codex",
  name: "ChatGPT",
  integrationID: "openai",
  status: "ok",
  windows: [{ id: "weekly", label: "Weekly", remaining: 75 }],
  fetched: 0,
}

function context(storage: ReturnType<typeof createStorage>["storage"], list: () => Promise<QuotaRpc.ListOutput>) {
  return {
    theme: {
      text: {
        base: color,
        muted: color,
        feedback: {
          success: { base: color },
          warning: { base: color },
          error: { base: color },
        },
      },
    },
    storage: {
      store: storage.store,
      memory: (key: string, options: { initial: object }) => storage.memory(`plugin.quota.${key}`, options),
    },
    client: { rpc: () => ({ list }) },
    data: {
      on: () => () => undefined,
      session: {
        get: () => undefined,
        root: (id: string) => id,
      },
    },
  } as unknown as Context
}

test("sidebar quota keeps its last snapshot when the sidebar remounts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sidebar-quota-"))
  const result = createStorage(root, "test")
  try {
    const first = await testRender(
      () => (
        <SidebarQuota
          context={context(result.storage, () => Promise.resolve({ providers: [provider] }))}
          sessionID="session"
        />
      ),
      { width: 42, height: 8 },
    )
    try {
      await Bun.sleep(0)
      await first.renderOnce()
      expect(first.captureCharFrame()).toContain("ChatGPT")
    } finally {
      first.renderer.destroy()
    }

    // Navigating to another session remounts the sidebar before the next poll resolves.
    const second = await testRender(
      () => <SidebarQuota context={context(result.storage, () => new Promise(() => undefined))} sessionID="child" />,
      { width: 42, height: 8 },
    )
    try {
      await second.renderOnce()
      const frame = second.captureCharFrame()
      expect(frame).toContain("Quota")
      expect(frame).toContain("ChatGPT")
    } finally {
      second.renderer.destroy()
    }
  } finally {
    result.close()
    await rm(root, { recursive: true, force: true })
  }
})
