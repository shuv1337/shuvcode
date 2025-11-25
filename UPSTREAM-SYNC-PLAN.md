# Automated Upstream Sync Pipeline for OpenCode Fork

## Overview

Implement a GitHub Actions workflow that automatically syncs the fork's `dev` branch with upstream `sst/opencode` and merges changes into the `integration` branch while preserving custom features.

## Branch Architecture

```
integration (DEFAULT)  ← Your working branch, custom features, workflow configs
     ↑
     │ merge
     │
   dev (MIRROR)        ← Read-only mirror of upstream release tags
     ↑
     │ hard reset
     │
upstream/tags          ← sst/opencode release tags
```

**Key Change**: `integration` becomes the default branch because:

- Workflow files must live on the default branch for scheduled triggers
- `dev` will be hard reset, which would wipe any workflow configs
- `integration` is where actual development happens anyway

---

## Workflow Architecture

### Trigger Mechanism: Release Tag Detection

Since we're syncing on upstream **releases** (not every dev commit), the workflow will:

1. **Scheduled polling** to check for new tags on upstream
2. Poll every 15 minutes: `*/15 * * * *`
3. Compare latest upstream tag against the current `origin/dev` commit (or a marker stored on `integration` / repo variable)
4. Only proceed when a new tag is detected (e.g., `v1.0.111`)

### Workflow: `.github/workflows/upstream-sync.yml`

```yaml
name: Upstream Sync
on:
  schedule:
    - cron: "*/15 * * * *" # Check for new releases every 15 minutes
  workflow_dispatch: # Manual trigger option
    inputs:
      force_sync:
        description: "Force sync even if no new release"
        type: boolean
        default: false
```

### Tag Detection Logic

```bash
# Fetch upstream tags directly from upstream remote
git fetch upstream --tags

# Get latest upstream release tag (semver sorted, from upstream only)
LATEST_TAG=$(git ls-remote --tags --sort='-v:refname' upstream 'v*' \
  | sed 's|.*/||' | grep -E '^v[0-9]+' | head -1)

# Resolve upstream tag to SHA and compare to current origin/dev
LATEST_SHA=$(git ls-remote upstream "refs/tags/$LATEST_TAG" | awk '{print $1}')
DEV_SHA=$(git ls-remote origin refs/heads/dev | awk '{print $1}')

if [ "$LATEST_SHA" != "$DEV_SHA" ]; then
  echo "New release detected: $LATEST_TAG ($LATEST_SHA)"
  # Proceed with sync (and optionally update .github/last-synced-tag on integration or repo variable)
else
  echo "No new release; exit"
  exit 0
fi
```

---

## Phase 1: Dev Branch Sync (Mirror to Release Tag)

### Process

```bash
# Fetch upstream with tags
git fetch upstream --tags

# Ensure upstream remote exists
git remote add upstream https://github.com/sst/opencode.git 2>/dev/null || true

# Checkout dev and reset to the release tag
git checkout dev
git reset --hard $LATEST_TAG
git push origin dev --force

# Optional: store marker on integration branch or repo variable (not on dev)
echo "$LATEST_TAG" > .github/last-synced-tag
git checkout integration
git add .github/last-synced-tag
git commit -m "sync: record last synced tag $LATEST_TAG" || true
git push origin integration || true
```

### Key Considerations

- Uses `--force` push since dev is a true mirror of upstream releases
- No merge commits, no local history preserved
- Dev branch has no protection (mirror-only branch)
- Syncs to the tagged release commit, not arbitrary dev commits

---

## Phase 2: Integration Branch Merge

### Process

```bash
git checkout integration
git merge dev --no-edit
```

### Conflict Detection Strategy

1. **Attempt merge with `--no-commit` first** to detect conflicts
2. If conflicts detected:
   - Identify conflicting files
   - Apply resolution strategies per file type
   - If unresolvable, create GitHub Issue and abort

### Lock File Resolution (bun.lock)

```bash
# Regenerate lock from merged package.json (preferred)
bun install --frozen-lockfile || bun install
git add bun.lock

# Fallback if regeneration fails: accept upstream lock to unblock, then create an issue
# git checkout --theirs bun.lock
# git add bun.lock
```

### Other Conflict Patterns

| File Pattern                    | Resolution Strategy                                         |
| ------------------------------- | ----------------------------------------------------------- |
| `bun.lock`                      | Regenerate from merged manifest (fallback: accept upstream) |
| `*.md` (docs)                   | Accept upstream                                             |
| `package.json`                  | Manual review required                                      |
| Custom feature files            | Keep ours (integration)                                     |
| Shared code with custom changes | Manual review required                                      |

---

## Phase 3: Post-Merge Validation

### Steps

1. Run `bun install` (ensures dependencies are correct)
2. Run `bun turbo typecheck` (type safety)
3. Run `bun turbo test` (unit tests)
4. Verify build: `bun turbo build`

### Failure Handling

- If validation fails, create GitHub Issue with:
  - Failed step details
  - Error logs
  - Commit SHAs involved
- Do NOT push broken integration branch; abort push and keep `integration` untouched

---

## Phase 4: Notifications

### GitHub Issue Template for Conflicts

```markdown
## Upstream Sync Conflict Report

**Trigger**: Upstream sync at {{ timestamp }}
**Upstream SHA**: {{ upstream_sha }}
**Integration SHA**: {{ integration_sha }}

### Conflicting Files

{{ conflict_list }}

### Recommended Actions

1. Checkout integration branch locally
2. Run: `git merge origin/dev`
3. Resolve conflicts manually
4. Push resolved integration branch

### Logs

<details>
<summary>Merge output</summary>
{{ merge_output }}
</details>
```

### Issue Labels

- `upstream-sync`
- `needs-manual-review`
- Auto-assign to repository maintainers

---

## Implementation Files

### 1. Main Workflow: `.github/workflows/upstream-sync.yml`

Creates the sync pipeline with:

- Scheduled trigger (15 min)
- Manual dispatch option
- Dev mirror sync job
- Integration merge job
- Validation job
- Issue creation on failure
- Concurrency guard to prevent overlapping runs
- Permissions: `contents: write`, `issues: write`, token allowed to force-push `dev`

### 2. Conflict Detection Script: `script/sync/detect-conflicts.ts`

TypeScript script that:

- Attempts merge dry-run
- Parses conflict output
- Categorizes conflicts by file type
- Returns resolution recommendations

### 3. Issue Template: `.github/ISSUE_TEMPLATE/upstream-sync-conflict.md`

Pre-formatted issue template for conflict reports

---

## Branch Protection Configuration

### `dev` Branch (Mirror)

- **No protection** - this is a mirror-only branch
- Force pushes allowed (needed for sync workflow)
- No PRs required
- Not the default branch

### `integration` Branch (Default)

- This is the **default branch** where:
  - Workflow files live
  - Custom features are developed
  - PRs are merged
- Optional protection rules:
  - Require status checks (`typecheck`, `test`, `build`)
  - Require PR for manual changes
- Sync workflow pushes directly (automated merges)

---

## Workflow Diagram

```
┌─────────────────┐
│ Schedule/Manual │
│    Trigger      │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Fetch Upstream │
│  Tags & Check   │
│  for new release│
└────────┬────────┘
         │
    ┌────┴────┐
    │New tag? │
    └────┬────┘
    No   │   Yes
    │    │    │
    v    │    v
  [End]  │┌─────────────────┐
         ││  Reset dev to   │
         ││  release tag    │
         ││  (force push)   │
         │└────────┬────────┘
         │
         v
┌─────────────────┐
│ Merge dev into  │
│  integration    │
└────────┬────────┘
         │
    ┌────┴────┐
    │Conflicts│
    │   ?     │
    └────┬────┘
    No   │   Yes
    │    │    │
    v    │    v
┌───────┐│┌─────────────┐
│ Run   │││ Auto-resolve│
│ Tests │││ (bun.lock)  │
└───┬───┘│└──────┬──────┘
    │    │       │
    │    │  ┌────┴────┐
    │    │  │Resolved?│
    │    │  └────┬────┘
    │    │  Yes  │  No
    │    │   │   │   │
    │    │   v   │   v
    │    │┌─────┐│┌──────────┐
    │    ││Tests│││ Create   │
    │    │└──┬──┘││ Issue    │
    │    │   │   │└──────────┘
    v    v   v   │
┌─────────────┐  │
│Push updated │  │
│ integration │  │
└─────────────┘  │
                 │
         ┌───────┘
         v
    [Workflow End]
```

---

## Critical Files to Create/Modify

1. **Create**: `.github/workflows/upstream-sync.yml` - Main workflow (on `integration` branch)
2. **Create**: `script/sync/detect-conflicts.ts` - Conflict detection helper
3. **Create**: `.github/last-synced-tag` - Tracks last synced upstream release tag
4. **Create**: `.github/ISSUE_TEMPLATE/upstream-sync-conflict.md` - Conflict issue template
5. **Configure**: Repository secret/variable for upstream token (if different) and ensure `GITHUB_TOKEN` can force-push `dev`

## Manual Setup Steps (GitHub UI)

1. **Change default branch**: Settings → Branches → Change default from `dev` to `integration`
2. **Remove branch protection from `dev`**: Settings → Branches → Delete any rules for `dev`
3. **Add branch protection to `integration`** (optional): Require status checks for PRs

---

## Success Criteria Validation

| Criteria                           | Implementation                                                           |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Trigger within 15 min of release   | `cron: '*/15 * * * *'` polls for new tags                                |
| dev syncs with zero manual steps   | Hard reset to tag + force push                                           |
| integration retains custom changes | Merge strategy with "ours" for feature files                             |
| Conflicts flagged within 30 min    | GitHub Issue created immediately on detection                            |
| Audit log maintained               | GitHub Actions run history + commit messages + `.github/last-synced-tag` |

---

## Risks and Mitigations

| Risk                                       | Mitigation                                                     |
| ------------------------------------------ | -------------------------------------------------------------- |
| Force push to dev loses unintended changes | Dev is designated mirror-only; all work happens on integration |
| Frequent conflicts due to active upstream  | Lock file auto-resolution; categorized conflict handling       |
| Test failures block sync                   | Separate validation job; clear failure reporting               |
| GitHub Actions rate limits                 | 15-min schedule is conservative; skip if no changes            |

---

## Manual Runbook

### Resolving Conflicts Manually

1. Check the GitHub Issue created by the workflow
2. Clone or pull latest:
   ```bash
   git fetch origin
   git checkout integration
   git merge origin/dev
   ```
3. Resolve conflicts per the guidance in the issue
4. Run validation locally:
   ```bash
   bun install
   bun turbo typecheck
   bun turbo test
   ```
5. Push resolved branch:
   ```bash
   git push origin integration
   ```
6. Close the GitHub Issue

### Force Re-sync

Trigger manual workflow dispatch from GitHub Actions UI or:

```bash
gh workflow run upstream-sync.yml
```
