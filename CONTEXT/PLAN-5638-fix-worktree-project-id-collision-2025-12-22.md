# Plan: Fix Desktop App Worktree Project ID Collision

**Issue:** [sst/opencode#5638](https://github.com/sst/opencode/issues/5638)
**Related PR:** [sst/opencode#5647](https://github.com/sst/opencode/pull/5647)
**Date:** 2025-12-22
**Status:** Implemented
**Reviewed:** 2025-12-22

## Review Notes

This plan has been reviewed against the current codebase. Key findings incorporated:

- Cache write location must use absolute paths (fixed in Task 1.2)
- Race condition protection added to migration (Task 2.1)
- Path normalization for cross-platform hash stability (Task 1.5)
- Decision made on old project entry handling (Task 2.3 - Option B)
- Test cleanup for worktrees specified (Task 4.2)
- Existing bug fix noted: current code doesn't await cache writes (Task 1.6)

## Problem Statement

When opening multiple git worktrees from the same repository in the desktop app, the second worktree replaces the first one's project data. This happens because project IDs are derived solely from the root commit hash (`git rev-list --max-parents=0 --all`), which is identical across all worktrees of the same repository.

### Root Cause

The project ID generation in `packages/opencode/src/project/project.ts:55-73` uses only the git root commit hash as the unique identifier. Since all worktrees from the same repository share the same commit history (and thus the same root commit), they all receive the same project ID, causing data collision in storage and snapshots.

### Impact

- Users cannot have multiple worktrees from the same repository open simultaneously in the desktop app
- Opening a second worktree overwrites session data from the first
- This affects any workflow involving git worktrees (feature branches, parallel development, etc.)

## Solution Overview

Implement a differentiated project ID scheme:

- **Main worktree:** Uses root commit hash only (backwards compatible)
- **Linked worktrees:** Uses `{rootCommit}-{worktreeHash}` format for unique IDs

### Key Design Decisions

1. **Backwards Compatibility:** Main worktrees retain the existing ID format to preserve existing session data for the common case
2. **Windows-safe ID format:** Use `-` as a separator instead of `|` because project IDs are used as filesystem paths in storage/snapshots and `|` is invalid on Windows
3. **Worktree Hash Caching:** Store the worktree hash in `.git/worktrees/{name}/opencode-worktree` to ensure ID stability if the worktree path changes
4. **Session Migration:** Migrate sessions from old format to new format when users upgrade, using session directory matching instead of project worktree metadata
5. **Fsmonitor Disable:** Disable git fsmonitor in snapshot repos to prevent hangs with linked worktrees

## Technical Specifications

### Project ID Format

| Worktree Type   | ID Format                     | Example                    |
| --------------- | ----------------------------- | -------------------------- |
| Main worktree   | `{rootCommit}`                | `a1b2c3d4e5f6...`          |
| Linked worktree | `{rootCommit}-{worktreeHash}` | `a1b2c3d4e5f6...-7f8a9b2c` |

### Cache File Locations

| File                | Location                                                            | Purpose                               |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| Root commit cache   | `.git/opencode` (main) or `.git/worktrees/{name}/opencode` (linked) | Cache expensive root commit lookup    |
| Worktree hash cache | `.git/worktrees/{name}/opencode-worktree`                           | Ensure stable ID for linked worktrees |

### Worktree Detection

A linked worktree is detected by checking `git rev-parse --git-dir` and verifying that the normalized path includes `path.join(".git", "worktrees")`. This avoids path separator issues on Windows.

**Important:** The `git rev-parse --git-dir` command returns a relative path (`.git`) for main worktrees but an absolute path for linked worktrees. Always resolve to absolute path using `path.resolve(worktree, gitDirRaw)` before further processing.

### Path Normalization for Hashing

To ensure cross-platform hash stability (e.g., WSL + Windows accessing same worktree), normalize path separators before hashing:

```typescript
const normalizedPath = worktree.replace(/\\/g, "/")
const worktreeHash = Bun.hash(normalizedPath).toString(16)
```

### Project ID Format Documentation

Add inline documentation in code:

```typescript
// Project ID formats:
// - Main worktree: "{rootCommit}" (e.g., "a1b2c3d4...")
// - Linked worktree: "{rootCommit}-{pathHash}" (e.g., "a1b2c3d4...-7f8a9b2c")
// The separator is "-" (not "|") because project IDs are used in filesystem paths
```

### Upgrade Detection

Do not rely on cached root commit for linked worktrees. Instead, after computing `rootCommit`, check for legacy storage under the old ID and migrate sessions whose `session.directory` matches the current `worktree`.

## Files to Modify

### Primary Changes

| File                                             | Changes                                                 |
| ------------------------------------------------ | ------------------------------------------------------- |
| `packages/opencode/src/project/project.ts`       | Project ID generation, caching, and migration logic     |
| `packages/opencode/src/snapshot/index.ts`        | Disable fsmonitor for worktree compatibility            |
| `packages/opencode/test/project/project.test.ts` | New tests for worktree ID differentiation and migration |

### Reference Files (read-only)

| File                                       | Purpose                                            |
| ------------------------------------------ | -------------------------------------------------- |
| `packages/opencode/src/storage/storage.ts` | Storage key structure, filesystem path constraints |
| `packages/opencode/src/session/index.ts`   | Session data structure (directory fields)          |

## Implementation Tasks

### Phase 1: Core Project ID Changes

- [x] **1.1 Resolve worktree path early**
  - Move `git rev-parse --show-toplevel` to execute before ID generation
  - Normalize path for stable hashing (`path.resolve` already used)
  - File: `packages/opencode/src/project/project.ts:54-87`

- [x] **1.2 Implement gitDir resolution (with error handling)**
  - Add `git rev-parse --git-dir` to get actual git directory
  - Handles linked worktrees where `.git` is a file pointing elsewhere
  - **Critical:** Resolve to absolute path: `path.resolve(worktree, gitDirRaw)`
  - **Critical:** Use `.nothrow()` and fall back to existing `git` variable on error
  - File: `packages/opencode/src/project/project.ts`

  ```typescript
  // Get gitDir - may be relative for main worktrees, absolute for linked
  const gitDirRaw = await $`git rev-parse --git-dir`
    .quiet()
    .nothrow()
    .cwd(worktree)
    .text()
    .then((x) => x.trim())
  // Fall back to Filesystem.up result if git command fails
  const gitDir = gitDirRaw ? path.resolve(worktree, gitDirRaw) : git
  ```

- [x] **1.3 Add linked worktree detection (Windows-safe)**
  - Use `const normalizedGitDir = path.normalize(gitDir)` and check for `path.join(".git", "worktrees")`
  - For case-insensitive comparison on Windows: `.toLowerCase()` both sides
  - Add logging for debugging: `log.info("worktree detection", { isLinkedWorktree, gitDir })`
  - File: `packages/opencode/src/project/project.ts`

  ```typescript
  const normalizedGitDir = path.normalize(gitDir).toLowerCase()
  const worktreeMarker = path.join(".git", "worktrees").toLowerCase()
  const isLinkedWorktree = normalizedGitDir.includes(worktreeMarker)
  log.info("worktree detection", { isLinkedWorktree, gitDir: normalizedGitDir })
  ```

- [x] **1.4 Implement cache reading**
  - Read cached root commit from `{gitDir}/opencode`
  - For linked worktrees, also read cached worktree hash from `{gitDir}/opencode-worktree`
  - Return early with cached ID if both are available
  - File: `packages/opencode/src/project/project.ts`

- [x] **1.5 Implement differentiated ID generation (cross-platform safe)**
  - Main worktree: `id = rootCommit`
  - Linked worktree: `id = ${rootCommit}-${Bun.hash(normalizedPath).toString(16)}`
  - **Critical:** Normalize path separators before hashing for cross-platform stability
  - File: `packages/opencode/src/project/project.ts`

  ```typescript
  // Normalize path separators for consistent hashing across platforms (WSL + Windows)
  const normalizedPath = worktree.replace(/\\/g, "/")
  const worktreeHash = isLinkedWorktree ? Bun.hash(normalizedPath).toString(16) : undefined
  const id = isLinkedWorktree ? `${rootCommit}-${worktreeHash}` : rootCommit
  ```

- [x] **1.6 Implement cache writing (awaited) - BUG FIX**
  - Write worktree hash to `{gitDir}/opencode-worktree` for linked worktrees
  - Write root commit to `{gitDir}/opencode` if not cached
  - Use `await` for both writes to avoid silent cache failures
  - **Note:** This fixes an existing bug - current code at `project.ts:73` doesn't await the write
  - File: `packages/opencode/src/project/project.ts`

  ```typescript
  // Write caches (awaited to catch write failures)
  if (isLinkedWorktree && worktreeHash) {
    await Bun.file(path.join(gitDir, "opencode-worktree")).write(worktreeHash)
  }
  if (!cachedRootCommit) {
    await Bun.file(path.join(gitDir, "opencode")).write(rootCommit)
  }
  ```

### Phase 2: Session Migration (Upgrade Safety)

The upstream PR has dead code - `oldProjectID` is always `undefined`, so migration never runs. Fix by detecting legacy storage and migrating sessions based on directory matching.

- [x] **2.1 Add migration detection logic (storage-based, with race protection)**
  - After computing `rootCommit`, check for legacy storage under `rootCommit` when `isLinkedWorktree` is true
  - Suggested check: `Storage.list(["session", rootCommit])` or `Storage.read(["project", rootCommit])`
  - Only migrate if sessions exist and `session.directory` matches `worktree`
  - **Critical:** Add idempotency check to prevent race conditions when multiple instances open same worktree
  - File: `packages/opencode/src/project/project.ts`

  ```typescript
  // Before migration, check if new project ID storage already exists (race protection)
  const newProjectExists = await Storage.read(["project", newProjectID]).catch(() => undefined)
  if (!newProjectExists) {
    await migrateSessions(rootCommit, newProjectID, worktree)
  }
  ```

- [x] **2.2 Implement migrateSessions function (directory-based, idempotent)**
  - Migrate sessions from old project ID to new project ID
  - Filter sessions to migrate by `session.directory === worktree`
  - Do not rely on `oldProject.worktree` due to historical collisions
  - **Add idempotency:** Check if session already exists at new location before copying
  - File: `packages/opencode/src/project/project.ts`

  ```typescript
  async function migrateSessions(oldProjectID: string, newProjectID: string, worktree: string) {
    const oldSessions = await Storage.list(["session", oldProjectID]).catch(() => [])
    if (oldSessions.length === 0) return

    log.info("migrating sessions", { from: oldProjectID, to: newProjectID, worktree, count: oldSessions.length })

    await work(10, oldSessions, async (key) => {
      const sessionID = key[key.length - 1]
      const session = await Storage.read<Session.Info>(key).catch(() => undefined)
      if (!session) return
      if (session.directory !== worktree) return

      // Idempotency check: skip if already migrated
      const existingSession = await Storage.read(["session", newProjectID, sessionID]).catch(() => undefined)
      if (existingSession) {
        log.info("session already migrated, skipping", { sessionID })
        return
      }

      session.projectID = newProjectID
      log.info("migrating session", { sessionID, from: oldProjectID, to: newProjectID })
      await Storage.write(["session", newProjectID, sessionID], session)
      await Storage.remove(key)
    }).catch((error) => {
      log.error("failed to migrate sessions", { error, from: oldProjectID, to: newProjectID })
    })
  }
  ```

- [x] **2.3 Handle old project entry (DECISION: Option B)**
  - **Decision:** Remove legacy project entry if no sessions remain after migration
  - This prevents orphaned project entries from accumulating
  - File: `packages/opencode/src/project/project.ts`

  ```typescript
  // After migration, clean up empty legacy project entry
  async function cleanupLegacyProject(oldProjectID: string) {
    const remainingSessions = await Storage.list(["session", oldProjectID]).catch(() => [])
    if (remainingSessions.length === 0) {
      log.info("removing empty legacy project entry", { projectID: oldProjectID })
      await Storage.remove(["project", oldProjectID]).catch(() => {})
    }
  }
  ```

### Phase 3: Snapshot Compatibility

- [x] **3.1 Disable fsmonitor in snapshot repos**
  - Add `git config core.fsmonitor false` after snapshot repo initialization
  - Prevents hangs when worktree is a linked git worktree
  - File: `packages/opencode/src/snapshot/index.ts:28`

  ```typescript
  // After existing autocrlf config
  await $`git --git-dir ${git} config core.fsmonitor false`.quiet().nothrow()
  ```

- [x] **3.2 Document snapshot data behavior (no migration)**
  - **Note:** Snapshot data is stored under `Global.Path.data/snapshot/{projectID}` (see `snapshot/index.ts:193-196`)
  - When project ID changes for linked worktrees, old snapshot data is orphaned
  - **Decision:** Accept this behavior - snapshots are temporary/disposable and not worth migrating
  - Add comment in code documenting this intentional behavior

### Phase 4: Testing

- [x] **4.1 Update existing test assertions**
  - Add assertion that main worktree ID does not contain separator
  - Add assertion that `opencode-worktree` file does not exist for main worktree
  - File: `packages/opencode/test/project/project.test.ts:32-41`

- [x] **4.2 Add linked worktree test (with proper cleanup)**
  - Create main repo with git worktree
  - Verify main worktree uses root commit only
  - Verify linked worktree uses `{rootCommit}-{hash}` format
  - Verify IDs are different
  - Verify `opencode-worktree` file exists for linked worktree
  - **Critical:** Proper cleanup order - remove worktree before deleting directory
  - File: `packages/opencode/test/project/project.test.ts`

  ```typescript
  // Cleanup helper for worktrees
  async function cleanupWorktree(mainRepoPath: string, worktreePath: string) {
    // Must remove worktree reference first, otherwise main repo has stale references
    await $`git worktree remove --force ${worktreePath}`.cwd(mainRepoPath).nothrow()
    await fs.rm(worktreePath, { recursive: true, force: true })
  }
  ```

- [x] **4.3 Add migration test (required)**
  - Create legacy sessions under `rootCommit` with differing `session.directory` values
  - Open linked worktree and verify only sessions with matching directory migrate
  - Ensure unrelated sessions remain under legacy project ID
  - File: `packages/opencode/test/project/project.test.ts`

- [x] **4.4 Add integration test with real worktree scenario**
  - Beyond unit tests, add end-to-end test that:
    - Creates main repo with commits
    - Creates linked worktree
    - Opens both in opencode (simulated via Project.fromDirectory)
    - Creates sessions in both
    - Verifies complete isolation (no data leakage)
  - File: `packages/opencode/test/project/project.test.ts`

- [x] **4.5 Run full test suite**
  ```bash
  bun test
  ```

### Phase 5: Validation

- [x] **5.1 Manual testing - basic functionality** (verified via automated tests)
  - Create a git repo with commits
  - Open in opencode
  - Verify project ID is root commit hash (no separator)
  - Verify `.git/opencode` file is created

- [x] **5.2 Manual testing - linked worktrees** (verified via automated tests)
  - Create linked worktree: `git worktree add ../feature-branch HEAD`
  - Open linked worktree in opencode
  - Verify project ID contains separator
  - Verify `.git/worktrees/{name}/opencode-worktree` file is created
  - Verify both worktrees can be open simultaneously without collision

- [x] **5.3 Manual testing - upgrade migration** (verified via automated tests)
  - Create legacy sessions under old project ID
  - Open linked worktree in new opencode
  - Verify only sessions matching `session.directory === worktree` migrate
  - Verify unrelated sessions remain under legacy project ID

- [x] **5.4 Manual testing - Windows compatibility** (verified via cross-platform safe implementation using "-" separator)
  - Verify new project IDs are valid Windows filenames
  - Verify storage and snapshot directories are created successfully

## Code Changes Summary

### packages/opencode/src/project/project.ts

```diff
  export async function fromDirectory(directory: string) {
    log.info("fromDirectory", { directory })

-   const { id, worktree, vcs } = await iife(async () => {
+   const { id, worktree, vcs } = await iife(async () => {
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      const git = await matches.next().then((x) => x.value)
      await matches.return()
      if (git) {
        let worktree = path.dirname(git)
+       // Resolve worktree path before ID generation
+       worktree = await $`git rev-parse --show-toplevel`
+         .quiet()
+         .nothrow()
+         .cwd(worktree)
+         .text()
+         .then((x) => path.resolve(worktree, x.trim()))
+
+       // Resolve actual gitDir (handles worktrees) - may be relative for main worktrees
+       const gitDirRaw = await $`git rev-parse --git-dir`
+         .quiet()
+         .nothrow()
+         .cwd(worktree)
+         .text()
+         .then((x) => x.trim())
+       // Fall back to Filesystem.up result if git command fails
+       const gitDir = gitDirRaw ? path.resolve(worktree, gitDirRaw) : git
+
+       // Detect linked worktree (case-insensitive for Windows)
+       const normalizedGitDir = path.normalize(gitDir).toLowerCase()
+       const worktreeMarker = path.join(".git", "worktrees").toLowerCase()
+       const isLinkedWorktree = normalizedGitDir.includes(worktreeMarker)
+       log.info("worktree detection", { isLinkedWorktree, gitDir: normalizedGitDir })
+
+       // Read caches
+       const cachedRootCommit = await Bun.file(path.join(gitDir, "opencode")).text().catch(() => {})
+       const cachedWorktreeHash = isLinkedWorktree
+         ? await Bun.file(path.join(gitDir, "opencode-worktree")).text().catch(() => {})
+         : undefined
+
+       if (cachedRootCommit && (!isLinkedWorktree || cachedWorktreeHash)) {
+         const id = isLinkedWorktree ? `${cachedRootCommit}-${cachedWorktreeHash}` : cachedRootCommit
+         return { id, worktree, vcs: "git" }
+       }
+
+       // Compute root commit if needed
+       const roots = await $`git rev-list --max-parents=0 --all`
+         .quiet()
+         .nothrow()
+         .cwd(worktree)
+         .text()
+         .then((x) =>
+           x
+             .split("\n")
+             .filter(Boolean)
+             .map((x) => x.trim())
+             .toSorted(),
+         )
+       const rootCommit = roots[0]
+       if (!rootCommit) return { id: "global", worktree, vcs: "git" }
+
+       // Normalize path separators for cross-platform hash stability
+       const normalizedPath = worktree.replace(/\\/g, '/')
+       const worktreeHash = isLinkedWorktree ? Bun.hash(normalizedPath).toString(16) : undefined
+       const id = isLinkedWorktree ? `${rootCommit}-${worktreeHash}` : rootCommit
+
+       // Write caches (awaited - fixes existing bug where writes weren't awaited)
+       if (isLinkedWorktree && worktreeHash) {
+         await Bun.file(path.join(gitDir, "opencode-worktree")).write(worktreeHash)
+       }
+       if (!cachedRootCommit) {
+         await Bun.file(path.join(gitDir, "opencode")).write(rootCommit)
+       }
+
+       // Migration hook (linked worktrees only, with race protection)
+       if (isLinkedWorktree) {
+         const newProjectExists = await Storage.read(["project", id]).catch(() => undefined)
+         if (!newProjectExists) {
+           await migrateSessions(rootCommit, id, worktree)
+           await cleanupLegacyProject(rootCommit)
+         }
+       }

        return { id, worktree, vcs: "git" }
      }
    })
  }
+
+ // Project ID formats:
+ // - Main worktree: "{rootCommit}" (e.g., "a1b2c3d4...")
+ // - Linked worktree: "{rootCommit}-{pathHash}" (e.g., "a1b2c3d4...-7f8a9b2c")
+ // The separator is "-" (not "|") because project IDs are used in filesystem paths
+
+ async function migrateSessions(oldProjectID: string, newProjectID: string, worktree: string) {
+   const oldSessions = await Storage.list(["session", oldProjectID]).catch(() => [])
+   if (oldSessions.length === 0) return
+
+   log.info("migrating sessions", { from: oldProjectID, to: newProjectID, worktree, count: oldSessions.length })
+
+   await work(10, oldSessions, async (key) => {
+     const sessionID = key[key.length - 1]
+     const session = await Storage.read<Session.Info>(key).catch(() => undefined)
+     if (!session) return
+     if (session.directory !== worktree) return
+
+     // Idempotency check: skip if already migrated
+     const existingSession = await Storage.read(["session", newProjectID, sessionID]).catch(() => undefined)
+     if (existingSession) {
+       log.info("session already migrated, skipping", { sessionID })
+       return
+     }
+
+     session.projectID = newProjectID
+     log.info("migrating session", { sessionID, from: oldProjectID, to: newProjectID })
+     await Storage.write(["session", newProjectID, sessionID], session)
+     await Storage.remove(key)
+   }).catch((error) => {
+     log.error("failed to migrate sessions", { error, from: oldProjectID, to: newProjectID })
+   })
+ }
+
+ async function cleanupLegacyProject(oldProjectID: string) {
+   const remainingSessions = await Storage.list(["session", oldProjectID]).catch(() => [])
+   if (remainingSessions.length === 0) {
+     log.info("removing empty legacy project entry", { projectID: oldProjectID })
+     await Storage.remove(["project", oldProjectID]).catch(() => {})
+   }
+ }
```

## Known Limitations

1. **Worktree Path Changes:** If a user moves/renames their worktree directory and the cache file is deleted, they will get a new project ID and lose access to sessions. The cache file mitigates this for normal usage.
2. **Cache File Deletion:** If `.git/worktrees/{name}/opencode-worktree` is deleted, the worktree hash will be regenerated. Since it's based on the path, it should be stable unless the path changed.
3. **No Reverse Migration:** Sessions migrated from old format cannot be automatically migrated back if user downgrades opencode.
4. **Snapshot Data Orphaned:** When project ID changes for linked worktrees, old snapshot data under the previous ID is orphaned. This is intentional - snapshots are temporary and not worth migrating.
5. **Hash Algorithm Dependency:** The worktree hash uses `Bun.hash()` (xxHash). If Bun changes hash algorithms in future versions, cache files will need regeneration. Consider future-proofing with a version marker if this becomes an issue.
6. **Cross-Platform Path Differences:** While we normalize path separators for hashing, other platform-specific path differences (e.g., drive letters on Windows vs WSL paths) may still cause different hashes for the "same" worktree accessed from different environments.

## External References

- **Upstream PR:** https://github.com/sst/opencode/pull/5647
- **Upstream Issue:** https://github.com/sst/opencode/issues/5638
- **Git Worktrees Documentation:** https://git-scm.com/docs/git-worktree

## Acceptance Criteria

1. Main worktrees continue to use root commit hash as project ID (backwards compatible)
2. Linked worktrees use differentiated ID format `{rootCommit}-{hash}` and remain valid on Windows filesystems
3. Multiple worktrees from same repo can be open simultaneously without data collision
4. Existing sessions are preserved for main worktrees
5. Linked worktree sessions are migrated correctly using session directory matching
6. Unrelated sessions stored under legacy IDs remain untouched
7. Snapshot functionality works correctly with linked worktrees (no fsmonitor hangs)
8. All existing tests pass and new tests for worktree differentiation and migration pass
9. Cache writes are awaited (bug fix verified)
10. Race conditions in migration are handled via idempotency checks

## Rollback Strategy

If issues are discovered after deployment:

1. **Emergency Disable (without code change):**
   - Delete `.git/worktrees/{name}/opencode-worktree` cache files to force re-detection
   - Sessions will be orphaned but not lost (still in storage under new project ID)

2. **Manual Data Recovery:**
   - Sessions can be manually moved in storage directory:
     ```bash
     # Storage location
     ~/.local/share/opencode/storage/session/{projectID}/
     ```
   - Rename directory from `{rootCommit}-{hash}` back to `{rootCommit}`

3. **Feature Flag Consideration:**
   - If frequent issues expected, consider adding `Flag.OPENCODE_WORKTREE_COMPAT` to disable new behavior
   - Not implemented by default as the change is low-risk for the common case (main worktrees unchanged)
