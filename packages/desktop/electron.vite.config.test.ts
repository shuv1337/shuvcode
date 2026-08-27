import { expect, test } from "bun:test"
import { loadConfigFromFile } from "electron-vite"

test.each(["build", "serve"] as const)("configures minification for %s", async (command) => {
  const result = await loadConfigFromFile(
    { command, mode: command === "build" ? "production" : "development" },
    `${import.meta.dirname}/electron.vite.config.ts`,
  )

  expect(result?.config.main?.build?.minify).toBe(command === "build")
  expect(result?.config.preload?.build?.minify).toBe(command === "build")
  expect(result?.config.renderer?.build?.minify).toBe(command === "build")
  expect(result?.config.renderer?.build?.sourcemap).toBe(true)
})
