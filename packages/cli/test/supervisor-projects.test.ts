import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { SupervisorProjects } from "../src/supervisor/projects"
import { SupervisorWorktree } from "../src/supervisor/worktree"

const roots: string[] = []
const databases: DatabaseSync[] = []

afterEach(() => {
  databases.splice(0).forEach((db) => db.close())
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

function git(repo: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
  return new TextDecoder().decode(result.stdout).trim()
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "supervisor-projects-"))
  roots.push(root)
  const database = path.join(root, "supervisor.sqlite")
  const db = new DatabaseSync(database)
  databases.push(db)
  const repo = path.join(root, "project-one")
  mkdirSync(repo)
  git(repo, "init", "-q")
  git(repo, "config", "user.name", "Supervisor Test")
  git(repo, "config", "user.email", "supervisor@example.test")
  writeFileSync(path.join(repo, "README.md"), "fixture\n")
  git(repo, "add", "README.md")
  git(repo, "commit", "-qm", "initial")
  return { root, database, db, repo }
}

describe("supervisor project registry", () => {
  test("prepares canonical Git roots and policy defaults from origin presence", async () => {
    const { root, repo } = fixture()
    const local = await SupervisorProjects.prepare({ path: repo })
    expect(local).toMatchObject({ id: "project-one", path: realpathSync(repo), mode: "local-only", yolo: false })
    expect(local.baseRef).toBe(git(repo, "symbolic-ref", "--quiet", "--short", "HEAD"))

    git(repo, "remote", "add", "origin", "https://example.test/example.git")
    expect(await SupervisorProjects.prepare({ path: repo })).toMatchObject({ mode: "no-mistakes-prod-only" })
    expect(await SupervisorProjects.prepare({ path: repo, mode: "direct-PR", yolo: true })).toMatchObject({
      mode: "direct-PR",
      yolo: true,
    })

    mkdirSync(path.join(repo, "nested"))
    await expect(SupervisorProjects.prepare({ path: path.join(repo, "nested") })).rejects.toThrow("repository root")
    await expect(SupervisorProjects.prepare({ path: root })).rejects.toThrow()
    await expect(SupervisorProjects.prepare({ path: repo, baseRef: "missing-branch" })).rejects.toThrow()
    await expect(SupervisorProjects.prepare({ path: repo, id: "Invalid/ID" })).rejects.toThrow("Project ID")
  })

  test("persists projects, edits, and the selected default across database reopen", async () => {
    const { root, database, db, repo } = fixture()
    const registry = SupervisorProjects.open(db)
    const one = await SupervisorProjects.prepare({ path: repo, description: "First project" })
    const first = registry.add(one)
    expect(registry.default()?.id).toBe(first.id)
    expect(registry.add(one)).toEqual(first)

    const secondRepo = path.join(root, "second")
    git(root, "init", "-q", secondRepo)
    git(secondRepo, "config", "user.name", "Supervisor Test")
    git(secondRepo, "config", "user.email", "supervisor@example.test")
    writeFileSync(path.join(secondRepo, "README.md"), "second\n")
    git(secondRepo, "add", "README.md")
    git(secondRepo, "commit", "-qm", "initial")
    const two = await SupervisorProjects.prepare({
      path: secondRepo,
      model: { providerID: "openai", modelID: "gpt-test" },
    })
    registry.add(two)
    registry.update(two.id, {
      mode: "no-mistakes",
      agent: "build",
      permissions: [{ action: "read", resource: "*", effect: "allow" }],
    })
    registry.setDefault(two.id)
    registry.archive(one.id)
    expect(registry.list().map((item) => item.id)).toEqual([two.id])
    expect(registry.list({ includeArchived: true })).toHaveLength(2)

    db.close()
    databases.splice(databases.indexOf(db), 1)
    const reopened = new DatabaseSync(database)
    databases.push(reopened)
    const saved = SupervisorProjects.open(reopened)
    expect(saved.default()?.id).toBe(two.id)
    expect(saved.get(two.id)).toMatchObject({
      mode: "no-mistakes",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-test" },
      permissions: [{ action: "read", resource: "*", effect: "allow" }],
    })
    expect(saved.get(one.id)?.archived).toBe(true)
    expect(saved.restore(one.id).archived).toBe(false)
    expect(saved.list()).toHaveLength(2)
  })

  test("rejects identity conflicts and protects the current default", async () => {
    const { root, db, repo } = fixture()
    const registry = SupervisorProjects.open(db)
    const one = await SupervisorProjects.prepare({ path: repo })
    registry.add(one)
    expect(() => registry.archive(one.id)).toThrow("another default")
    expect(() => registry.setDefault("unknown")).toThrow("Unknown")
    expect(() => registry.add({ ...one, description: "changed" })).toThrow("Conflicting")
    expect(() => registry.add({ ...one, id: "another" })).toThrow("already registered")

    const alias = path.join(root, "alias")
    symlinkSync(repo, alias)
    expect((await SupervisorProjects.prepare({ path: alias })).path).toBe(realpathSync(repo))
    expect(() => registry.update(one.id, { mode: "not-a-mode" as SupervisorProjects.Mode })).toThrow(
      "Invalid project mode",
    )
    expect(registry.default()?.id).toBe(one.id)
  })

  test("provisions a local clone atomically and reuses it only for the same origin", async () => {
    const { root, repo } = fixture()
    const bare = path.join(root, "source.git")
    git(root, "clone", "--bare", repo, bare)
    const first = await SupervisorProjects.provision({ home: root, id: "clone", url: bare })
    expect(first).toMatchObject({
      id: "clone",
      path: path.join(root, "projects", "clone"),
      mode: "no-mistakes-prod-only",
    })
    expect(git(first.path, "remote", "get-url", "origin")).toBe(bare)
    expect(await SupervisorProjects.provision({ home: root, id: "clone", url: bare })).toEqual(first)
    await expect(SupervisorProjects.provision({ home: root, id: "clone", url: repo })).rejects.toThrow(
      "different origin",
    )
    expect(existsSync(path.join(first.path, ".git"))).toBe(true)
  })

  test("initializes a blank project ready for its first worker and keeps conflicting destinations", async () => {
    const { root } = fixture()
    const project = await SupervisorProjects.provision({ home: root, id: "blank", initialize: true })
    expect(project.mode).toBe("local-only")
    expect(project.baseRef).toBe(git(project.path, "symbolic-ref", "--quiet", "--short", "HEAD"))
    expect(git(project.path, "rev-list", "--count", "HEAD")).toBe("1")
    expect(git(project.path, "ls-files")).toBe("")
    const task = await SupervisorWorktree.propose({
      home: root,
      taskID: "first",
      project: project.path,
      baseRef: project.baseRef,
    })
    expect((await SupervisorWorktree.create(task)).head).toBe(git(project.path, "rev-parse", "HEAD"))
    expect(await SupervisorProjects.provision({ home: root, id: "blank", initialize: true })).toEqual(project)
    const marker = path.join(project.path, "keep.txt")
    writeFileSync(marker, "user data")
    await expect(SupervisorProjects.provision({ home: root, id: "blank", url: "elsewhere" })).rejects.toThrow(
      "different origin",
    )
    expect(existsSync(marker)).toBe(true)
  })

  test("a failed local clone leaves no project or staging repository", async () => {
    const { root } = fixture()
    await expect(
      SupervisorProjects.provision({ home: root, id: "failed", url: path.join(root, "missing.git") }),
    ).rejects.toThrow("Git clone failed")
    expect(readdirSync(path.join(root, "projects"))).toEqual([])
  })
})
