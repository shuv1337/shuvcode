#!/usr/bin/env node

import childProcess from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const directory = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const packageJson = JSON.parse(fs.readFileSync(path.join(directory, "../package.json"), "utf8"))
const command = Object.keys(packageJson.bin ?? {})[0]
if (!command) fail("Shuvcode package does not declare a binary")

const platform = { darwin: "darwin", linux: "linux", win32: "windows" }[os.platform()] ?? os.platform()
const arch = { x64: "x64", arm64: "arm64", arm: "arm" }[os.arch()] ?? os.arch()
const sourceBinary = platform === "windows" ? `${command}.exe` : command
const dependencies = packageJson.optionalDependencies ?? {}
const base = Object.keys(dependencies).find((name) => name.endsWith(`-${platform}-${arch}`))
if (!base) fail(`Shuvcode does not provide a binary for ${platform}-${arch}`)

function supportsAvx2() {
  if (arch !== "x64") return false
  if (platform === "linux") {
    try {
      return /(^|\s)avx2(\s|$)/i.test(fs.readFileSync("/proc/cpuinfo", "utf8"))
    } catch {
      return false
    }
  }
  if (platform === "darwin") {
    const result = childProcess.spawnSync("sysctl", ["-n", "hw.optional.avx2_0"], {
      encoding: "utf8",
      timeout: 1500,
    })
    return result.status === 0 && (result.stdout || "").trim() === "1"
  }
  if (platform === "windows") {
    const script =
      '(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'
    for (const executable of ["powershell.exe", "pwsh.exe", "pwsh", "powershell"]) {
      const result = childProcess.spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        timeout: 3000,
        windowsHide: true,
      })
      if (result.status !== 0) continue
      const output = (result.stdout || "").trim().toLowerCase()
      if (output === "true" || output === "1") return true
      if (output === "false" || output === "0") return false
    }
  }
  return false
}

function isMusl() {
  if (platform !== "linux") return false
  try {
    if (fs.existsSync("/etc/alpine-release")) return true
    const result = childProcess.spawnSync("ldd", ["--version"], { encoding: "utf8" })
    return `${result.stdout || ""}${result.stderr || ""}`.toLowerCase().includes("musl")
  } catch {
    return false
  }
}

function packageNames() {
  const baseline = arch === "x64" && !supportsAvx2()
  const names =
    platform === "linux"
      ? isMusl()
        ? arch === "x64"
          ? baseline
            ? [`${base}-baseline-musl`, `${base}-musl`, `${base}-baseline`, base]
            : [`${base}-musl`, `${base}-baseline-musl`, base, `${base}-baseline`]
          : [`${base}-musl`, base]
        : arch === "x64"
          ? baseline
            ? [`${base}-baseline`, base, `${base}-baseline-musl`, `${base}-musl`]
            : [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]
          : [base, `${base}-musl`]
      : arch === "x64"
        ? baseline
          ? [`${base}-baseline`, base]
          : [base, `${base}-baseline`]
        : [base]
  return names.filter((name) => dependencies[name])
}

function resolveBinary(name) {
  const packagePath = require.resolve(`${name}/package.json`)
  const binary = path.join(path.dirname(packagePath), "bin", sourceBinary)
  if (!fs.existsSync(binary)) throw new Error(`Binary not found at ${binary}`)
  return binary
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

const names = packageNames()
const binary = names.reduce((result, name) => {
  if (result) return result
  try {
    return resolveBinary(name)
  } catch {
    return undefined
  }
}, undefined)

if (!binary) fail(`Failed to find Shuvcode binary package. Reinstall ${packageJson.name}.`)

const result = childProcess.spawnSync(binary, process.argv.slice(2), {
  stdio: "inherit",
  windowsHide: true,
})
if (result.error) fail(result.error.message)
if (result.signal) process.kill(process.pid, result.signal)
process.exit(result.status ?? 1)
