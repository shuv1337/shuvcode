import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const version = "2.0.0-metadata-test"

test("compiled metadata commands do not extract OpenTUI native libraries", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "shuvcode-metadata-binary-"))
  const outdir = path.join(temporary, "build")
  const bunTmpdir = path.join(temporary, "bun-tmp")
  await mkdir(bunTmpdir, { mode: 0o700 })

  try {
    const build = await run(
      process.execPath,
      ["run", "script/build.ts", "--single", "--skip-install", `--outdir=${outdir}`],
      temporary,
      { OPENCODE_VERSION: version, OPENCODE_CHANNEL: "latest" },
    )
    if (build.exitCode !== 0) throw new Error(build.stdout + build.stderr)

    const target = `shuvcode-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
    const candidates = [path.join(outdir, target, "bin", "shuvcode"), path.join(outdir, target, "bin", "shuvcode.exe")]
    const executable = (
      await Promise.all(candidates.map(async (file) => ((await Bun.file(file).exists()) ? file : "")))
    )
      .filter(Boolean)
      .at(0)
    if (!executable) throw new Error(`Compiled binary not found under ${path.join(outdir, target)}`)

    expect(await nativeArtifacts(bunTmpdir)).toEqual([])
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await run(executable, ["--version"], bunTmpdir)
      expect(result).toEqual({ stdout: `shuvcode v${version}\n`, stderr: "", exitCode: 0 })
      expect(await nativeArtifacts(bunTmpdir)).toEqual([])
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await run(executable, ["--help"], bunTmpdir)
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe("")
      expect(result.stdout).toStartWith("DESCRIPTION\n  shuvcode — OpenCode v2 fork command line interface\n")
      expect(result.stdout).toContain("--version, -v")
      expect(await nativeArtifacts(bunTmpdir)).toEqual([])
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}, 30_000)

async function run(executable: string, args: string[], bunTmpdir: string, env?: Record<string, string>) {
  const child = Bun.spawn([executable, ...args], {
    cwd: root,
    env: { ...process.env, ...env, BUN_TMPDIR: bunTmpdir },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

async function nativeArtifacts(directory: string) {
  const glob = new Bun.Glob("**/*.{so,dylib,dll}")
  const files: string[] = []
  for await (const file of glob.scan({ cwd: directory, dot: true, onlyFiles: true })) files.push(file)
  return files.toSorted()
}
