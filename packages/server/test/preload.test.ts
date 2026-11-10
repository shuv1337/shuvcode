import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"

test("all application test entrypoints discard inherited config and credentials", async () => {
  await using directory = await tmpdir("preload-canary-")
  const home = directory.path
  const data = path.join(home, ".local", "share")
  const config = path.join(home, ".config")
  await fs.mkdir(path.join(data, "shuvcode"), { recursive: true })
  await fs.mkdir(path.join(config, "shuvcode"), { recursive: true })
  const token = "sk-test-canary-not-a-real-credential"
  await Bun.write(
    path.join(data, "shuvcode", "auth.json"),
    JSON.stringify({ openai: { type: "oauth", access: token, refresh: token, expires: 0 } }),
  )
  await Bun.write(path.join(config, "shuvcode", "opencode.json"), JSON.stringify({ instructions: ["CANARY"] }))
  await Promise.all(
    ["core", "server", "cli", "tui"].map(async (pkg) => {
      const child = Bun.spawn([process.execPath, "test", "../core/test/preload.test.ts"], {
        cwd: path.resolve(import.meta.dir, "../..", pkg),
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          XDG_CONFIG_HOME: config,
          XDG_DATA_HOME: data,
          XDG_STATE_HOME: path.join(home, ".local", "state"),
          XDG_CACHE_HOME: path.join(home, ".cache"),
          OPENCODE_TEST_HOME: home,
          OPENCODE_CONFIG_DIR: path.join(config, "shuvcode"),
          OPENCODE_CONFIG: path.join(config, "shuvcode", "opencode.json"),
          OPENCODE_CONFIG_CONTENT: '{"instructions":["CANARY"]}',
          SHUVCODE_CONFIG: "CANARY",
          OPENCODE_PASSWORD: token,
          OPENAI_API_KEY: token,
          AWS_REGION: "CANARY",
          GOOGLE_VERTEX_PROJECT: "CANARY",
          NPM_CONFIG_REGISTRY: "https://canary.invalid",
          UIDOTSH_AUTHORIZATION: token,
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      // Do not include captured output in assertion diagnostics: a regression could leak credentials.
      expect(stdout.includes(token) || stderr.includes(token)).toBe(false)
      expect(code, `${pkg} preload failed`).toBe(0)
    }),
  )
}, 30_000)
