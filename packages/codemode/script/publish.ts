#!/usr/bin/env bun

import { $ } from "bun"
import { fileURLToPath } from "node:url"

// The fork's release tests still use this entrypoint to verify the packed package.
process.chdir(fileURLToPath(new URL("..", import.meta.url)))
await $`bun run typecheck:tsc`
await $`bun run build`
await import("./pack.js")
