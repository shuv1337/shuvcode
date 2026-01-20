import { test, expect } from "./fixtures"
import { serverName, waitForAppReady } from "./utils"

test("home renders and shows core entrypoints", async ({ page }) => {
  await page.goto("/")

  // Wait for app to be ready
  await waitForAppReady(page)

  // Fork uses "Add project" instead of upstream's "Open project" (DialogCreateProject customization)
  await expect(page.getByRole("button", { name: "Add project" }).first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole("button", { name: serverName })).toBeVisible({ timeout: 15000 })
})

test("server picker dialog opens from home", async ({ page }) => {
  await page.goto("/")

  // Wait for app to be ready
  await waitForAppReady(page)

  const trigger = page.getByRole("button", { name: serverName })
  await expect(trigger).toBeVisible({ timeout: 15000 })
  await trigger.click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox").first()).toBeVisible()
})
