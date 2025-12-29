## Summary

Address GitHub issue #215: file viewer and Review tab render blank content in the web app. The plan focuses on isolating the root cause (likely CSS containment, worker initialization, or render timing), implementing a fix, and adding regression coverage.

## Source Context (Issue + Conversation)

### GitHub Issue #215 (bug report)
- Symptoms: Review tab shows headers only; file tabs are blank; no console errors.
- Expected: diffs and file contents render with syntax highlighting.
- Affected: web app in `packages/app` and UI components in `packages/ui`.
- Suspects: CSS containment (`content-visibility`, `contain-strict`), web worker init, render timing.
- Acceptance criteria: file content visible, diff visible in split/inline, no regression.
- Investigation checklist included in issue.

### Conversation/Project Context (provided)
- Main branch is `integration`.
- Existing work added a GitHub App (`shuvcode-agent`) and a Cloudflare Worker deployment target (`api.shuv.ai`), but deployment is currently blocked by Durable Objects migration config in `sst.api.config.ts` (unrelated to this issue; noted as background context).

## Goals

- Restore rendering of file contents in individual file tabs.
- Restore rendering of diffs in Review tab (split and inline).
- Preserve syntax highlighting and avoid regressions.
- Keep changes compatible with upstream behavior and local builds.

## Non-Goals

- No backend or Cloudflare Worker changes for this issue.
- No re-architecture of `@pierre/diffs` usage beyond what is needed to fix the blank rendering.

## Relevant Internal Files

| Area | File | Role |
| --- | --- | --- |
| App session UI | `packages/app/src/pages/session.tsx` | Renders Review tab and file tabs using `SessionReview` and `Dynamic` code component |
| Review tab | `packages/ui/src/components/session-review.tsx` | Renders diff UI via `useDiffComponent()` |
| Diff renderer | `packages/ui/src/components/diff.tsx` | Wraps `FileDiff().render()` with worker pool |
| Code renderer | `packages/ui/src/components/code.tsx` | Wraps `File().render()` with worker pool |
| Diff CSS | `packages/ui/src/components/diff.css` | Contains `content-visibility: auto` (likely culprit) |
| Code CSS | `packages/ui/src/components/code.css` | Contains `content-visibility: auto` and `overflow: hidden` |
| Worker pool | `packages/ui/src/pierre/worker.ts` | Initializes `WorkerPoolManager` with Shiki worker |
| Pierre options | `packages/ui/src/pierre/index.ts` | `createDefaultOptions` and `styleVariables` |
| Diff context | `packages/ui/src/context/diff.tsx` | Provider for diff component |
| Code context | `packages/ui/src/context/code.tsx` | Provider for code component |
| App root | `packages/app/src/app.tsx` | Provides diff/code components to app |

## External References (for worker and render behavior)

Use these references when validating worker behavior or adjusting how workers are loaded.

| Topic | Source | Git URL |
| --- | --- | --- |
| Vite worker creation (module) | Example of `new Worker(new URL(...), { type: "module" })` | https://github.com/vitejs/vite/blob/main/docs/guide/features.md |
| Vite worker query usage | Example `?worker` import usage | https://github.com/egoist/haya/blob/main/CHANGELOG.md |
| Vite issue: `?url`/`?worker` in deps | Known limitation in third-party modules | https://github.com/vitejs/vite/issues/10837 |
| Worker creation patterns | Worker with `new URL(..., import.meta.url)` | https://github.com/web-infra-dev/rspack/blob/main/website/docs/en/guide/features/web-workers.mdx |
| content-visibility CSS | MDN documentation | https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility |

## Technical Summary of Current Flow

- `SessionReview` requests a diff renderer from `useDiffComponent()` and passes in `before`/`after` file contents.
- `Diff` (`packages/ui/src/components/diff.tsx`) constructs `FileDiff` and calls `render(...)` into a container div inside a `createEffect`.
- `Code` (`packages/ui/src/components/code.tsx`) does the same using `File` and `render(...)`.
- `workerPool` is created client-side only; on SSR it is `undefined`.
- If the `@pierre/diffs` worker fails to load or render, the container is cleared and remains blank.
- **Critical**: Both `diff.css` and `code.css` use `content-visibility: auto` without `contain-intrinsic-size`, which can cause browsers to skip rendering content with zero intrinsic height.
- **Critical**: Parent containers in `session.tsx` use `contain-strict` class which creates containment context.

## Hypotheses / Failure Modes (Prioritized)

| Priority | Hypothesis | Evidence to collect | Expected signal |
| --- | --- | --- | --- |
| **1 (HIGH)** | `content-visibility: auto` without `contain-intrinsic-size` causes browser to skip rendering | Inspect computed styles, check if DOM nodes exist but invisible | Nodes in DOM but zero height, removing CSS property fixes issue |
| **2 (HIGH)** | `contain-strict` on parent clips or hides child content | Remove `contain-strict` temporarily | Content renders when removed |
| **3 (MED)** | Worker pool creation throws silently (no try/catch) | Add try/catch, check console | Error logged during pool creation |
| **4 (MED)** | Worker fails to load | Network tab, worker errors, failed chunk load | Missing worker chunk or 404 in DevTools |
| **5 (MED)** | `FileDiff.render()` runs before container has dimensions | Log render timing and container dimensions | render called but container has 0x0 size |
| **6 (LOW)** | `workerPool` is undefined and `@pierre/diffs` doesn't handle it | Log `workerPool` value before render | `workerPool` is undefined on client |
| **7 (LOW)** | Theme "OpenCode" not registered before worker init | Check console for theme errors | Shiki theme error messages |

## Implementation Plan

### Milestone 1: CSS Investigation (Highest Priority)

This is the most likely root cause based on code review.

- [ ] Inspect the rendered DOM in DevTools:
  - Check if `[data-component="diff"]` and `[data-component="code"]` elements exist
  - Check their computed `height` and `content-visibility` values
  - Check if they have children (rendered content from `@pierre/diffs`)
- [x] Test fix for `content-visibility` by adding `contain-intrinsic-size`:
  ```css
  [data-component="code"] {
    content-visibility: auto;
    contain-intrinsic-size: 0 300px; /* Provide minimum intrinsic height */
    overflow: hidden;
  }
  
  [data-component="diff"] {
    content-visibility: auto;
    contain-intrinsic-size: 0 300px;
  }
  ```
- [ ] Test removing `contain-strict` from `Tabs.Content` in `session.tsx:902,937` temporarily
- [ ] If CSS fixes resolve the issue, proceed to Milestone 5 (cleanup). Otherwise, continue to Milestone 2.

### Milestone 2: Worker Pool Error Handling

Add defensive error handling to catch silent failures.

- [x] Add try/catch around worker pool creation in `packages/ui/src/pierre/worker.ts`:
  ```typescript
  export const workerPool: WorkerPoolManager | undefined = (() => {
    if (typeof window === "undefined") {
      return undefined
    }
    try {
      return getOrCreateWorkerPoolSingleton({
        poolOptions: {
          workerFactory,
          poolSize: 2,
        },
        highlighterOptions: {
          theme: "OpenCode",
        },
      })
    } catch (error) {
      console.error("[pierre/worker] Failed to create worker pool:", error)
      return undefined
    }
  })()
  ```
- [x] Log the resolved `ShikiWorkerUrl` value to verify it's a valid URL string:
  ```typescript
  if (import.meta.env.DEV) {
    console.debug("[pierre/worker] ShikiWorkerUrl:", ShikiWorkerUrl)
  }
  ```
- [ ] Verify worker script loads in Network tab (filter by "worker" type)
- [ ] Check browser console for any worker-related errors

### Milestone 3: Render Lifecycle Validation

Ensure render is called when container is ready and has dimensions.

- [ ] Add debug logging to `diff.tsx` and `code.tsx` (use debug flag):
  ```typescript
  createEffect(() => {
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('debug')) {
      console.debug('[Diff] Rendering', {
        containerExists: !!container,
        containerDimensions: container ? { w: container.offsetWidth, h: container.offsetHeight } : null,
        workerPoolExists: !!workerPool,
      })
    }
    container.innerHTML = ""
    fileDiff().render({ ... })
  })
  ```
- [ ] If container has zero dimensions, defer render using `requestAnimationFrame`:
  ```typescript
  createEffect(() => {
    const doRender = () => {
      if (container.offsetWidth === 0 || container.offsetHeight === 0) {
        requestAnimationFrame(doRender)
        return
      }
      container.innerHTML = ""
      fileDiff().render({ ... })
    }
    doRender()
  })
  ```
- [ ] Verify `@pierre/diffs` behavior when `workerPool` is `undefined`:
  - Check if it falls back to synchronous rendering
  - Check if it throws or fails silently
  - Add explicit handling if needed

### Milestone 4: Accordion & Tab Visibility

Ensure content renders correctly when accordion expands or tabs switch.

- [ ] Verify `SessionReview` accordion items trigger re-render on expand
- [ ] Check that tab content re-renders when tab becomes active
- [ ] If needed, add explicit reactive trigger on visibility change

### Milestone 5: Finalize Fix & Regression Coverage

- [ ] Remove all debug logging (or gate behind `import.meta.env.DEV`)
- [ ] Verify fix works in:
  - [ ] Chrome/Chromium
  - [ ] Safari (known to have slower worker boot)
  - [ ] Firefox
  - [ ] Mobile Safari
  - [ ] Mobile Chrome
- [ ] Verify both dev (`bun dev`) and production (`bun build`) builds
- [x] Add console warning for silent render failures:
  ```typescript
  createEffect(() => {
    container.innerHTML = ""
    fileDiff().render({ ... })
    // Check if render succeeded after microtask
    queueMicrotask(() => {
      if (container.children.length === 0) {
        console.warn('[Diff] Render may have failed - container is empty')
      }
    })
  })
  ```

### Milestone 6: Testing Strategy

**Note**: UI tests should NOT go in `packages/opencode/test/` - that directory contains backend/CLI tests only.

- [ ] Create manual testing checklist:
  1. Open web app at `http://localhost:3000`
  2. Create or open a session with file changes
  3. Navigate to Review tab - verify diffs render
  4. Toggle between Split and Inline modes
  5. Click on individual file tabs - verify code renders with syntax highlighting
  6. Collapse and expand accordion items in Review tab
  7. Test on mobile viewport (use DevTools device mode)
- [ ] Future: Consider adding E2E tests in `packages/app/test/e2e/` using Playwright
- [ ] Document the fix in a code comment explaining the CSS containment issue

## Debugging Commands

```bash
# Start dev server
cd packages/app && bun dev

# Open with debug flag
open "http://localhost:3000/<project>/session/<session-id>?debug=diffs"

# Check worker chunk exists in build
cd packages/app && bun build && ls -la dist/assets | grep worker

# Check @pierre/diffs version
cat package.json | grep '@pierre/diffs'
```

## Validation Criteria

### Functional Checks
- [ ] Review tab renders diff content for at least one file
- [ ] File tabs display the file contents with syntax highlighting
- [ ] Split and inline diff modes both render correctly
- [ ] Accordion expand/collapse works correctly
- [ ] Mobile overlay (`Portal`) renders content correctly

### Technical Checks
- [ ] Worker script loads successfully in dev and production builds
- [ ] No console errors during normal operation
- [ ] `content-visibility` doesn't cause invisible content
- [ ] Worker pool creation failure is logged if it occurs

## Implementation Order (Dependencies)

1. **CSS containment fix** (Milestone 1) - most likely cause, try first
2. **Worker error handling** (Milestone 2) - defensive, do regardless
3. **Render lifecycle fixes** (Milestone 3) - if CSS fix isn't sufficient
4. **Accordion/tab visibility** (Milestone 4) - if content appears then disappears
5. **Cleanup and testing** (Milestones 5-6) - always do last

## Risk Assessment

| Change | Risk Level | Mitigation |
| --- | --- | --- |
| Adding `contain-intrinsic-size` to CSS | Low | Standard CSS property, easy to revert |
| Adding try/catch to worker pool | Low | Defensive code, no behavior change on success |
| Deferring render with `requestAnimationFrame` | Medium | Could cause flash of unstyled content; test thoroughly |
| Removing `contain-strict` | Medium | May affect layout in other areas; prefer targeted fix |

## Rollback Strategy

If the fix introduces regressions:
1. Revert the commit with `git revert <sha>`
2. All changes are in `packages/ui` and `packages/app` - no backend impact
3. No database or API changes - clean rollback

## Browser Testing Matrix

| Browser | Platform | Priority | Notes |
| --- | --- | --- | --- |
| Chrome | Desktop | P0 | Primary development browser |
| Safari | Desktop | P0 | Known slower worker boot (poolSize=2 accommodates this) |
| Firefox | Desktop | P1 | Secondary browser |
| Chrome | Mobile | P1 | Mobile view uses Portal for tabs |
| Safari | Mobile | P1 | iOS primary browser |

## Open Questions (Resolved)

- ~~Should the regression test live in `packages/opencode/test/`?~~ **No** - that directory is for backend/CLI tests. UI tests should go in `packages/app/test/` or remain as manual testing checklist until E2E infrastructure is added.
- ~~Is this bug reproducible in all browsers?~~ **Unknown** - testing matrix added above to validate.

## Notes

- No changes to Cloudflare deployment or `sst.api.config.ts` are required for this issue.
- Keep changes minimal to ease upstream alignment with `sst/opencode`.
- The `@pierre/diffs` package version is `1.0.2` (from root `package.json`).
- Theme "OpenCode" is registered in `MarkedProvider` - ensure this happens before worker pool access.
