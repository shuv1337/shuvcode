import { describe, expect, test } from "bun:test"
import { Project } from "../../src/project/project"
import { Log } from "../../src/util/log"
import { Storage } from "../../src/storage/storage"
import { Session } from "../../src/session"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

// Helper: cleanup worktree properly (must remove worktree reference before deleting directory)
async function cleanupWorktree(mainRepoPath: string, worktreePath: string) {
  await $`git worktree remove --force ${worktreePath}`.cwd(mainRepoPath).quiet().nothrow()
  await fs.rm(worktreePath, { recursive: true, force: true })
}

describe("Project.fromDirectory", () => {
  test("should handle git repository with no commits", async () => {
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    const project = await Project.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).toBe("global")
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const opencodeFile = path.join(tmp.path, ".git", "opencode")
    const fileExists = await Bun.file(opencodeFile).exists()
    expect(fileExists).toBe(false)
  })

  test("should handle git repository with commits", async () => {
    await using tmp = await tmpdir({ git: true })

    const project = await Project.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).not.toBe("global")
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const opencodeFile = path.join(tmp.path, ".git", "opencode")
    const fileExists = await Bun.file(opencodeFile).exists()
    expect(fileExists).toBe(true)

    // Task 4.1: Main worktree ID should not contain separator
    expect(project.id).not.toContain("-")

    // Task 4.1: opencode-worktree file should not exist for main worktree
    const worktreeHashFile = path.join(tmp.path, ".git", "opencode-worktree")
    const worktreeHashExists = await Bun.file(worktreeHashFile).exists()
    expect(worktreeHashExists).toBe(false)
  })

  // Task 4.2: Add linked worktree test
  test("should differentiate linked worktrees from main worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    const mainRepoPath = tmp.path

    // Create a linked worktree
    const worktreePath = path.join(path.dirname(mainRepoPath), "linked-worktree-" + Math.random().toString(36).slice(2))
    await $`git worktree add ${worktreePath} HEAD`.cwd(mainRepoPath).quiet()

    try {
      // Get project for main worktree
      const mainProject = await Project.fromDirectory(mainRepoPath)

      // Get project for linked worktree
      const linkedProject = await Project.fromDirectory(worktreePath)

      // Verify main worktree uses root commit only (no separator)
      expect(mainProject.id).not.toContain("-")

      // Verify linked worktree uses {rootCommit}-{hash} format
      expect(linkedProject.id).toContain("-")
      expect(linkedProject.id.split("-").length).toBe(2)

      // Verify IDs are different
      expect(mainProject.id).not.toBe(linkedProject.id)

      // Verify linked ID starts with the main ID (root commit)
      expect(linkedProject.id.startsWith(mainProject.id + "-")).toBe(true)

      // Verify opencode-worktree file exists for linked worktree
      const gitDirOutput = await $`git rev-parse --git-dir`.cwd(worktreePath).quiet().text()
      const gitDir = path.resolve(worktreePath, gitDirOutput.trim())
      const worktreeHashFile = path.join(gitDir, "opencode-worktree")
      const worktreeHashExists = await Bun.file(worktreeHashFile).exists()
      expect(worktreeHashExists).toBe(true)
    } finally {
      // Proper cleanup: remove worktree before deleting directory
      await cleanupWorktree(mainRepoPath, worktreePath)
    }
  })

  // Task 4.3: Add migration test
  test("should migrate sessions from old project ID to new project ID for linked worktrees", async () => {
    await using tmp = await tmpdir({ git: true })
    const mainRepoPath = tmp.path

    // Get main project to get the root commit (old project ID)
    const mainProject = await Project.fromDirectory(mainRepoPath)
    const oldProjectID = mainProject.id

    // Create a linked worktree
    const worktreePath = path.join(
      path.dirname(mainRepoPath),
      "linked-worktree-migration-" + Math.random().toString(36).slice(2),
    )
    await $`git worktree add ${worktreePath} HEAD`.cwd(mainRepoPath).quiet()

    try {
      // Create legacy sessions under the old project ID with different directories
      const sessionForWorktree: Session.Info = {
        id: "session_for_worktree",
        projectID: oldProjectID,
        directory: worktreePath,
        title: "Test session for worktree",
        time: { created: Date.now(), updated: Date.now() },
        version: "1",
      }
      const sessionForMain: Session.Info = {
        id: "session_for_main",
        projectID: oldProjectID,
        directory: mainRepoPath,
        title: "Test session for main",
        time: { created: Date.now(), updated: Date.now() },
        version: "1",
      }

      await Storage.write(["session", oldProjectID, sessionForWorktree.id], sessionForWorktree)
      await Storage.write(["session", oldProjectID, sessionForMain.id], sessionForMain)

      // Open linked worktree to trigger migration
      const linkedProject = await Project.fromDirectory(worktreePath)
      const newProjectID = linkedProject.id

      // Verify the session matching worktree directory was migrated
      const migratedSession = await Storage.read<Session.Info>(["session", newProjectID, sessionForWorktree.id]).catch(
        () => undefined,
      )
      expect(migratedSession).toBeDefined()
      expect(migratedSession?.projectID).toBe(newProjectID)
      expect(migratedSession?.directory).toBe(worktreePath)

      // Verify the old session was removed
      const oldSessionForWorktree = await Storage.read<Session.Info>([
        "session",
        oldProjectID,
        sessionForWorktree.id,
      ]).catch(() => undefined)
      expect(oldSessionForWorktree).toBeUndefined()

      // Verify session for main worktree remains under old project ID (not migrated)
      const remainingSession = await Storage.read<Session.Info>(["session", oldProjectID, sessionForMain.id]).catch(
        () => undefined,
      )
      expect(remainingSession).toBeDefined()
      expect(remainingSession?.directory).toBe(mainRepoPath)
    } finally {
      // Cleanup: remove worktree
      await cleanupWorktree(mainRepoPath, worktreePath)

      // Cleanup storage
      await Storage.remove(["session", oldProjectID, "session_for_main"]).catch(() => {})
    }
  })

  // Task 4.4: Add integration test with real worktree scenario
  test("should support multiple worktrees simultaneously without data collision", async () => {
    await using tmp = await tmpdir({ git: true })
    const mainRepoPath = tmp.path

    // Create two linked worktrees
    const worktree1Path = path.join(path.dirname(mainRepoPath), "worktree1-" + Math.random().toString(36).slice(2))
    const worktree2Path = path.join(path.dirname(mainRepoPath), "worktree2-" + Math.random().toString(36).slice(2))

    await $`git worktree add ${worktree1Path} HEAD`.cwd(mainRepoPath).quiet()
    await $`git worktree add ${worktree2Path} HEAD`.cwd(mainRepoPath).quiet()

    try {
      // Open all three (main + 2 linked) in opencode
      const mainProject = await Project.fromDirectory(mainRepoPath)
      const worktree1Project = await Project.fromDirectory(worktree1Path)
      const worktree2Project = await Project.fromDirectory(worktree2Path)

      // Verify all three have different project IDs
      const ids = new Set([mainProject.id, worktree1Project.id, worktree2Project.id])
      expect(ids.size).toBe(3)

      // Verify all three share the same root commit prefix
      const rootCommit = mainProject.id
      expect(worktree1Project.id.startsWith(rootCommit + "-")).toBe(true)
      expect(worktree2Project.id.startsWith(rootCommit + "-")).toBe(true)

      // Create sessions in each project
      const session1: Session.Info = {
        id: "session_main",
        projectID: mainProject.id,
        directory: mainRepoPath,
        title: "Main session",
        time: { created: Date.now(), updated: Date.now() },
        version: "1",
      }
      const session2: Session.Info = {
        id: "session_wt1",
        projectID: worktree1Project.id,
        directory: worktree1Path,
        title: "Worktree 1 session",
        time: { created: Date.now(), updated: Date.now() },
        version: "1",
      }
      const session3: Session.Info = {
        id: "session_wt2",
        projectID: worktree2Project.id,
        directory: worktree2Path,
        title: "Worktree 2 session",
        time: { created: Date.now(), updated: Date.now() },
        version: "1",
      }

      await Storage.write(["session", mainProject.id, session1.id], session1)
      await Storage.write(["session", worktree1Project.id, session2.id], session2)
      await Storage.write(["session", worktree2Project.id, session3.id], session3)

      // Verify complete isolation (each project only has its own session)
      const mainSessions = await Storage.list(["session", mainProject.id])
      const wt1Sessions = await Storage.list(["session", worktree1Project.id])
      const wt2Sessions = await Storage.list(["session", worktree2Project.id])

      expect(mainSessions.length).toBe(1)
      expect(wt1Sessions.length).toBe(1)
      expect(wt2Sessions.length).toBe(1)

      // Verify no data leakage
      const mainSession = await Storage.read<Session.Info>(["session", mainProject.id, "session_main"])
      const wt1Session = await Storage.read<Session.Info>(["session", worktree1Project.id, "session_wt1"])
      const wt2Session = await Storage.read<Session.Info>(["session", worktree2Project.id, "session_wt2"])

      expect(mainSession.directory).toBe(mainRepoPath)
      expect(wt1Session.directory).toBe(worktree1Path)
      expect(wt2Session.directory).toBe(worktree2Path)

      // Cleanup sessions
      await Storage.remove(["session", mainProject.id, session1.id]).catch(() => {})
      await Storage.remove(["session", worktree1Project.id, session2.id]).catch(() => {})
      await Storage.remove(["session", worktree2Project.id, session3.id]).catch(() => {})
    } finally {
      // Proper cleanup order: remove worktrees before deleting directories
      await cleanupWorktree(mainRepoPath, worktree1Path)
      await cleanupWorktree(mainRepoPath, worktree2Path)
    }
  })
})

describe("Project.discover", () => {
  test("should discover favicon.png in root", async () => {
    await using tmp = await tmpdir({ git: true })
    const project = await Project.fromDirectory(tmp.path)

    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await Bun.write(path.join(tmp.path, "favicon.png"), pngData)

    await Project.discover(project)

    const updated = await Storage.read<Project.Info>(["project", project.id])
    expect(updated.icon).toBeDefined()
    expect(updated.icon?.url).toStartWith("data:")
    expect(updated.icon?.url).toContain("base64")
    expect(updated.icon?.color).toBeUndefined()
  })

  test("should not discover non-image files", async () => {
    await using tmp = await tmpdir({ git: true })
    const project = await Project.fromDirectory(tmp.path)

    await Bun.write(path.join(tmp.path, "favicon.txt"), "not an image")

    await Project.discover(project)

    const updated = await Storage.read<Project.Info>(["project", project.id])
    expect(updated.icon).toBeUndefined()
  })
})
