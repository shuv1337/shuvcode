---
name: Upstream Sync Conflict
about: Automatically created when upstream sync encounters conflicts
title: "[Upstream Sync] Merge conflict with {{ tag }}"
labels: upstream-sync, needs-manual-review
assignees: ""
---

## Upstream Sync Conflict Report

**Trigger**: Upstream sync at {{ timestamp }}
**Upstream Tag**: {{ tag }}
**Upstream SHA**: {{ upstream_sha }}
**Integration SHA**: {{ integration_sha }}

### Conflicting Files

{{ conflict_list }}

### Recommended Actions

1. Checkout integration branch locally
2. Run: `git fetch origin && git merge origin/dev`
3. Resolve conflicts manually
4. Run validation:
   ```bash
   bun install
   bun turbo typecheck
   bun turbo test
   ```
5. Push resolved integration branch
6. Close this issue

### Resolution Strategies

| File Pattern                    | Resolution Strategy                             |
| ------------------------------- | ----------------------------------------------- |
| `bun.lock`                      | Regenerate from merged manifest: `bun install`  |
| `*.md` (docs)                   | Accept upstream: `git checkout --theirs <file>` |
| `package.json`                  | Manual review required                          |
| `.github/*` (workflow configs)  | Keep ours: `git checkout --ours <file>`         |
| Shared code with custom changes | Manual review required                          |

### Manual Sync Commands

```bash
git fetch origin
git checkout integration
git merge origin/dev

# Resolve conflicts...

bun install
bun turbo typecheck
bun turbo test
bun turbo build

git add .
git commit -m "sync: resolve conflicts with {{ tag }}"
git push origin integration
```

### Logs

<details>
<summary>Merge output</summary>

{{ merge_output }}

</details>
