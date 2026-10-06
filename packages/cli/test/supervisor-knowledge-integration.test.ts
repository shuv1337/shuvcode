import { expect, test } from "bun:test"
import { chmod, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { SupervisorStore } from "../src/supervisor/store"
import { managedEval } from "./fixtures/supervisor-managed-eval"

test("fresh native lead sees home startup knowledge on its first model request", async () => {
  await using fixture = await managedEval("result", process.env.SHUVCODE_SUPERVISOR_BINARY)
  const init = await fixture.cli([
    "init",
    "--home",
    fixture.home,
    "--project",
    fixture.project,
    "--model",
    "test/test-model",
    "--provider-url",
    fixture.providerURL,
    "--auto",
  ])
  if (init.code !== 0) throw new Error(init.stderr)
  const store = SupervisorStore.open(fixture.home)
  try {
    store.channels.knowledge.put({
      id: "private",
      scope: "preferences",
      title: "Private preference",
      content: "Prefer terse answers",
    })
    store.channels.knowledge.put({
      id: "shared",
      scope: "shared",
      title: "Shared preference",
      content: "Use a clear heading",
    })
    store.channels.knowledge.put({
      id: "fleet",
      scope: "fleet",
      title: "Fleet learning",
      content: "Check the local owner",
    })
    store.channels.knowledge.put({
      id: "task",
      scope: "task",
      scopeID: "task-1",
      title: "Task note",
      content: "JIT only",
    })
  } finally {
    store.close()
  }
  try {
    const up = await fixture.cli([
      "up",
      "--home",
      fixture.home,
      "--project",
      fixture.project,
      "--model",
      "test/test-model",
      "--provider-url",
      fixture.providerURL,
      "--auto",
    ])
    if (up.code !== 0) throw new Error(up.stderr)
    const sent = await fixture.cli(["send", "Check memory", "--home", fixture.home])
    if (sent.code !== 0) throw new Error(sent.stderr)
    const deadline = Date.now() + 15_000
    while (!fixture.requests.length && Date.now() < deadline) await Bun.sleep(25)
    expect(fixture.requests.length).toBeGreaterThan(0)
    const first = JSON.stringify(fixture.requests[0]?.input)
    expect(first).toContain("Prefer terse answers")
    expect(first).toContain("Use a clear heading")
    expect(first).toContain("Check the local owner")
    expect(first).toContain("PRIVATE HOME PREFERENCES")
    expect(first).not.toContain("JIT only")
    expect(fixture.requests[0]?.tools?.map((tool) => tool.name)).toContain("supervisor_knowledge")
    if (process.env.SHUVCODE_SUPERVISOR_BINARY) {
      const status = await fixture.cli(["status", "--home", fixture.home, "--json"])
      expect(status.code).toBe(0)
      expect(JSON.parse(status.stdout).lead.active).toBe(true)
      const bin = path.dirname(process.env.SHUVCODE_SUPERVISOR_BINARY)
      const plugin = JSON.parse(await readFile(path.join(fixture.home, "config", "opencode.json"), "utf8"))
      expect(plugin.plugins[0].package).toBe(path.join(bin, "supervisor-plugin"))
      const voice = path.join(bin, "supervisor-voice", "fm-voice-relay.py")
      const capture = path.join(fixture.root, "voice-path")
      const shim = path.join(fixture.root, "python-shim")
      await writeFile(shim, `#!/bin/sh\nprintf '%s\\n' "$1" > '${capture}'\n`)
      await chmod(shim, 0o700)
      expect(
        (
          await fixture.cli([
            "voice",
            "configure",
            "--home",
            fixture.home,
            "--region",
            "test",
            "--model",
            "test",
            "--python",
            shim,
          ])
        ).code,
      ).toBe(0)
      expect(
        (await fixture.cli(["voice", "test", path.join(fixture.root, "empty.pcm"), "--home", fixture.home])).code,
      ).toBe(0)
      expect((await readFile(capture, "utf8")).trim()).toBe(voice)
      const loaded = Bun.spawnSync(["python3", voice, "--help"], { stdout: "pipe", stderr: "pipe" })
      expect(loaded.exitCode).toBe(0)
      expect((await fixture.cli(["stop", "--home", fixture.home])).code).toBe(0)
      expect((await fixture.cli(["start", "--home", fixture.home])).code).toBe(0)
      expect((await fixture.cli(["status", "--home", fixture.home, "--json"])).code).toBe(0)
    }
  } finally {
    await fixture.cli(["stop", "--home", fixture.home]).catch(() => undefined)
  }
}, 60_000)
