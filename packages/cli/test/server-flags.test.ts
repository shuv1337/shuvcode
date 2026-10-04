import { describe, expect, test } from "bun:test"
import path from "node:path"

describe("global server flags", () => {
  test("shows --standalone on plugin help", async () => {
    const [root, plugin] = await Promise.all([cli(["--help"]), cli(["plugin", "list", "--help"])])

    expect(root.exitCode).toBe(0)
    expect(root.stdout).toContain("GLOBAL FLAGS")
    expect(root.stdout).toContain("Run with a private server instead of the background service")
    expect(plugin.exitCode).toBe(0)
    expect(plugin.stdout).toContain("GLOBAL FLAGS")
    expect(plugin.stdout).toContain("Run with a private server instead of the background service")
    expect(plugin.stdout).toContain("Connect to a server URL instead of the background service")
  })

  test("accepts --standalone before or after plugin list", async () => {
    const placements = [
      ["--standalone", "--server", "http://127.0.0.1:1", "plugin", "list"],
      ["plugin", "--standalone", "list", "--server", "http://127.0.0.1:1"],
      ["plugin", "list", "--server", "http://127.0.0.1:1", "--standalone"],
    ]
    const results = await Promise.all(placements.map((args) => cli(args)))

    for (const result of results) {
      expect(result.stderr).toContain("--server and --standalone cannot be combined")
      expect(result.stderr).not.toContain("Unrecognized flag")
      expect(result.exitCode).not.toBe(0)
    }
  })
})

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: path.join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
