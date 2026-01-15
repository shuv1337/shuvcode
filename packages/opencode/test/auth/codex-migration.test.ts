import { test, expect, spyOn, beforeEach, mock } from "bun:test"
import path from "path"

mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async () => "mocked",
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

const mockPlugin = () => ({})
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: mockPlugin }))

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Env } from "../../src/env"
import { Auth } from "../../src/auth"

test("get returns undefined for non-existent provider", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await Auth.get("nonexistent")
      expect(result).toBeUndefined()
    },
  })
})

test("get returns openai auth when openai entry exists", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const openaiAuth = {
        type: "oauth" as const,
        refresh: "openai-refresh-token",
        access: "openai-access-token",
        expires: Date.now() + 3600 * 1000,
      }

      await Auth.set("openai", openaiAuth)

      const result = await Auth.get("openai")

      expect(result).toBeDefined()
      expect(result?.type).toBe("oauth")
      expect((result as any).refresh).toBe("openai-refresh-token")
    },
  })
})

test("fresh openai auth is returned directly without migration", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const freshOpenaiAuth = {
        type: "oauth" as const,
        refresh: "fresh-refresh-token",
        access: "fresh-access-token",
        expires: Date.now() + 3600 * 1000,
        email: "fresh@example.com",
      }

      await Auth.set("openai", freshOpenaiAuth)

      const result = await Auth.get("openai")

      expect(result).toBeDefined()
      expect(result?.type).toBe("oauth")
      expect((result as any).refresh).toBe("fresh-refresh-token")
      expect((result as any).email).toBe("fresh@example.com")
    },
  })
})

test("set writes to specified provider ID", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const auth = {
        type: "oauth" as const,
        refresh: "test-refresh",
        access: "test-access",
        expires: Date.now() + 3600 * 1000,
      }

      await Auth.set("openai", auth)

      const result = await Auth.get("openai")
      expect(result).toBeDefined()
      expect(result?.type).toBe("oauth")
    },
  })
})

test("multiple providers can be stored independently", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const openaiAuth = {
        type: "oauth" as const,
        refresh: "openai-token",
        access: "openai-access",
        expires: Date.now() + 3600 * 1000,
      }

      const anthropicAuth = {
        type: "api" as const,
        key: "anthropic-key",
      }

      await Auth.set("openai", openaiAuth)
      await Auth.set("anthropic", anthropicAuth)

      const openaiResult = await Auth.get("openai")
      const anthropicResult = await Auth.get("anthropic")

      expect(openaiResult?.type).toBe("oauth")
      expect((openaiResult as any).refresh).toBe("openai-token")
      expect(anthropicResult?.type).toBe("api")
      expect((anthropicResult as any).key).toBe("anthropic-key")
    },
  })
})

test("token refresh writes to openai provider ID (not legacy codex)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Auth.remove("codex").catch(() => {})
      await Auth.remove("openai").catch(() => {})

      const legacyCodexAuth = {
        type: "oauth" as const,
        refresh: "legacy-codex-refresh",
        access: "legacy-codex-access",
        expires: Date.now() - 1000,
        email: "user@example.com",
      }

      await Auth.set("codex", legacyCodexAuth)

      const allBefore = await Auth.all()
      expect(allBefore.codex).toBeDefined()
      expect(allBefore.openai).toBeUndefined()

      const result = await Auth.get("openai")

      expect(result).toBeDefined()
      expect(result?.type).toBe("oauth")
      expect((result as any).email).toBe("user@example.com")

      const allAfter = await Auth.all()
      expect(allAfter.openai).toBeDefined()
      expect(allAfter.openai?.type).toBe("oauth")
      expect((allAfter.openai as any).refresh).toBe("legacy-codex-refresh")

      expect(allAfter.codex).toBeDefined()
      expect(allAfter.codex?.type).toBe("oauth")
    },
  })
})

test("OAuth result without optional metadata fields is valid (backwards compatibility)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Auth.remove("testprovider").catch(() => {})

      const minimalAuth = {
        type: "oauth" as const,
        refresh: "minimal-refresh",
        access: "minimal-access",
        expires: Date.now() + 3600 * 1000,
      }

      await Auth.set("testprovider", minimalAuth)

      const result = await Auth.get("testprovider")

      expect(result).toBeDefined()
      expect(result?.type).toBe("oauth")
      expect((result as any).refresh).toBe("minimal-refresh")
      expect((result as any).access).toBe("minimal-access")
      expect((result as any).expires).toBeDefined()
      expect((result as any).email).toBeUndefined()
      expect((result as any).name).toBeUndefined()
      expect((result as any).plan).toBeUndefined()
      expect((result as any).orgName).toBeUndefined()
      expect((result as any).accountId).toBeUndefined()
    },
  })
})
