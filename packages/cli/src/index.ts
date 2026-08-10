#!/usr/bin/env bun

import { run } from "./metadata"

// Keep metadata in the entry chunk and the full CLI behind one lazy boundary. With two lazy roots,
// Bun can hoist their shared modules into a chunk that initializes OpenTUI before argument dispatch.
const args = process.argv.slice(2)
const separator = args.indexOf("--")
const metadata = args
  .slice(0, separator === -1 ? undefined : separator)
  .some((arg) => ["--help", "-h", "--version", "-v", "--completions"].includes(arg))

if (metadata) run()
else await import("./main")
