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

    expect(process.env.HOME).toBe(home)
    expect(os.homedir()).toBe(home)
    expect(path.basename(home)).toStartWith("shuvcode-test-")
    expect(Global.Path.home).toBe(home)
    expect(Global.Path.config).toBe(path.join(home, ".config", "shuvcode"))
    expect(Global.Path.data).toBe(path.join(home, ".local", "share", "shuvcode"))
    expect(Global.Path.cache).toBe(path.join(home, ".cache", "shuvcode"))
    expect(Global.Path.state).toBe(path.join(home, ".local", "state", "shuvcode"))
    expect(os.tmpdir()).toBe(path.join(os.homedir(), "tmp"))
    expect(process.env.OPENCODE_CONFIG_DIR).toBe(Global.Path.config)
    expect(process.env.OPENCODE_CONFIG).toBeUndefined()
    expect(process.env.OPENCODE_CONFIG_CONTENT).toBeUndefined()
    expect(process.env.SHUVCODE_CONFIG).toBeUndefined()
    expect(process.env.OPENCODE_PASSWORD).toBeUndefined()
    expect(process.env.AWS_REGION).toBeUndefined()
    expect(process.env.GOOGLE_VERTEX_PROJECT).toBeUndefined()
    expect(process.env.NPM_CONFIG_REGISTRY).toBeUndefined()
    expect(process.env.UIDOTSH_AUTHORIZATION).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })
})
