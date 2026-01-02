# Plan: Fix shuvcode failing with 'preload not found @opentui/solid/preload' in OpenTUI Projects

**Issue:** [#245](https://github.com/Latitudes-Dev/shuvcode/issues/245)
**Date:** 2026-01-02
**Status:** Planning

---

## Problem Summary

When running the **compiled `shuvcode` binary** from within directories that have their own `bunfig.toml` with preload configurations (e.g., OpenTUI SolidJS projects), the CLI fails immediately with:

```
error: preload not found "@opentui/solid/preload"
```

**Critical finding:** This does NOT happen with upstream `opencode` in the same directory!

```bash
$ cd ~/repos/private/tuidoscope
$ cat bunfig.toml
preload = ["@opentui/solid/preload"]

$ shuvcode
error: preload not found "@opentui/solid/preload"

$ opencode
# Works! TUI launches successfully
```

---

## Root Cause Analysis

### The Key Difference: Launcher Architecture

After investigation, the root cause is a **difference in how the binary is invoked** between upstream `opencode` and our fork `shuvcode`:

| Package | `bin/` entry | Type | Behavior |
|---------|-------------|------|----------|
| `opencode-ai` | `bin/opencode` | **Symlink** to compiled ELF binary | Runs binary directly, `autoloadBunfig: false` works |
| `shuvcode` | `bin/shuvcode` | **Node.js launcher script** | Node/Bun executes script first, CWD's bunfig.toml is loaded |

### How Upstream `opencode-ai` Works

1. Package includes a `postinstall.mjs` script
2. On install, `postinstall.mjs` creates a **symlink**: `bin/opencode` → `../opencode-linux-x64/bin/opencode`
3. When user runs `opencode`, they execute the **compiled ELF binary directly**
4. The binary was built with `autoloadBunfig: false`, so CWD's bunfig.toml is ignored

```bash
$ file ~/.bun/install/global/node_modules/opencode-ai/bin/opencode
symbolic link to /home/shuv/.bun/install/global/node_modules/opencode-linux-x64/bin/opencode

$ file ~/.bun/install/global/node_modules/opencode-linux-x64/bin/opencode
ELF 64-bit LSB executable, x86-64...
```

### How Our `shuvcode` Works (Broken)

1. Package ships with a **Node.js launcher script** at `bin/shuvcode`
2. No `postinstall.mjs` script
3. When user runs `shuvcode`:
   - Shell resolves to the Node.js launcher script
   - `#!/usr/bin/env node` causes Node (or Bun) to execute the script
   - **Bun reads CWD's `bunfig.toml` and attempts to apply preloads**
   - Preload resolution fails because `@opentui/solid` isn't installed in shuvcode's context
   - Error occurs **before** the compiled binary even runs

```bash
$ file ~/.bun/install/global/node_modules/shuvcode/bin/shuvcode
Node.js script executable, ASCII text

$ cat ~/.bun/install/global/node_modules/shuvcode/bin/shuvcode
#!/usr/bin/env node
# ... Node.js launcher that finds and spawns the platform binary
```

### Why the Node.js Launcher Exists

The launcher script provides cross-platform binary resolution:
- Detects OS and architecture
- Finds the appropriate platform-specific binary package (e.g., `shuvcode-linux-x64`)
- Spawns it with the correct arguments

However, this indirection causes Bun to load the CWD's `bunfig.toml` during the launcher execution.

---

## Affected Files

### Internal Files

| File | Purpose |
|------|---------|
| `packages/opencode/bin/shuvcode` | Node.js launcher script (the problem) |
| `packages/opencode/script/build.ts` | Build script - already has `autoloadBunfig: false` |
| `script/publish.ts` | Publish script - needs to add postinstall.mjs |

### Files to Create/Modify

| File | Action |
|------|--------|
| `packages/opencode/postinstall.mjs` | **Create** - symlink binary on install |
| `packages/opencode/package.json` | **Modify** - add postinstall script |

### External References

| Reference | URL |
|-----------|-----|
| Upstream `opencode-ai` postinstall | `~/.bun/install/global/node_modules/opencode-ai/postinstall.mjs` |
| Upstream Bun Issue | https://github.com/oven-sh/bun/issues/25442 |
| Bun bunfig.toml Docs | https://bun.sh/docs/runtime/bunfig |

---

## Solution: Add postinstall.mjs (Match Upstream Behavior)

### Recommended Approach

Create a `postinstall.mjs` script that creates a symlink from `bin/shuvcode` to the platform-specific compiled binary, matching upstream's behavior.

### Implementation Details

#### 1. Create `packages/opencode/postinstall.mjs`

Based on upstream's implementation:

```javascript
#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function detectPlatformAndArch() {
  let platform
  switch (os.platform()) {
    case "darwin":
      platform = "darwin"
      break
    case "linux":
      platform = "linux"
      break
    case "win32":
      platform = "windows"
      break
    default:
      platform = os.platform()
      break
  }

  let arch
  switch (os.arch()) {
    case "x64":
      arch = "x64"
      break
    case "arm64":
      arch = "arm64"
      break
    case "arm":
      arch = "arm"
      break
    default:
      arch = os.arch()
      break
  }

  return { platform, arch }
}

function findBinary() {
  const { platform, arch } = detectPlatformAndArch()
  const packageName = `shuvcode-${platform}-${arch}`
  const binaryName = platform === "windows" ? "shuvcode.exe" : "shuvcode"

  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const packageDir = path.dirname(packageJsonPath)
    const binaryPath = path.join(packageDir, "bin", binaryName)

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Binary not found at ${binaryPath}`)
    }

    return { binaryPath, binaryName }
  } catch (error) {
    throw new Error(`Could not find package ${packageName}: ${error.message}`)
  }
}

function prepareBinDirectory(binaryName) {
  const binDir = path.join(__dirname, "bin")
  const targetPath = path.join(binDir, binaryName)

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true })
  }

  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath)
  }

  return { binDir, targetPath }
}

function symlinkBinary(sourcePath, binaryName) {
  const { targetPath } = prepareBinDirectory(binaryName)

  fs.symlinkSync(sourcePath, targetPath)
  console.log(`shuvcode binary symlinked: ${targetPath} -> ${sourcePath}`)

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Failed to symlink binary to ${targetPath}`)
  }
}

async function main() {
  try {
    if (os.platform() === "win32") {
      console.log("Windows detected: binary setup not needed (using packaged .exe)")
      return
    }

    const { binaryPath, binaryName } = findBinary()
    symlinkBinary(binaryPath, binaryName)
  } catch (error) {
    console.error("Failed to setup shuvcode binary:", error.message)
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  console.error("Postinstall script error:", error.message)
  process.exit(0)
}
```

#### 2. Update Publishing Configuration

The publish script needs to:
1. Include `postinstall.mjs` in the published package
2. Add `"postinstall": "bun ./postinstall.mjs || node ./postinstall.mjs"` to package.json scripts
3. Keep `bin/shuvcode` as a placeholder (or remove it and let postinstall create it)

#### 3. Keep Node.js Launcher as Fallback

For Windows or edge cases where symlinks don't work, keep the Node.js launcher available. The postinstall can detect this and skip symlinking.

---

## Implementation Plan

### Phase 1: Create postinstall.mjs

- [ ] Create `packages/opencode/postinstall.mjs` based on upstream's implementation
- [ ] Adapt package name from `opencode-*` to `shuvcode-*`
- [ ] Test locally with `bun link`

### Phase 2: Update Package Configuration

- [ ] Modify `script/publish.ts` to include postinstall.mjs in published package
- [ ] Add postinstall script to generated package.json:
  ```json
  {
    "scripts": {
      "postinstall": "bun ./postinstall.mjs || node ./postinstall.mjs"
    }
  }
  ```
- [ ] Ensure bin/shuvcode placeholder exists or is created by postinstall

### Phase 3: Handle Edge Cases

- [ ] Windows: Skip symlink, use .exe directly (already handled by upstream pattern)
- [ ] Fallback: If symlink fails, log warning but don't fail install
- [ ] Baseline variants: Ensure detection works for `shuvcode-linux-x64-baseline` etc.

### Phase 4: Testing

- [ ] Test fresh global install: `bun install -g shuvcode`
- [ ] Test from OpenTUI project directory with conflicting bunfig.toml
- [ ] Test on Linux (x64, arm64)
- [ ] Test on macOS (arm64, x64)
- [ ] Test on Windows (if possible)
- [ ] Verify TUI functionality works correctly

### Phase 5: Publish and Verify

- [ ] Publish new version
- [ ] Test global install from npm registry
- [ ] Verify issue #245 is resolved

---

## Validation Criteria

### Acceptance Criteria (from Issue #245)

- [ ] shuvcode can be launched from any directory, regardless of whether that directory has a `bunfig.toml` with preloads
- [ ] The fix works for both globally installed (`bun install -g`) and locally linked shuvcode
- [ ] No regression in TUI functionality (SolidJS transforms must still work)

### Test Commands

```bash
# Test scenario: OpenTUI project with conflicting bunfig.toml
cd ~/repos/private/tuidoscope  # or any dir with bunfig.toml preload
cat bunfig.toml
# preload = ["@opentui/solid/preload"]

# Before fix:
shuvcode        # error: preload not found "@opentui/solid/preload"

# After fix:
shuvcode        # TUI launches successfully!

# Verify symlink was created:
file ~/.bun/install/global/node_modules/shuvcode/bin/shuvcode
# Should show: symbolic link to .../shuvcode-linux-x64/bin/shuvcode

# Verify binary is being run directly:
ls -la ~/.bun/install/global/node_modules/shuvcode/bin/
# shuvcode -> /path/to/shuvcode-linux-x64/bin/shuvcode
```

---

## Technical Details

### Why Symlink Solves the Problem

1. **Without symlink (current):**
   ```
   User runs `shuvcode`
   → Shell executes Node.js launcher (#!/usr/bin/env node)
   → Bun/Node reads CWD's bunfig.toml
   → Preload resolution fails
   → Error before binary even starts
   ```

2. **With symlink (fix):**
   ```
   User runs `shuvcode`
   → Shell follows symlink to compiled ELF binary
   → Binary executes directly (no interpreter)
   → Binary has autoloadBunfig: false baked in
   → CWD's bunfig.toml is ignored
   → Success!
   ```

### Build Configuration (Already Correct)

From `packages/opencode/script/build.ts:134-136`:

```typescript
compile: {
  autoloadBunfig: false,  // Already set correctly
  autoloadDotenv: false,
  // ...
}
```

The compiled binary already has the correct setting. We just need to ensure users execute the binary directly instead of through a Node.js launcher.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Symlink fails on some systems | Low | Medium | Keep Node.js launcher as fallback; log warning |
| Windows compatibility | Low | Medium | Skip symlink on Windows; use .exe directly |
| Package manager doesn't run postinstall | Low | High | Document manual setup; provide diagnostic command |
| Baseline variant detection fails | Low | Medium | Test all variants; fallback to non-baseline |

---

## Alternative Solutions Considered

### Option A: Modify Node.js Launcher to Set BUN_CONFIG_FILE

```javascript
// In bin/shuvcode launcher
process.env.BUN_CONFIG_FILE = ""  // or path to empty config
```

**Rejected:** The preload error occurs when Bun interprets the launcher script itself, before any JavaScript code runs.

### Option B: Use Shell Wrapper Instead of Node.js

```bash
#!/bin/sh
exec /path/to/compiled/binary "$@"
```

**Rejected:** Would require platform-specific shell scripts; symlink is cleaner.

### Option C: Change Shebang to #!/usr/bin/env bun with --config

**Rejected:** `--config` would need to point to shuvcode's bunfig.toml, which isn't at a known absolute path.

---

## Follow-up Actions

1. **After implementation:** Update issue #245 with resolution
2. **Documentation:** Add note about the postinstall behavior
3. **Monitor:** Watch for any edge cases reported by users
4. **Upstream:** The underlying Bun bug ([oven-sh/bun#25442](https://github.com/oven-sh/bun/issues/25442)) remains open; monitor for fixes

---

## Summary

The issue is that `shuvcode` uses a **Node.js launcher script** while upstream `opencode` uses a **symlink to the compiled binary**. When a Node.js script is executed via Bun, Bun reads the CWD's `bunfig.toml` and attempts to apply preloads, which fails.

**The fix:** Add a `postinstall.mjs` script (matching upstream) that creates a symlink from `bin/shuvcode` to the platform-specific compiled binary. This ensures users execute the compiled binary directly, bypassing the bunfig.toml loading issue.

**Effort estimate:** Medium (2-4 hours including testing)
**Risk:** Low
**Dependencies:** None
