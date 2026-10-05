import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { nodeBinDirectory, prependNodeBin } from "../../script/node-bin"

const describeUnix = process.platform === "win32" ? describe.skip : describe

describe("prependNodeBin", () => {
  test("puts the node directory ahead of the rest of PATH", () => {
    const env = prependNodeBin({ HOME: "/home", PATH: ["/shim", "/usr/bin"].join(path.delimiter) }, "/real")
    expect(env.HOME).toBe("/home")
    expect(env.PATH).toBe(["/real", "/shim", "/usr/bin"].join(path.delimiter))
  })

  test("leaves PATH alone when that directory is already first", () => {
    const env = { PATH: ["/real", "/shim"].join(path.delimiter) }
    expect(prependNodeBin(env, "/real")).toBe(env)
  })

  test("moves a later copy of the directory to the front", () => {
    const env = prependNodeBin({ PATH: ["/shim", "/real", "/usr/bin"].join(path.delimiter) }, "/real")
    expect(env.PATH).toBe(["/real", "/shim", "/usr/bin"].join(path.delimiter))
  })

  test("returns the same environment when node was not resolved", () => {
    const env = { PATH: "/usr/bin" }
    expect(prependNodeBin(env, undefined)).toBe(env)
  })

  test("updates the existing Path key", () => {
    const env = prependNodeBin({ Path: "/shim" }, "/real")
    expect(env.Path).toBe(`/real${path.delimiter}/shim`)
    expect("PATH" in env).toBe(false)
  })
})

describeUnix("nodeBinDirectory", () => {
  test("uses the binary resolved before HOME changes", async () => {
    await using tmp = await tempdir()
    const home = path.join(tmp.path, "home")
    const isolated = path.join(tmp.path, "isolated")
    const shim = path.join(tmp.path, "shim")
    const real = path.join(tmp.path, "real")
    await fs.mkdir(home)
    await fs.mkdir(shim)
    await fs.mkdir(real)
    const realNode = path.join(real, "node")
    await writeExec(realNode, "#!/bin/sh\nprintf '%s' ok\n")
    await writeExec(
      path.join(shim, "node"),
      `#!/bin/sh\nif [ "$HOME" != ${shQuote(home)} ]; then exit 1; fi\nprintf '%s' ${shQuote(realNode)}\n`,
    )

    const parent = { HOME: home, PATH: [shim, real].join(path.delimiter) }
    const broken = Bun.spawnSync({
      cmd: ["node"],
      env: { HOME: isolated, PATH: parent.PATH },
      stdout: "pipe",
      stderr: "ignore",
    })
    expect(broken.exitCode).not.toBe(0)

    const bin = await nodeBinDirectory(parent)
    expect(bin).toBe(real)
    const child = Bun.spawnSync({
      cmd: ["node"],
      env: prependNodeBin({ HOME: isolated, PATH: parent.PATH }, bin),
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(child.exitCode, child.stderr.toString()).toBe(0)
    expect(child.stdout.toString()).toBe("ok")
  })

  test("returns undefined when node is missing", async () => {
    await using tmp = await tempdir()
    const empty = path.join(tmp.path, "empty")
    await fs.mkdir(empty)
    expect(await nodeBinDirectory({ PATH: empty })).toBeUndefined()
  })

  test("returns undefined when node exits non-zero", async () => {
    await using tmp = await tempdir()
    const shim = path.join(tmp.path, "shim")
    await fs.mkdir(shim)
    await writeExec(path.join(shim, "node"), "#!/bin/sh\nexit 1\n")
    expect(await nodeBinDirectory({ PATH: shim })).toBeUndefined()
  })

  test("returns undefined when node does not print an absolute path", async () => {
    await using tmp = await tempdir()
    const shim = path.join(tmp.path, "shim")
    await fs.mkdir(shim)
    await writeExec(path.join(shim, "node"), "#!/bin/sh\nprintf '%s' node\n")
    expect(await nodeBinDirectory({ PATH: shim })).toBeUndefined()
  })

  test("returns undefined when the resolved file is not named node", async () => {
    await using tmp = await tempdir()
    const shim = path.join(tmp.path, "shim")
    await fs.mkdir(shim)
    const other = path.join(tmp.path, "nodejs")
    await writeExec(other, "#!/bin/sh\nprintf '%s' ok\n")
    await writeExec(path.join(shim, "node"), `#!/bin/sh\nprintf '%s' ${shQuote(other)}\n`)
    expect(await nodeBinDirectory({ PATH: shim })).toBeUndefined()
  })
})

async function tempdir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "node-bin-"))
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

async function writeExec(file: string, body: string) {
  await fs.writeFile(file, body)
  await fs.chmod(file, 0o755)
}

function shQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
