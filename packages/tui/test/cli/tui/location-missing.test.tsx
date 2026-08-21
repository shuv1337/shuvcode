/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ConfigProvider } from "../../../src/config"
import { Keymap } from "../../../src/context/keymap"
import { ThemeProvider } from "../../../src/context/theme"
import { SessionLocationUnavailable } from "../../../src/routes/session/location-missing"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("retries the unavailable directory before offering to move", async () => {
  let retried = 0
  let moved = 0
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <SessionLocationUnavailable directory="/tmp/project" onRetry={() => retried++} onMove={() => moved++} />
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 16, kittyKeyboard: true },
  )
  app.renderer.start()

  try {
    await app.waitForFrame((frame) => frame.includes("Try again"))
    app.mockInput.pressEnter()
    expect(retried).toBe(1)
    expect(moved).toBe(0)

    app.mockInput.pressArrow("right")
    app.mockInput.pressEnter()
    expect(retried).toBe(1)
    expect(moved).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})
