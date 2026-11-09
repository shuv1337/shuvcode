import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { Global } from "@opencode/util/global"

describe("Core test environment", () => {
  test("disables public npm security audits", () => {
    expect(process.env.NPM_CONFIG_AUDIT).toBe("false")
  })

  test("isolates global home and XDG roots", () => {
    const home = process.env.OPENCODE_TEST_HOME
    expect(home).toBeDefined()
    if (!home) return

    // The runner isolates HOME/TMPDIR; the preload creates fresh app roots within TMPDIR.
    expect(process.env.HOME).toBe(os.homedir())
    expect(home).toStartWith(path.join(os.tmpdir(), "shuvcode-test-"))
    expect(Global.Path.home).toBe(home)
    expect(Global.Path.config).toBe(path.join(home, ".config", "shuvcode"))
    expect(Global.Path.data).toBe(path.join(home, ".local", "share", "shuvcode"))
    expect(Global.Path.cache).toBe(path.join(home, ".cache", "shuvcode"))
    expect(Global.Path.state).toBe(path.join(home, ".local", "state", "shuvcode"))
    expect(os.tmpdir()).toBe(path.join(os.homedir(), "tmp"))
    expect(process.env.OPENCODE_CONFIG_DIR).toBe(Global.Path.config)
    expect(process.env.OPENCODE_CONFIG).toBeUndefined()
    expect(process.env.OPENCODE_CONFIG_CONTENT).toBeUndefined()
    expect(process.env.AWS_REGION).toBeUndefined()
    expect(process.env.GOOGLE_VERTEX_PROJECT).toBeUndefined()
    expect(process.env.NPM_CONFIG_REGISTRY).toBeUndefined()
    expect(process.env.UIDOTSH_AUTHORIZATION).toBeUndefined()
    if (process.env.RECORD !== "true") expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })
})
