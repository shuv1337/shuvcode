import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { isolatedEnv } from "./fixture/environment"

test("a broken repository config does not block listing or removing credentials", async () => {
  await using root = await tmpdir()
  const file = path.join(root.path, ".opencode", "opencode.json")
  await Bun.write(file, '{\n  "mcp": {\n    "servers": {')
  const cli = async (args: string[], input?: string) => {
    const child = Bun.spawn(
      [process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), "auth", ...args, "--standalone"],
      {
        cwd: root.path,
        env: isolatedEnv(root.path),
        stdin: input ? new Blob([input]) : "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, code }
  }
  const imported = await cli(
    ["import"],
    JSON.stringify([
      {
        id: "cred_fixture",
        integrationID: "openai",
        label: "Fixture",
        active: true,
        value: { type: "key", key: "test-only" },
      },
    ]),
  )
  expect(imported.stderr).toContain("Imported 1 credential")
  expect(imported.code).toBe(0)
  const listed = await cli(["list", "--format", "json"])
  expect(listed.stderr).toContain(file)
  expect(listed.stderr).toContain("CloseBraceExpected")
  expect(listed.code).toBe(0)
  expect(JSON.parse(listed.stdout)).toContainEqual(expect.objectContaining({ id: "openai" }))
  const removed = await cli(["logout", "openai", "cred_fixture"])
  expect(removed.stderr).toContain(file)
  expect(removed.stderr).toContain("CloseBraceExpected")
  expect(removed.code).toBe(0)
  expect(removed.stdout).toContain("Removed account from OpenAI")
  const exported = await cli(["export"])
  expect(exported.code).toBe(0)
  expect(JSON.parse(exported.stdout)).toEqual([])
})
