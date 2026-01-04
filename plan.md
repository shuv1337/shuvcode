# Upstream v1.1.1 Merge Backlog

**Target:** Merge upstream v1.1.1 into shuvcode-dev  
**Date Created:** 2026-01-04  
**Current sync point:** v1.0.223  
**Target sync point:** v1.1.1

---

## Phase 1: Pre-Merge Preparation

- [ ] 1.1.1 Ensure working directory is clean: `git status`
- [ ] 1.1.2 Checkout shuvcode-dev branch: `git checkout shuvcode-dev`
- [ ] 1.1.3 Create backup branch: `git checkout -b shuvcode-dev-backup-v1.0.223`
- [ ] 1.1.4 Push backup to origin: `git push origin shuvcode-dev-backup-v1.0.223`
- [ ] 1.1.5 Verify backup builds: `cd packages/opencode && bun run typecheck`
- [ ] 1.1.6 Return to shuvcode-dev: `git checkout shuvcode-dev`
- [ ] 1.1.7 Create merge branch: `git checkout -b merge/v1.1.1-integration`
- [ ] 1.1.8 Fetch upstream: `git fetch upstream`

---

## Phase 2: Initial Merge

- [ ] 2.1 Start merge without committing: `git merge v1.1.1 --no-commit`
- [ ] 2.2 List all conflicted files: `git diff --name-only --diff-filter=U`
- [ ] 2.3 Take note of conflict count and file list for reference

---

## Phase 3: Accept Upstream Permission System Files

### 3.1 Core Permission Files
- [ ] 3.1.1 Accept upstream permission/index.ts: `git checkout --theirs packages/opencode/src/permission/index.ts`
- [ ] 3.1.2 Stage permission/index.ts: `git add packages/opencode/src/permission/index.ts`
- [ ] 3.1.3 Add new file permission/next.ts: `git add packages/opencode/src/permission/next.ts`
- [ ] 3.1.4 Add new file permission/arity.ts: `git add packages/opencode/src/permission/arity.ts`

### 3.2 Agent System
- [ ] 3.2.1 Accept upstream agent/agent.ts: `git checkout --theirs packages/opencode/src/agent/agent.ts`
- [ ] 3.2.2 Stage agent/agent.ts: `git add packages/opencode/src/agent/agent.ts`

### 3.3 Config System
- [ ] 3.3.1 Accept upstream config/config.ts: `git checkout --theirs packages/opencode/src/config/config.ts`
- [ ] 3.3.2 Stage config/config.ts: `git add packages/opencode/src/config/config.ts`

### 3.4 Tool System
- [ ] 3.4.1 Accept upstream tool/edit.ts: `git checkout --theirs packages/opencode/src/tool/edit.ts`
- [ ] 3.4.2 Stage tool/edit.ts: `git add packages/opencode/src/tool/edit.ts`
- [ ] 3.4.3 Accept upstream tool/write.ts: `git checkout --theirs packages/opencode/src/tool/write.ts`
- [ ] 3.4.4 Stage tool/write.ts: `git add packages/opencode/src/tool/write.ts`
- [ ] 3.4.5 Accept upstream tool/patch.ts: `git checkout --theirs packages/opencode/src/tool/patch.ts`
- [ ] 3.4.6 Stage tool/patch.ts: `git add packages/opencode/src/tool/patch.ts`
- [ ] 3.4.7 Accept upstream tool/bash.ts: `git checkout --theirs packages/opencode/src/tool/bash.ts`
- [ ] 3.4.8 Stage tool/bash.ts: `git add packages/opencode/src/tool/bash.ts`
- [ ] 3.4.9 Accept upstream tool/registry.ts: `git checkout --theirs packages/opencode/src/tool/registry.ts`
- [ ] 3.4.10 Stage tool/registry.ts: `git add packages/opencode/src/tool/registry.ts`

### 3.5 TUI Permission Component
- [ ] 3.5.1 Add new file session/permission.tsx: `git add packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx`

---

## Phase 4: Delete Fork Permission Editor Files

- [ ] 4.1 Delete permission/editor.ts: `rm -f packages/opencode/src/permission/editor.ts`
- [ ] 4.2 Delete editor.test.ts: `rm -f packages/opencode/test/permission/editor.test.ts`
- [ ] 4.3 Stage deletions: `git add packages/opencode/src/permission/editor.ts packages/opencode/test/permission/editor.test.ts`
- [ ] 4.4 Verify files are deleted: `ls packages/opencode/src/permission/editor.ts 2>/dev/null || echo "Deleted"`

---

## Phase 5: Initial Type Check

- [ ] 5.1 Run type check: `cd packages/opencode && bun run typecheck 2>&1 | head -100`
- [ ] 5.2 Note any ToolRegistry.enabled errors for manual fixing
- [ ] 5.3 Check for remaining ToolRegistry.enabled callers: `grep -rn "ToolRegistry.enabled" packages/opencode/src/`

---

## Phase 6: Remove ToolRegistry.enabled() Callers (if needed)

- [ ] 6.1 Check server.ts for ToolRegistry.enabled: `grep -n "ToolRegistry.enabled" packages/opencode/src/server/server.ts`
- [ ] 6.2 If found, remove mergeDeep call with ToolRegistry.enabled from server.ts line ~506
- [ ] 6.3 Check prompt.ts for ToolRegistry.enabled: `grep -n "ToolRegistry.enabled" packages/opencode/src/session/prompt.ts`
- [ ] 6.4 If found, remove mergeDeep call with ToolRegistry.enabled from prompt.ts line ~595
- [ ] 6.5 Check llm.ts for ToolRegistry.enabled: `grep -n "ToolRegistry.enabled" packages/opencode/src/session/llm.ts`
- [ ] 6.6 If found, remove mergeDeep call with ToolRegistry.enabled from llm.ts line ~205
- [ ] 6.7 Check debug/agent.ts for ToolRegistry.enabled: `grep -n "ToolRegistry.enabled" packages/opencode/src/cli/cmd/debug/agent.ts`
- [ ] 6.8 If found, remove spread with ToolRegistry.enabled from debug/agent.ts line ~43
- [ ] 6.9 Re-run type check to verify fixes: `cd packages/opencode && bun run typecheck`

---

## Phase 7: Re-add AskQuestion Tool to Registry

- [ ] 7.1 Open packages/opencode/src/tool/registry.ts
- [ ] 7.2 Add import at top: `import { AskQuestionTool } from "./askquestion"`
- [ ] 7.3 Find the all() function's return array
- [ ] 7.4 Add AskQuestionTool to array with experimental flag check:
      ```typescript
      ...(config.experimental?.askquestion_tool === true ? [AskQuestionTool] : []),
      ```
- [ ] 7.5 Save and verify no syntax errors

---

## Phase 8: Re-add Fork Config Options

### 8.1 TUI Density Option
- [ ] 8.1.1 Open packages/opencode/src/config/config.ts
- [ ] 8.1.2 Find the Tui schema definition
- [ ] 8.1.3 Add density field: `density: z.enum(["auto", "comfortable", "compact"]).optional(),`
- [ ] 8.1.4 Save file

### 8.2 Session Parent Keybind
- [ ] 8.2.1 Find the Keybinds schema definition
- [ ] 8.2.2 Add session_parent field: `session_parent: z.string().default("p"),`
- [ ] 8.2.3 Save file

### 8.3 IDE Config Options
- [ ] 8.3.1 Add Ide schema definition:
      ```typescript
      export const Ide = z.object({
        lockfile_dir: z.string().optional(),
        auth_header_name: z.string().optional(),
      }).optional()
      ```
- [ ] 8.3.2 Find the Info schema
- [ ] 8.3.3 Add ide field to Info schema: `ide: Ide,`
- [ ] 8.3.4 Save file

### 8.4 Experimental AskQuestion Tool
- [ ] 8.4.1 Find the Experimental schema definition
- [ ] 8.4.2 Add askquestion_tool field: `askquestion_tool: z.boolean().optional(),`
- [ ] 8.4.3 Save file

### 8.5 Verify Config Changes
- [ ] 8.5.1 Run type check: `cd packages/opencode && bun run typecheck`
- [ ] 8.5.2 Fix any type errors from config changes

---

## Phase 9: Verify ghostty-opentui in bash.ts

- [ ] 9.1 Check for ghostty-opentui import: `grep -n "ghostty-opentui" packages/opencode/src/tool/bash.ts`
- [ ] 9.2 If missing, check backup for reference: `git show shuvcode-dev-backup-v1.0.223:packages/opencode/src/tool/bash.ts | grep -A5 "ghostty-opentui"`
- [ ] 9.3 If missing, restore Terminal import from backup
- [ ] 9.4 Verify package.json has dependency: `grep "ghostty-opentui" packages/opencode/package.json`
- [ ] 9.5 If dependency missing, add to package.json

---

## Phase 10: Handle TUI Session Index Conflicts

### 10.1 Preparation
- [ ] 10.1.1 Check conflict status of session/index.tsx: `git diff --check packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- [ ] 10.1.2 Open file in editor to review conflicts

### 10.2 Remove PermissionEditor References
- [ ] 10.2.1 Remove import: `import { PermissionEditor }` (line ~77)
- [ ] 10.2.2 Remove handleEditPermission() function (lines ~485-531)
- [ ] 10.2.3 Remove permission_edit keybind handler (lines ~569-580)
- [ ] 10.2.4 Remove edit UI hint in permission dialog (lines ~2100-2103)
- [ ] 10.2.5 Remove PermissionEditor.computeDiff call (line ~2547)

### 10.3 Preserve Fork Features
- [ ] 10.3.1 Preserve sidebar resize functionality
- [ ] 10.3.2 Preserve spinner customization
- [ ] 10.3.3 Preserve AskQuestion dialog integration
- [ ] 10.3.4 Preserve search in messages
- [ ] 10.3.5 Preserve double Ctrl+C exit handler

### 10.4 Accept Upstream Changes
- [ ] 10.4.1 Accept upstream's new permission dialog structure
- [ ] 10.4.2 Accept upstream's ctx.ask() integration
- [ ] 10.4.3 Resolve all conflict markers
- [ ] 10.4.4 Stage resolved file: `git add packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

---

## Phase 11: Handle Remaining File Conflicts

### 11.1 Identify Remaining Conflicts
- [ ] 11.1.1 List remaining conflicts: `git diff --name-only --diff-filter=U`
- [ ] 11.1.2 Create list of files to resolve

### 11.2 Desktop App Conflicts
- [ ] 11.2.1 Resolve packages/app/src/pages/session.tsx - preserve AskQuestion wizard
- [ ] 11.2.2 Resolve packages/app/src/app.tsx - preserve server URL handling
- [ ] 11.2.3 Resolve packages/app/src/components/*.tsx - preserve theme/font pickers
- [ ] 11.2.4 Resolve packages/app/src/pages/layout.tsx - preserve shuvcode branding
- [ ] 11.2.5 Stage resolved desktop files

### 11.3 CLI Conflicts
- [ ] 11.3.1 Resolve packages/opencode/src/cli/cmd/*.ts - preserve share command
- [ ] 11.3.2 Resolve packages/opencode/src/cli/cmd/tui/*.tsx - preserve fork UI features
- [ ] 11.3.3 Stage resolved CLI files

### 11.4 Server Conflicts
- [ ] 11.4.1 Resolve packages/opencode/src/server/server.ts
- [ ] 11.4.2 Remove modifyData from permission respond schema (line ~1588)
- [ ] 11.4.3 Remove modifyData from response handling (line ~1597)
- [ ] 11.4.4 Preserve askquestion/respond endpoint
- [ ] 11.4.5 Preserve askquestion/cancel endpoint
- [ ] 11.4.6 Stage resolved server.ts

### 11.5 Other Conflicts
- [ ] 11.5.1 Resolve any remaining conflicted files
- [ ] 11.5.2 Stage all resolved files

---

## Phase 12: Verify Package Dependencies

- [ ] 12.1 Check ghostty-opentui dependency: `grep "ghostty-opentui" packages/opencode/package.json || echo "MISSING"`
- [ ] 12.2 If missing, add ghostty-opentui to dependencies
- [ ] 12.3 Check vite-plugin-pwa dependency: `grep "vite-plugin-pwa" packages/app/package.json || echo "MISSING"`
- [ ] 12.4 If missing, add vite-plugin-pwa to dependencies
- [ ] 12.5 Run bun install to update lockfile: `bun install`

---

## Phase 13: Update fork-features.json

### 13.1 Add to removedFeatures Array
- [ ] 13.1.1 Open script/sync/fork-features.json
- [ ] 13.1.2 Add PR 6476 entry to removedFeatures:
      ```json
      {
        "pr": 6476,
        "title": "Allow users to edit suggested changes before applying",
        "author": "dmmulroy",
        "removedDate": "2026-01-04",
        "reason": "Dropped to align with upstream v1.1.1 permission system overhaul"
      }
      ```
- [ ] 13.1.3 Add glob-permissions entry to removedFeatures:
      ```json
      {
        "pr": "ariane-emory/glob-permissions",
        "title": "Granular File Permissions",
        "author": "ariane-emory",
        "removedDate": "2026-01-04",
        "reason": "Upstream's PermissionNext provides native pattern matching"
      }
      ```

### 13.2 Remove from features Array
- [ ] 13.2.1 Remove PR 6476 entry from features array
- [ ] 13.2.2 Remove glob-permissions entry from features array

### 13.3 Update Metadata
- [ ] 13.3.1 Update lastUpdated to "2026-01-04"
- [ ] 13.3.2 Update lastChange description for v1.1.1 sync
- [ ] 13.3.3 Save file

---

## Phase 14: Update Sync Marker

- [ ] 14.1 Update last-synced-tag: `echo "v1.1.1" > .github/last-synced-tag`
- [ ] 14.2 Stage sync marker: `git add .github/last-synced-tag`

---

## Phase 15: Regenerate SDK

- [ ] 15.1 Run SDK build script: `./packages/sdk/js/script/build.ts`
- [ ] 15.2 Verify SDK generated without errors
- [ ] 15.3 Stage SDK changes: `git add packages/sdk/`

---

## Phase 16: Verification Greps

### 16.1 Verify Complete Removal (should return NOTHING)
- [ ] 16.1.1 Check PermissionEditor removed: `grep -rn "PermissionEditor" packages/opencode/src/`
- [ ] 16.1.2 Check modifyData removed: `grep -rn "modifyData" packages/opencode/src/`
- [ ] 16.1.3 Check ToolRegistry.enabled removed: `grep -rn "ToolRegistry.enabled" packages/opencode/src/`
- [ ] 16.1.4 Check resolveFilePermission removed: `grep -rn "resolveFilePermission" packages/opencode/src/`
- [ ] 16.1.5 Check mergeAgentPermissions removed: `grep -rn "mergeAgentPermissions" packages/opencode/src/`

### 16.2 Verify Preserved Features (should return results)
- [ ] 16.2.1 Check AskQuestionTool in registry: `grep -rn "AskQuestionTool" packages/opencode/src/tool/registry.ts`
- [ ] 16.2.2 Check askquestion_tool config: `grep -rn "askquestion_tool" packages/opencode/src/config/config.ts`
- [ ] 16.2.3 Check ghostty-opentui dependency: `grep -rn "ghostty-opentui" packages/opencode/package.json`
- [ ] 16.2.4 Check pendingAskQuestion in TUI: `grep -rn "pendingAskQuestion" packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- [ ] 16.2.5 Check AskQuestionWizard in app: `grep -rn "AskQuestionWizard" packages/app/src/pages/session.tsx`

---

## Phase 17: Type Check and Build

### 17.1 Type Check
- [ ] 17.1.1 Type check opencode: `cd packages/opencode && bun run typecheck`
- [ ] 17.1.2 Fix any type errors found
- [ ] 17.1.3 Type check app: `cd packages/app && bun run typecheck`
- [ ] 17.1.4 Fix any type errors found
- [ ] 17.1.5 Type check ui: `cd packages/ui && bun run typecheck`
- [ ] 17.1.6 Fix any type errors found

### 17.2 Run Tests
- [ ] 17.2.1 Run opencode tests: `cd packages/opencode && bun test`
- [ ] 17.2.2 Fix any failing tests
- [ ] 17.2.3 Verify AskQuestion tests pass: `cd packages/opencode && bun test askquestion`

### 17.3 Build
- [ ] 17.3.1 Run full build: `bun run build`
- [ ] 17.3.2 Fix any build errors

---

## Phase 18: Commit

- [ ] 18.1 Stage all remaining changes: `git add .`
- [ ] 18.2 Review staged changes: `git status`
- [ ] 18.3 Create commit with detailed message:
      ```
      git commit -m "sync: merge upstream v1.1.1 into shuvcode-dev

      BREAKING: Accept upstream permission system overhaul (PermissionNext)

      API Changes:
      - Tools now use ctx.ask() instead of Permission.ask()
      - Permission.Response removes 'modify' option
      - Agent.Info.permission is now PermissionNext.Ruleset array
      - ToolRegistry.enabled() removed; tools self-gate via ctx.ask()

      Dropped fork features to align with upstream:
      - PR 6476: Edit permission editing (modify response removed)
      - ariane-emory/glob-permissions: Granular file permissions

      Preserved fork features:
      - AskQuestion tool
      - All TUI features (sidebar resize, spinners, search, etc.)
      - All Desktop features (theme pickers, PWA, ASCII branding)
      - All CLI features (share, GitHub App, Docker)"
      ```

---

## Phase 19: Post-Merge Testing

### 19.1 Permission System Tests
- [ ] 19.1.1 Test basic permission: "allow" in config works
- [ ] 19.1.2 Test pattern permission: `{ bash: { "rm *": "ask", "*": "allow" } }` works
- [ ] 19.1.3 Test permission dialogs appear correctly
- [ ] 19.1.4 Test "Always" option persists permissions
- [ ] 19.1.5 Test external directory permission asks

### 19.2 AskQuestion Tool Tests
- [ ] 19.2.1 Enable via `experimental.askquestion_tool: true` in config
- [ ] 19.2.2 Verify tool appears in agent tool list
- [ ] 19.2.3 Test TUI dialog renders correctly
- [ ] 19.2.4 Test Desktop wizard renders correctly
- [ ] 19.2.5 Test submit works via API endpoint
- [ ] 19.2.6 Test cancel works via API endpoint

### 19.3 Fork Feature Tests
- [ ] 19.3.1 Test sidebar resize works
- [ ] 19.3.2 Test spinner customization works
- [ ] 19.3.3 Test ANSI bash output works (ghostty-opentui)
- [ ] 19.3.4 Test desktop theme picker works
- [ ] 19.3.5 Test desktop font picker works
- [ ] 19.3.6 Test mobile PWA works
- [ ] 19.3.7 Test share to share.shuv.ai works
- [ ] 19.3.8 Test double Ctrl+C to exit works

---

## Phase 20: Push and PR

- [ ] 20.1 Push merge branch: `git push origin merge/v1.1.1-integration`
- [ ] 20.2 Create PR against shuvcode-dev: `gh pr create --repo Latitudes-Dev/shuvcode --base shuvcode-dev --title "sync: merge upstream v1.1.1" --body "..."`
- [ ] 20.3 Request review
- [ ] 20.4 After approval, merge PR
- [ ] 20.5 Verify shuvcode-dev updated correctly

---

## Follow-up Tasks (Post-Merge)

- [ ] F1. Investigate IDE diff integration with ctx.ask() API
- [ ] F2. Create permission config migration documentation
- [ ] F3. Create user-facing changelog entry
- [ ] F4. Delete backup branch after successful deployment: `git push origin --delete shuvcode-dev-backup-v1.0.223`

---

## Rollback Commands (Emergency Use)

If merge becomes unmanageable:
```bash
git checkout shuvcode-dev
git branch -D merge/v1.1.1-integration
# Backup branch preserves state at v1.0.223
```

If issues found post-merge (before push):
```bash
git reset --hard shuvcode-dev-backup-v1.0.223
```
