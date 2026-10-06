import { expect, test } from "bun:test"
import path from "node:path"

test("native voice client, relay, framing and durable bridge pass offline regressions", () => {
  const result = Bun.spawnSync(["python3", path.join(import.meta.dir, "fixtures/supervisor-voice-python.py")], {
    cwd: import.meta.dir,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(new TextDecoder().decode(result.stderr)).toContain("Ran 6 tests")
  expect(result.exitCode).toBe(0)
})
