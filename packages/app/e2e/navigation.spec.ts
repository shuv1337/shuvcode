import { test, expect } from "./fixtures"
import { dirPath, promptSelector, connectingSelector } from "./utils"

test("project route redirects to /session", async ({ page, directory, slug }) => {
  await page.goto(dirPath(directory))

  // Wait for app to finish connecting
  await expect(page.locator(connectingSelector)).toHaveCount(0, { timeout: 30000 })

  await expect(page).toHaveURL(new RegExp(`/${slug}/session`), { timeout: 15000 })
  await expect(page.locator(promptSelector)).toBeVisible({ timeout: 15000 })
})
