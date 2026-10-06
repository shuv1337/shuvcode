import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SupervisorManaged } from "../src/supervisor/managed"
import { isolatedEnv } from "./fixture/environment"

const entrypoint = path.join(import.meta.dir, "../src/index.ts")

test("managed CLI keeps one lead, fences a killed native owner, and stops only its own processes", async () => {
  const fixture = await setup()
  const unrelated = Bun.spawn(["sleep", "30"], { stdout: "ignore", stderr: "ignore" })
  const owned: SupervisorManaged.Identity[] = []
  try {
    expect((await cli(fixture, ["up", "--home", fixture.home, "--project", fixture.project])).code).toBe(0)
    const first = await requireOwner(fixture.home)
    owned.push(first.owner, first.native!)
    expect(await SupervisorManaged.running(first.owner)).toBe(true)
    const initial = await status(fixture)
    expect(initial.lead?.active).toBe(true)
    expect(initial.lead?.generation).toBe(1)

    expect((await cli(fixture, ["up", "--home", fixture.home, "--project", fixture.project])).code).toBe(0)
    const repeated = await requireOwner(fixture.home)
    expect(repeated.owner).toEqual(first.owner)
    expect(repeated.native).toEqual(first.native)
    expect((await status(fixture)).lead).toEqual(initial.lead)

    if (!(await SupervisorManaged.running(first.owner))) throw new Error("Managed owner exited before crash test")
    process.kill(first.owner.pid, "SIGKILL")
    await until(async () => !(await alive(first.owner)))
    const restarted = await cli(fixture, ["start", "--home", fixture.home])
    expect(restarted.code).toBe(0)
    const second = await requireOwner(fixture.home)
    owned.push(second.owner, second.native!)
    expect(second.epoch).toBe(first.epoch + 1)
    expect(second.native).not.toEqual(first.native)
    expect(await alive(first.native!)).toBe(false)
    expect((await status(fixture)).lead).toEqual(initial.lead)

    expect((await cli(fixture, ["stop", "--home", fixture.home])).code).toBe(0)
    await until(async () => !(await alive(second.owner)) && !(await alive(second.native!)))
    expect(() => process.kill(unrelated.pid, 0)).not.toThrow()
  } finally {
    unrelated.kill()
    await unrelated.exited
    await cleanup(fixture, owned)
  }
}, 90_000)

test("managed CLI refuses a changed live owner identity", async () => {
  const fixture = await setup()
  const owned: SupervisorManaged.Identity[] = []
  try {
    expect((await cli(fixture, ["up", "--home", fixture.home, "--project", fixture.project])).code).toBe(0)
    const first = await requireOwner(fixture.home)
    owned.push(first.owner, first.native!)
    const ownerFile = path.join(fixture.home, "owner.json")
    expect(await SupervisorManaged.running(first.owner)).toBe(true)
    const original = await Bun.file(ownerFile).text()
    await writeFile(ownerFile, JSON.stringify({ ...first, owner: { ...first.owner, start: "0" } }))
    const tampered = await requireOwner(fixture.home)
    expect(tampered.owner.start).toBe("0")
    const actual = await SupervisorManaged.identity(first.owner.pid)
    if (!actual) throw new Error(`Owner vanished after tamper: ${JSON.stringify(first.owner)}`)
    if (actual.start === "0") throw new Error(`Owner start was zero: ${JSON.stringify(actual)}`)
    const refused = await cli(fixture, ["stop", "--home", fixture.home])
    expect(refused.code).not.toBe(0)
    expect(refused.stderr).toContain("identity changed")
    expect(await alive(first.owner)).toBe(true)
    expect(await alive(first.native!)).toBe(true)
    await writeFile(ownerFile, original)
  } finally {
    await cleanup(fixture, owned)
  }
}, 60_000)

test("managed CLI refuses a replacement native database until the original is restored", async () => {
  const fixture = await setup()
  const owned: SupervisorManaged.Identity[] = []
  const backup = path.join(fixture.root, "database-backup")
  try {
    expect((await cli(fixture, ["up", "--home", fixture.home, "--project", fixture.project])).code).toBe(0)
    const first = await requireOwner(fixture.home)
    owned.push(first.owner, first.native!)

    expect((await cli(fixture, ["stop", "--home", fixture.home])).code).toBe(0)
    await until(async () => !(await alive(first.owner)) && !(await alive(first.native!)))
    const database = path.join(fixture.home, "native")
    await mkdir(backup)
    const files = (await readdir(database)).filter((name) => name.startsWith("opencode.db"))
    expect(files).toContain("opencode.db")
    for (const name of files) await rename(path.join(database, name), path.join(backup, name))

    const missing = await cli(fixture, ["start", "--home", fixture.home], 50_000)
    expect(missing.code).not.toBe(0)
    expect(missing.stderr).toContain("Pilot database identity is missing")
    const failedOwner = await requireOwner(fixture.home)
    owned.push(failedOwner.owner, failedOwner.native!)
    await until(async () => !(await alive(failedOwner.owner)) && !(await alive(failedOwner.native!)))
    for (const name of (await readdir(database)).filter((name) => name.startsWith("opencode.db")))
      await rm(path.join(database, name), { force: true })
    for (const name of files) await rename(path.join(backup, name), path.join(database, name))

    expect((await cli(fixture, ["start", "--home", fixture.home])).code).toBe(0)
    const restored = await requireOwner(fixture.home)
    owned.push(restored.owner, restored.native!)
    expect((await status(fixture)).lead?.active).toBe(true)
  } finally {
    await cleanup(fixture, owned)
  }
}, 90_000)

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "shuvcode-supervisor-managed-"))
  const project = path.join(root, "project")
  const home = path.join(root, "pilot")
  await mkdir(project)
  await git(project, ["init", "-b", "integration-v2"])
  await git(project, ["config", "user.name", "Fixture"])
  await git(project, ["config", "user.email", "fixture@example.test"])
  await writeFile(path.join(project, "README.md"), "# Managed pilot fixture\n")
  await git(project, ["add", "README.md"])
  await git(project, ["commit", "-m", "chore: fixture baseline"])
  return { root, project, home }
}

async function cli(fixture: Awaited<ReturnType<typeof setup>>, args: string[], timeoutMs = 35_000) {
  const child = Bun.spawn([process.execPath, entrypoint, "supervisor", ...args], {
    cwd: fixture.project,
    env: isolatedEnv(fixture.root, { USERPROFILE: fixture.root }),
    stdout: "pipe",
    stderr: "pipe",
  })
  const result = Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  const timer = setTimeout(() => child.kill(), timeoutMs)
  try {
    const [code, stdout, stderr] = await result
    return { code, stdout, stderr }
  } finally {
    clearTimeout(timer)
  }
}

async function status(fixture: Awaited<ReturnType<typeof setup>>) {
  const result = await cli(fixture, ["status", "--home", fixture.home, "--json"])
  if (result.code !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout) as { lead?: { sessionID: string; generation: number; active: boolean } }
}

async function requireOwner(home: string) {
  const owner = await SupervisorManaged.owner(home)
  if (!owner?.native) throw new Error("Managed pilot has no owned native process")
  return owner
}

async function alive(identity: SupervisorManaged.Identity) {
  return SupervisorManaged.running(identity).catch(() => false)
}

async function until(probe: () => Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe()) return
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for managed process state")
}

async function cleanup(fixture: Awaited<ReturnType<typeof setup>>, owned: SupervisorManaged.Identity[]) {
  for (const identity of owned.reverse()) await SupervisorManaged.terminate(identity).catch(() => {})
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) throw new Error(stderr)
}
