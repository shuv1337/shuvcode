import { expect, test } from "bun:test"
import path from "node:path"

// session/info.ts once reached permission.ts through session/cwd.ts -> file-access.ts, so loading
// session/store.ts first left SessionStore.node uninitialized. Upstream independently broke the
// cycle with session/cwd-store.ts. A fresh process has an empty module cache.
test.each(["session/store.ts", "session/execution.ts"])("%s loads as the first core module", async (entry) => {
  const child = Bun.spawn(
    [process.execPath, "-e", `await import(${JSON.stringify(path.resolve(import.meta.dir, "../src", entry))})`],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(stderr).not.toContain("before initialization")
  expect(code).toBe(0)
})
