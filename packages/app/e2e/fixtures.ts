import { test as base, expect } from "@playwright/test"
import { seedProjects, withSession } from "./actions"
import { promptSelector } from "./selectors"
import { createSdk, dirSlug, getWorktree, sessionPath, waitForAppReady } from "./utils"

type TestFixtures = {
  sdk: ReturnType<typeof createSdk>
  gotoSession: (sessionID?: string) => Promise<void>
}

type WorkerFixtures = {
  directory: string
  slug: string
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  directory: [
    async ({}, use) => {
      const directory = await getWorktree()
      await use(directory)
    },
    { scope: "worker" },
  ],
  slug: [
    async ({ directory }, use) => {
      await use(dirSlug(directory))
    },
    { scope: "worker" },
  ],
  sdk: async ({ directory }, use) => {
    await use(createSdk(directory))
  },
  gotoSession: async ({ page, directory }, use) => {
    await seedProjects(page, { directory })
    await page.addInitScript(() => {
      localStorage.setItem(
        "opencode.global.dat:model",
        JSON.stringify({
          recent: [{ providerID: "opencode", modelID: "big-pickle" }],
          user: [],
          variant: {},
        }),
      )
    })

    const gotoSession = async (sessionID?: string) => {
      await page.goto(sessionPath(directory, sessionID))
      // Wait for app to be ready (may show loading states briefly)
      await waitForAppReady(page)
      await expect(page.locator(promptSelector).first()).toBeVisible({ timeout: 15000 })
    }
    await use(gotoSession)
  },
})

export { expect, withSession }
