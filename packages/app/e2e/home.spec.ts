import { test, expect } from "./fixtures"
import { serverName, connectingSelector } from "./utils"

test("home renders and shows core entrypoints", async ({ page }) => {
  await page.goto("/")

  // Wait for app to finish connecting (may show "Connecting to server..." briefly)
  await expect(page.locator(connectingSelector)).toHaveCount(0, { timeout: 30000 })

  // Fork uses "Add project" instead of upstream's "Open project" (DialogCreateProject customization)
  await expect(page.getByRole("button", { name: "Add project" }).first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole("button", { name: serverName })).toBeVisible({ timeout: 15000 })
})

test("server picker dialog opens from home", async ({ page }) => {
  await page.goto("/")

  // Wait for app to finish connecting
  await expect(page.locator(connectingSelector)).toHaveCount(0, { timeout: 30000 })

  const trigger = page.getByRole("button", { name: serverName })
  await expect(trigger).toBeVisible({ timeout: 15000 })
  await trigger.click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox").first()).toBeVisible()
})
