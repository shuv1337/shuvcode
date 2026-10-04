import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { detachedBranches, nextForkVersion, parseForkVersion, resolveChannel } from "../src/version.js"

const directories: string[] = []
const temporaryDirectory = async () => {
  const dir = await fs.mkdtemp(path.join(import.meta.dir, "script-channel-"))
  directories.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("resolveChannel", () => {
  test("prefers an explicit channel without reading git", async () => {
    expect(
      await resolveChannel({ channel: " beta ", branch: () => Promise.reject(new Error("branch should not be read")) }),
    ).toBe("beta")
  })

  test("uses latest for releases", async () => {
    expect(await resolveChannel({ bump: "patch", branch: async () => "v2-rewrite" })).toBe("latest")
    expect(await resolveChannel({ version: "2.0.3-shuv.1", branch: async () => "v2-rewrite" })).toBe("latest")
  })

  test("uses the current branch for preview builds", async () => {
    expect(await resolveChannel({ branch: async () => "v2-rewrite\n" })).toBe("v2-rewrite")
  })

  test("resolves a detached HEAD from the branches or bookmarks at the working copy", async () => {
    expect(await resolveChannel({ branch: async () => "", detachedBranches: async () => ["integration-v2"] })).toBe(
      "integration-v2",
    )
    expect(
      await resolveChannel({ branch: async () => "", detachedBranches: async () => [" integration-v2 ", ""] }),
    ).toBe("integration-v2")
  })

  test("fails with the candidates when several branches or bookmarks point at the working copy", async () => {
    await expect(
      resolveChannel({ branch: async () => "", detachedBranches: async () => ["zeta", " alpha ", ""] }),
    ).rejects.toThrow("(zeta, alpha). Set OPENCODE_CHANNEL")
  })

  test("resolves a detached GitHub Actions checkout from the workflow ref", async () => {
    const none = async () => []
    expect(
      await resolveChannel({
        branch: async () => "",
        github: { headRef: "fix-channel", refName: "12/merge", refType: "branch" },
        detachedBranches: none,
      }),
    ).toBe("fix-channel")
    expect(
      await resolveChannel({
        branch: async () => "",
        github: { headRef: "", refName: "integration-v2", refType: "branch" },
        detachedBranches: none,
      }),
    ).toBe("integration-v2")
    await expect(
      resolveChannel({ branch: async () => "", github: { refName: "v1.0.0", refType: "tag" }, detachedBranches: none }),
    ).rejects.toThrow("OPENCODE_CHANNEL")
  })

  test("fails instead of producing an empty channel", async () => {
    await expect(resolveChannel({ branch: async () => "" })).rejects.toThrow("OPENCODE_CHANNEL")
    await expect(
      resolveChannel({
        branch: () => Promise.reject(new Error("not a git repository")),
        detachedBranches: async () => [],
      }),
    ).rejects.toThrow("OPENCODE_CHANNEL")
  })

  test("requires an explicit channel when detached branch lookup fails", async () => {
    await expect(
      resolveChannel({
        branch: async () => "",
        detachedBranches: async () => {
          throw new Error("lookup failed")
        },
      }),
    ).rejects.toThrow("OPENCODE_CHANNEL")
  })
})

describe("plain git detachedBranches", () => {
  test("uses the single branch tip and excludes the detached HEAD pseudo-branch", async () => {
    const dir = await temporaryDirectory()
    await $`git init --initial-branch=integration-v2 ${dir}`.quiet()
    await $`git -c user.name=test -c user.email=test@example.com commit --allow-empty -m base`.cwd(dir).quiet()
    await $`git checkout --detach`.cwd(dir).quiet()
    expect(await detachedBranches(dir)).toEqual(["integration-v2"])
    expect(await resolveChannel({ branch: async () => "", detachedBranches: () => detachedBranches(dir) })).toBe(
      "integration-v2",
    )
  })
})

describe.skipIf(!Bun.which("jj"))("detachedBranches", () => {
  const repo = async () => {
    const dir = await temporaryDirectory()
    const jj = (args: string[]) =>
      $`jj --config user.name=test --config user.email=test@example.com ${args}`.cwd(dir).quiet()
    await jj(["git", "init", "--colocate"])
    await jj(["commit", "-m", "base"])
    await jj(["bookmark", "create", "integration-v2", "-r", "@-"])
    return { dir, jj }
  }

  test("reads the working-copy parent bookmark in a jj-colocated checkout", async () => {
    const { dir } = await repo()
    expect((await $`git branch --show-current`.cwd(dir).quiet().text()).trim()).toBe("")
    expect(await resolveChannel({ branch: async () => "", detachedBranches: () => detachedBranches(dir) })).toBe(
      "integration-v2",
    )
  })

  test("prefers a bookmark on the working copy over its parent", async () => {
    const { dir, jj } = await repo()
    await jj(["bookmark", "create", "fix-x", "-r", "@"])
    expect(await resolveChannel({ branch: async () => "", detachedBranches: () => detachedBranches(dir) })).toBe(
      "fix-x",
    )
  })

  test.each(["failed", "missing"])("rejects a %s jj lookup instead of using git HEAD", async (mode) => {
    const { dir, jj } = await repo()
    await jj(["bookmark", "create", "fix-x", "-r", "@"])
    const bin = path.join(dir, "bin")
    await fs.mkdir(bin)
    await fs.symlink(Bun.which("git")!, path.join(bin, "git"))
    if (mode === "failed") {
      await Bun.write(path.join(bin, "jj"), "#!/bin/sh\nexit 1\n")
      await fs.chmod(path.join(bin, "jj"), 0o755)
    }
    const script = `
      import { detachedBranches, resolveChannel } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/version.ts"))};
      await resolveChannel({ branch: async () => "", detachedBranches: () => detachedBranches(${JSON.stringify(dir)}) });
    `
    const result = await $`${process.execPath} -e ${script}`
      .env({ ...process.env, PATH: bin })
      .quiet()
      .nothrow()
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("OPENCODE_CHANNEL")
  })

  test("rejects an unimported git branch at the working-copy parent", async () => {
    const { dir, jj } = await repo()
    await $`git branch extra-git-only`.cwd(dir).quiet()
    await expect(
      resolveChannel({ branch: async () => "", detachedBranches: () => detachedBranches(dir) }),
    ).rejects.toThrow("(integration-v2, extra-git-only). Set OPENCODE_CHANNEL")
    // The lookup must see git-side refs without importing them into jj.
    expect(
      (await jj(["log", "--ignore-working-copy", "--no-graph", "-r", "@-", "-T", "local_bookmarks"])).text().trim(),
    ).toBe("integration-v2")
  })

  test("prefers an unimported git branch at the working copy over its parent", async () => {
    const { dir, jj } = await repo()
    const commit = (await jj(["log", "--ignore-working-copy", "--no-graph", "-r", "@", "-T", "commit_id"]))
      .text()
      .trim()
    await $`git branch fix-x ${commit}`.cwd(dir).quiet()
    expect(await resolveChannel({ branch: async () => "", detachedBranches: () => detachedBranches(dir) })).toBe(
      "fix-x",
    )
  })

  test("does not snapshot working-copy edits while looking up a channel", async () => {
    const { dir, jj } = await repo()
    await jj(["bookmark", "create", "fix-x", "-r", "@"])
    const before = (await jj(["log", "--ignore-working-copy", "--no-graph", "-r", "@", "-T", "commit_id"])).text()
    await Bun.write(path.join(dir, "uncommitted.txt"), "must not be snapshotted")
    expect(await detachedBranches(dir)).toEqual(["fix-x"])
    expect((await jj(["log", "--ignore-working-copy", "--no-graph", "-r", "@", "-T", "commit_id"])).text()).toBe(before)
  })

  test("finds jj metadata from a subdirectory", async () => {
    const { dir } = await repo()
    await fs.mkdir(path.join(dir, "nested"))
    expect(await detachedBranches(path.join(dir, "nested"))).toEqual(["integration-v2"])
  })

  test("reads bookmarks in a non-colocated jj repository", async () => {
    const dir = await temporaryDirectory()
    await $`jj --config user.name=test --config user.email=test@example.com git init ${dir}`.quiet()
    await $`jj bookmark create fix-x -r @`.cwd(dir).quiet()
    expect(await detachedBranches(dir)).toEqual(["fix-x"])
  })

  test("rejects several bookmarks at the chosen revision", async () => {
    const { dir, jj } = await repo()
    await jj(["bookmark", "create", "feature", "-r", "@-"])
    await expect(
      resolveChannel({ branch: async () => "", detachedBranches: () => detachedBranches(dir) }),
    ).rejects.toThrow("(feature, integration-v2). Set OPENCODE_CHANNEL")
  })

  test("rejects bookmarks from several working-copy parents", async () => {
    const { dir, jj } = await repo()
    await jj(["new", "root()", "-m", "other"])
    await jj(["bookmark", "create", "other", "-r", "@"])
    await jj(["new", "integration-v2", "other"])
    await expect(
      resolveChannel({ branch: async () => "", detachedBranches: () => detachedBranches(dir) }),
    ).rejects.toThrow("Set OPENCODE_CHANNEL to one of them")
  })
})

describe("parseForkVersion", () => {
  test("accepts only <upstream>-shuv.<n>", () => {
    expect(parseForkVersion("2.0.3-shuv.1")).toEqual({ base: "2.0.3", iteration: 1 })
    expect(parseForkVersion("2.0.3")).toBeUndefined()
    expect(parseForkVersion("2.0.3-shuv")).toBeUndefined()
    expect(parseForkVersion("2.0.3-shuv.1.2")).toBeUndefined()
    expect(parseForkVersion("2.0.0-alpha-20")).toBeUndefined()
    expect(parseForkVersion("nope")).toBeUndefined()
  })
})

describe("nextForkVersion", () => {
  test("starts at shuv.1 when nothing is published or the base moved", () => {
    expect(nextForkVersion({ base: "2.0.3" })).toBe("2.0.3-shuv.1")
    expect(nextForkVersion({ base: "2.0.3", published: "2.0.0-alpha-20" })).toBe("2.0.3-shuv.1")
    expect(nextForkVersion({ base: "2.0.4", published: "2.0.3-shuv.7" })).toBe("2.0.4-shuv.1")
  })

  test("increments the counter on the same base", () => {
    expect(nextForkVersion({ base: "2.0.3", published: "2.0.3-shuv.1" })).toBe("2.0.3-shuv.2")
    expect(nextForkVersion({ base: "2.0.3", published: "2.0.3-shuv.17" })).toBe("2.0.3-shuv.18")
  })

  test("never produces a bare upstream version", () => {
    expect(nextForkVersion({ base: "2.0.3", published: "2.0.3" })).toBe("2.0.3-shuv.1")
  })

  test("rejects invalid input", () => {
    expect(() => nextForkVersion({ base: "2.0.3-rc.1" })).toThrow("Invalid upstream base version")
    expect(() => nextForkVersion({ base: "2.0.3", published: "not-a-version" })).toThrow("Invalid published version")
  })
})
