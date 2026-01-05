## IMPORTANT

- This is a FORK of sst/opencode - the fork repo is Latitudes-Dev/shuvcode
- NEVER create PRs against upstream (sst/opencode)
- ALWAYS use `--repo Latitudes-Dev/shuvcode` when creating PRs with `gh`
- All PRs should target the fork repository, not upstream

## Debugging

- To test opencode in the `packages/opencode` directory you can run `bun dev`
- To regenerate the javascript SDK, run ./packages/sdk/js/script/build.ts
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- the default branch in this repo is `dev`

## Upstream Merge Operations

When merging upstream tags (e.g., v1.1.1):
1. Use `git merge <tag> --no-commit` to start merge without auto-commit
2. List conflicts: `git diff --name-only --diff-filter=U`
3. Cannot commit plan updates mid-merge - all conflict resolution must complete first
4. For files deleted in fork but modified upstream (delete/modify conflicts), decide per-file:
   - `.opencode/*` files are upstream-specific, delete them: `git rm <file>`
