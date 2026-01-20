import { test, expect } from "./fixtures"
import { dirPath, promptSelector, waitForAppReady } from "./utils"

test("project route redirects to /session", async ({ page, directory, slug }) => {
  await page.goto(dirPath(directory))

  // Wait for app to be ready
  await waitForAppReady(page)

  await expect(page).toHaveURL(new RegExp(`/${slug}/session`), { timeout: 15000 })
  await expect(page.locator(promptSelector)).toBeVisible({ timeout: 15000 })
})
