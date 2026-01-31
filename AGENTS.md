## IMPORTANT

- This is a FORK of sst/opencode - the fork repo is Latitudes-Dev/shuvcode
- NEVER create PRs against upstream (sst/opencode)
- ALWAYS use `--repo Latitudes-Dev/shuvcode` when creating PRs with `gh`
- All PRs should target the fork repository, not upstream

## Debugging

- To test opencode in the `packages/opencode` directory you can run `bun dev`
- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Testing

- Avoid testing logic directly inside Solid.js `.tsx` files if they import JSX runtimes, as `bun test` may fail with `jsxDEV` errors.
- Separate pure logic into `.ts` files (e.g., `theme-utils.ts`) and test those instead.

## Upstream Merge Operations

When merging upstream tags (e.g., v1.1.1):

1. Use `git merge <tag> --no-commit` to start merge without auto-commit
2. List conflicts: `git diff --name-only --diff-filter=U`
3. Cannot commit plan updates mid-merge - all conflict resolution must complete first
4. For files deleted in fork but modified upstream (delete/modify conflicts), decide per-file:
   - `.opencode/*` files are upstream-specific, delete them: `git rm <file>`

## Style Guide

- Keep things in one function unless composable or reusable
- Avoid unnecessary destructuring. Instead of `const { a, b } = obj`, use `obj.a` and `obj.b` to preserve context
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity

### Avoid let statements

We don't like `let` statements, especially combined with if/else statements.
Prefer `const`.

Good:

```ts
const foo = condition ? 1 : 2
```

Bad:

```ts
let foo

if (condition) foo = 1
else foo = 2
```

### Avoid else statements

Prefer early returns or using an `iife` to avoid else statements.

Good:

```ts
function foo() {
  if (condition) return 1
  return 2
}
```

Bad:

```ts
function foo() {
  if (condition) return 1
  else return 2
}
```

### Prefer single word naming

Try your best to find a single word name for your variables, functions, etc.
Only use multiple words if you cannot.

Good:

```ts
const foo = 1
const bar = 2
const baz = 3
```

Bad:

```ts
const fooBar = 1
const barBaz = 2
const bazFoo = 3
```

## Testing

You MUST avoid using `mocks` as much as possible.
Tests MUST test actual implementation, do not duplicate logic into a test.
