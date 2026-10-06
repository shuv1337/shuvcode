import { describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "./fixture/tmpdir"

const fixture = path.join(import.meta.dir, "fixture/subagent-recovery-process.ts")

describe("confirmed subagent recovery after process death", () => {
  for (const phase of [
    "prepared",
    "created",
    "admitted",
    "running",
    "prompted",
    "settled",
    "result",
    "background-prepared",
    "background-admitted",
    "background-running",
    "background-settled",
    "background-cancelled",
    "unprepared",
    "exhausted",
    "cancelled",
    "cancelled-pending",
    "ambiguous",
  ] as const) {
    test(`reconciles the ${phase} boundary without a second child, admission, or result`, async () => {
      await using dir = await tmpdir("opencode-subagent-recovery-")
      const env = {
        ...process.env,
        HOME: dir.path,
        XDG_CONFIG_HOME: path.join(dir.path, "config"),
        XDG_DATA_HOME: path.join(dir.path, "data"),
        XDG_STATE_HOME: path.join(dir.path, "state"),
        XDG_CACHE_HOME: path.join(dir.path, "cache"),
        OPENCODE_CHANNEL: "latest",
      }
      const seed = Bun.spawn([process.execPath, fixture, "seed", dir.path, phase], {
        cwd: import.meta.dir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      })
      let readySeen = false
      try {
        const ready = path.join(dir.path, "ready")
        const until = Date.now() + 8000
        while (!(await Bun.file(ready).exists()) && Date.now() < until && seed.exitCode === null) await Bun.sleep(20)
        readySeen = await Bun.file(ready).exists()
      } finally {
        if (seed.exitCode === null) seed.kill("SIGKILL")
        await seed.exited
      }
      if (!readySeen)
        throw new Error(
          `Seed failed before ready (exit=${seed.exitCode} signal=${seed.signalCode}): stdout=${await new Response(seed.stdout).text()} stderr=${await new Response(seed.stderr).text()}`,
        )

      const recovery = Bun.spawnSync({
        cmd: [process.execPath, fixture, "recover", dir.path, phase],
        cwd: import.meta.dir,
        env,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 10_000,
      })
      expect(new TextDecoder().decode(recovery.stderr)).not.toContain("Error")
      expect(recovery.exitCode).toBe(0)
      const unsafe = ["ambiguous", "unprepared", "exhausted", "cancelled", "cancelled-pending"].includes(phase)
      const line = new TextDecoder()
        .decode(recovery.stdout)
        .split("\n")
        .find((item) => (unsafe ? item.startsWith('{"outcome"') : item.startsWith('{"childCount"')))
      if (!line) throw new Error("Recovery fixture did not return counts")
      if (unsafe) {
        expect(JSON.parse(line)).toEqual({
          outcome: "failed",
          tool: "error",
          childCount: phase.startsWith("cancelled") ? 1 : 0,
          ...(phase === "ambiguous" ? { effectInvocations: 1 } : {}),
        })
        return
      }
      expect(JSON.parse(line)).toEqual({
        childCount: 1,
        admissionCount: 1,
        childRuns: phase === "background-cancelled" ? 0 : 1,
        first: ["completed"],
        second: ["completed"],
        results: 1,
        ...(phase === "prompted" ? { parentDrains: ["completed"] } : {}),
        ...(phase.startsWith("background-") ? { notices: 1 } : {}),
        ...(phase === "background-cancelled" ? { noticeState: "cancelled" } : {}),
      })
    }, 30_000)
  }
})
