import { test as base, expect } from "@playwright/test"
import { createSdk, dirSlug, getWorktree, promptSelector, sessionPath, waitForAppReady } from "./utils"

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
    const gotoSession = async (sessionID?: string) => {
      await page.goto(sessionPath(directory, sessionID))
      // Wait for app to be ready (may show loading states briefly)
      await waitForAppReady(page)
      await expect(page.locator(promptSelector).first()).toBeVisible({ timeout: 15000 })
    }
    await use(gotoSession)
  },
})

export { expect }
